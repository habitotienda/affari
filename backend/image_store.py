"""Imágenes de Affari: compresión a WebP + subida a Supabase Storage (bucket público).

Variables de entorno (Render > Environment):
  SUPABASE_URL           https://<ref>.supabase.co
  SUPABASE_SERVICE_KEY   service_role (o sb_secret_...). SOLO en el backend, nunca en el navegador.
  SUPABASE_BUCKET        product-images (público)
Opcionales: IMG_WEBP_QUALITY (35) · IMG_MAX_WIDTH (1200)

Flujo:  data URL / bytes  ->  to_webp()  ->  upload()  ->  URL pública  (es lo único que se guarda en la base)

El nombre del archivo es el hash del contenido (<carpeta>/<sha256[:24]>.webp):
  · subir dos veces la misma foto no duplica nada (idempotente y reanudable);
  · la URL cambia si cambia la imagen, así que se puede cachear "para siempre".
"""
import base64, binascii, hashlib, io, logging, os, re, time
from concurrent.futures import ThreadPoolExecutor

import requests
from dotenv import load_dotenv
from PIL import Image, ImageOps

load_dotenv()
log = logging.getLogger("affari.images")

QUALITY = int(os.getenv("IMG_WEBP_QUALITY", "35"))
MAX_W = int(os.getenv("IMG_MAX_WIDTH", "1200"))
TIMEOUT = 30
CACHE_CONTROL = "max-age=31536000"            # 1 año: el nombre lleva el hash del contenido
MEDIA_KEYS = ("bgImg", "coverImg")            # imágenes sueltas del tema (además de promos[])

_DATA = re.compile(r"^data:image/[a-z+.-]+;base64,", re.I)
_http = requests.Session()


class ImageStoreError(Exception):
    """No se pudo procesar o subir la imagen."""


# ------------------------------------------------------------------ configuración
def _cfg():
    return (os.getenv("SUPABASE_URL", "").strip().rstrip("/"),
            os.getenv("SUPABASE_SERVICE_KEY", "").strip(),
            os.getenv("SUPABASE_BUCKET", "").strip())

def enabled():
    return all(_cfg())

def public_base():
    url, _, bucket = _cfg()
    return f"{url}/storage/v1/object/public/{bucket}/"

def is_data_url(v):
    return isinstance(v, str) and bool(_DATA.match(v))

def is_ours(v):
    """¿Es una URL pública de NUESTRO bucket? (única URL externa que se acepta en la base)"""
    return enabled() and isinstance(v, str) and v.startswith(public_base())


# ------------------------------------------------------------------ compresión
def decode_data_url(data_url):
    try:
        return base64.b64decode(data_url.split(";base64,", 1)[1])
    except (IndexError, binascii.Error, ValueError) as e:
        raise ImageStoreError("Imagen base64 inválida") from e

def to_webp(raw, quality=None):
    """bytes de cualquier imagen -> bytes WebP (ancho máx. MAX_W, calidad 35, method=6).
    Respeta la orientación EXIF y la transparencia. `quality` permite subirla para logos/banners con texto."""
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:                                  # formato desconocido, truncada, bomba de descompresión…
        raise ImageStoreError(f"Imagen ilegible: {e}") from e
    im = ImageOps.exif_transpose(im)
    alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if alpha else "RGB")
    if im.width > MAX_W:
        im = im.resize((MAX_W, max(1, round(im.height * MAX_W / im.width))), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    # optimize=True se acepta pero WebP lo ignora; el ahorro real lo da method=6 (búsqueda más lenta y más compacta)
    im.save(out, "WEBP", quality=QUALITY if quality is None else quality, method=6, optimize=True)
    return out.getvalue()


# ------------------------------------------------------------------ Supabase Storage
def _headers():
    _, key, _ = _cfg()
    h = {"apikey": key, "Content-Type": "image/webp", "x-upsert": "true", "cache-control": CACHE_CONTROL}
    if key.startswith("eyJ"):                               # clave legacy (JWT): también va como Bearer; las sb_secret_ no
        h["Authorization"] = f"Bearer {key}"
    return h

def object_path(folder, data):
    return f"{folder.strip('/')}/{hashlib.sha256(data).hexdigest()[:24]}.webp"

def verify_public(url, size):
    """La URL pública responde 200 y entrega exactamente los bytes subidos."""
    last = ""
    for attempt in range(3):
        try:
            r = _http.get(url, timeout=TIMEOUT)
            if r.status_code == 200 and len(r.content) == size:
                return
            last = f"HTTP {r.status_code}, {len(r.content)} de {size} bytes"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(0.5 * (attempt + 1))
    raise ImageStoreError(f"La URL pública no responde 200 OK ({last}): {url}")

def upload(data, path, verify=False):
    """Sube los bytes WebP al bucket y devuelve la URL pública. Reintenta errores de red / 5xx / 429."""
    if not enabled():
        raise ImageStoreError("Faltan SUPABASE_URL, SUPABASE_SERVICE_KEY o SUPABASE_BUCKET")
    url, _, bucket = _cfg()
    endpoint = f"{url}/storage/v1/object/{bucket}/{path}"
    last = ""
    for attempt in range(3):
        try:
            r = _http.post(endpoint, data=data, headers=_headers(), timeout=TIMEOUT)
            if r.status_code in (200, 201):
                public = public_base() + path
                if verify:
                    verify_public(public, len(data))
                return public
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code < 500 and r.status_code != 429:    # 400/401/403/404: reintentar no sirve
                break
        except requests.RequestException as e:
            last = str(e)
        time.sleep(0.6 * (attempt + 1))
    raise ImageStoreError(f"Supabase Storage rechazó la subida ({last})")

def process(src, folder, quality=None, verify=False):
    """data URL (o bytes) -> WebP -> Supabase -> URL pública."""
    raw = decode_data_url(src) if isinstance(src, str) else src
    data = to_webp(raw, quality)
    return upload(data, object_path(folder, data), verify=verify)


# ------------------------------------------------------------------ helpers para la app
def persist_images(images, folder):
    """Cambia cada data URL por su URL pública; lo demás queda igual. Estricto: si una subida falla, lanza ImageStoreError
    (nunca se cae a guardar base64). Sin Supabase configurado (desarrollo local) devuelve la lista sin tocar."""
    images = list(images)
    todo = [i for i, v in enumerate(images) if is_data_url(v)]
    if not todo:
        return images
    if not enabled():
        log.warning("SUPABASE_* sin configurar: las fotos se guardan como base64 (solo para desarrollo)")
        return images
    with ThreadPoolExecutor(max_workers=min(4, len(todo))) as ex:
        for i, url in zip(todo, ex.map(lambda i: process(images[i], folder), todo)):
            images[i] = url
    return images

def map_theme(theme, fn):
    """Aplica fn a cada data URL del tema del catálogo (bgImg, coverImg y promos[]). Devuelve una copia."""
    out = dict(theme)
    for k in MEDIA_KEYS:
        if is_data_url(out.get(k)):
            out[k] = fn(out[k])
    if isinstance(out.get("promos"), list):
        out["promos"] = [fn(p) if is_data_url(p) else p for p in out["promos"]]
    return out

def persist_theme(theme, store_id):
    if not enabled():
        return theme
    return map_theme(theme, lambda d: process(d, f"stores/{store_id}/theme"))

def persist_logo(logo, store_id):
    if not is_data_url(logo) or not enabled():
        return logo
    return process(logo, f"stores/{store_id}/logo")

def fetch_data_url(url):
    """Foto de nuestro bucket -> data URL (para mandársela a la IA). Solo URLs del propio bucket (evita SSRF)."""
    if not is_ours(url):
        raise ImageStoreError("URL no permitida")
    try:
        r = _http.get(url, timeout=TIMEOUT)
        r.raise_for_status()
    except requests.RequestException as e:
        raise ImageStoreError(f"No se pudo bajar la imagen: {e}") from e
    mime = r.headers.get("Content-Type", "image/webp").split(";")[0]
    return f"data:{mime};base64," + base64.b64encode(r.content).decode()
