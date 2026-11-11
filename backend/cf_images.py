"""Fotos de producto con Cloudflare Workers AI (FLUX.2 klein): mejorar una foto existente o crear una desde el nombre.

Configuración (variables de entorno; en Render: Environment):
  CF_ACCOUNT_ID + CF_API_TOKEN     tu cuenta de Cloudflare y un token de API con permiso «Workers AI».
  CF_ACCOUNTS                      opcional: varias cuentas «id:token,id:token» (rotan si una agota la cuota diaria gratuita).
  CF_IMAGE_MODELS                  modelos en orden de preferencia (por defecto flux-2-klein-4b y, si falla, flux-2-klein-9b).

La IA NO guarda nada sola: devuelve la imagen y el usuario decide si la usa (queda como foto del producto al guardarlo).
Solo usa la librería estándar + Pillow (ya está en las dependencias).
"""
import base64, io, json, logging, os, re, uuid, urllib.error, urllib.request
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import database as db
import ai_keys as gk
import ai_agent as ag

log = logging.getLogger("affari.ai.images")
CF_API = os.getenv("CF_API_URL", "https://api.cloudflare.com/client/v4").rstrip("/")
MODELS = [m.strip() for m in os.getenv("CF_IMAGE_MODELS", "@cf/black-forest-labs/flux-2-klein-4b,@cf/black-forest-labs/flux-2-klein-9b").split(",") if m.strip()]
TIMEOUT = int(os.getenv("CF_TIMEOUT", "90"))
OUT_SIDE = int(os.getenv("CF_IMAGE_SIZE", "1024"))        # lado largo que se le pide al modelo
IN_SIDE = 500                                              # FLUX.2 pide fotos de referencia menores a 512x512
MAX_DATA_URL = 420_000                                     # el backend acepta hasta 450.000 caracteres por foto de producto

# Fondos / escenas disponibles (el usuario elige en el modal). Los prompts van en inglés: el modelo responde mejor.
STYLES = {
    "blanco": ("Estudio · fondo blanco", "a pure white seamless studio background with a soft natural contact shadow under the product"),
    "gris": ("Estudio · gris suave", "a clean light-gray seamless studio backdrop with a soft realistic shadow and subtle reflection"),
    "ambiente": ("Ambiente · mesa y luz natural", "a tasteful lifestyle setting: a light wooden table, soft blurred background, warm natural window light"),
    "oscuro": ("Premium · fondo oscuro", "an elegant dark charcoal studio backdrop with a soft rim light that highlights the product edges"),
}
KEEP = ("Keep the product exactly as it is in the reference photo: same shape, proportions, colors, material, logo, label and any text. "
        "Do not add, remove or redesign any part of the product.")
LOOK = "Professional e-commerce product photograph, product centered with comfortable margins, sharp focus, even soft lighting, high resolution. No watermark, no added text, no extra objects."

def accounts():
    """Cuentas de Cloudflare configuradas, como lista de (account_id, token)."""
    out = []
    for item in re.split(r"[,\s;]+", os.getenv("CF_ACCOUNTS", "")):
        if ":" in item:
            a, t = item.split(":", 1)
            if a and t: out.append((a, t))
    a, t = os.getenv("CF_ACCOUNT_ID", "").strip(), os.getenv("CF_API_TOKEN", "").strip()
    if a and t and (a, t) not in out:
        out.insert(0, (a, t))
    return out

def configured():
    return bool(accounts())

# ---------------------------------------------------------------- imágenes
def _open(data_url):
    from PIL import Image
    raw = base64.b64decode(data_url.split(";base64,", 1)[1])
    im = Image.open(io.BytesIO(raw))
    if im.mode in ("RGBA", "LA", "P"):                     # PNG con transparencia: se apoya sobre blanco
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white"); bg.paste(im, mask=im.split()[-1]); return bg
    return im.convert("RGB")

def prepare_input(data_url):
    """Foto de referencia reducida (< 512 px) en JPEG, y el tamaño de salida con la misma proporción."""
    im = _open(data_url)
    w, h = im.size
    k = min(1.0, IN_SIDE / max(w, h))
    small = im.resize((max(64, round(w * k)), max(64, round(h * k))))
    buf = io.BytesIO(); small.save(buf, "JPEG", quality=92)
    r = OUT_SIDE / max(w, h)
    snap = lambda v: max(256, min(1920, int(round(v * r / 16)) * 16))
    return buf.getvalue(), snap(w), snap(h)

def finish(raw_b64):
    """Imagen devuelta por el modelo -> JPEG que entra en el límite de fotos de producto (data URL)."""
    from PIL import Image
    im = Image.open(io.BytesIO(base64.b64decode(raw_b64))).convert("RGB")
    for side, q in ((900, 84), (900, 76), (800, 76), (720, 70), (640, 66)):
        k = min(1.0, side / max(im.size))
        out = im.resize((round(im.width * k), round(im.height * k))) if k < 1 else im
        buf = io.BytesIO(); out.save(buf, "JPEG", quality=q, optimize=True)
        url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        if len(url) <= MAX_DATA_URL:
            return url
    raise gk.GeminiError("fatal", "La imagen generada es demasiado pesada.")

# ---------------------------------------------------------------- Cloudflare
def _multipart(fields, files):
    b = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, (fn, data, ct) in files.items():
        out.write(f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{fn}"\r\nContent-Type: {ct}\r\n\r\n'.encode())
        out.write(data); out.write(b"\r\n")
    out.write(f"--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"

def _classify(status, body):
    try: j = json.loads(body)
    except ValueError: j = {}
    errs = j.get("errors") if isinstance(j, dict) else None
    e0 = errs[0] if isinstance(errs, list) and errs and isinstance(errs[0], dict) else {}
    msg, code = str(e0.get("message") or body[:200]), e0.get("code")
    low = msg.lower()
    if status == 429 or code == 4006 or "neurons" in low or "daily" in low and "allocation" in low:
        return gk.GeminiError("quota", msg, 3 * 3600, status)
    if status in (401, 403) or code in (9106, 10000):
        return gk.GeminiError("invalid", msg, 6 * 3600, status)
    if status == 404 or code in (5007, 7000) or "no such model" in low or "model not found" in low:
        return gk.GeminiError("model", msg, 0, status)
    if status >= 500:
        return gk.GeminiError("transient", msg, 20, status)
    return gk.GeminiError("fatal", msg, 0, status)

def _run(model, acct, token, fields, files):
    body, ctype = _multipart(fields, files)
    req = urllib.request.Request(f"{CF_API}/accounts/{acct}/ai/run/{model}", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": ctype, "User-Agent": gk.UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            j = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise _classify(e.code, e.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise gk.GeminiError("transient", f"Sin conexión con Cloudflare: {e}", 10)
    img = (j.get("result") or {}).get("image") if isinstance(j, dict) else None
    if not img:
        raise gk.GeminiError("fatal", "Cloudflare no devolvió ninguna imagen.")
    return img

def run_image(prompt, ref=None, size=(OUT_SIDE, OUT_SIDE)):
    """Genera con rotación de cuentas y de modelos. ref: bytes JPEG de la foto de referencia (o None para crear desde cero)."""
    accts = [a for a in accounts() if not gk.cooling("cf:" + a[0])]
    if not accts:
        raise gk.AllKeysExhausted() if accounts() else gk.GeminiError("fatal", "no_config")
    fields = {"prompt": prompt, "width": str(size[0]), "height": str(size[1])}
    files = {"input_image_0": ("producto.jpg", ref, "image/jpeg")} if ref else {}
    last = None
    for acct, token in accts:
        for model in MODELS:
            for attempt in (1, 2):
                try:
                    return finish(_run(model, acct, token, fields, files))
                except gk.GeminiError as e:
                    last = e
                    log.warning("Imágenes: cuenta %s modelo %s: %s %s", acct[:6] + "…", model, e.kind, str(e)[:160])
                    if e.kind == "transient" and attempt == 1: continue
                    break
            if last.kind in ("quota", "invalid"):
                gk.cool("cf:" + acct, last.retry); break          # esta cuenta descansa; se prueba la próxima
            if last.kind == "model": continue
            if last.kind == "fatal": raise last
    if last and last.kind in ("quota", "invalid"):
        raise gk.AllKeysExhausted()
    raise last

# ---------------------------------------------------------------- prompts
def enhance_prompt(name, style):
    scene = STYLES[style][1]
    what = f" The product is: {name}." if name else ""
    return f"Take the product in image 0 and photograph it on {scene}.{what} {KEEP} {LOOK}"

def create_prompt(name, category, style):
    scene = STYLES[style][1]
    cat = f" (category: {category})" if category else ""
    return f"Professional e-commerce product photograph of {name}{cat}, on {scene}. {LOOK}"

# ---------------------------------------------------------------- API
class EnhanceIn(BaseModel):
    image: str = ""
    product_id: Optional[int] = None
    name: str = ""
    style: str = "blanco"

class CreateIn(BaseModel):
    name: str = ""; category: str = ""; style: str = "blanco"

def make_router(current_user):
    R = APIRouter(prefix="/api/ai/image")

    def guard(sid, style):
        if style not in STYLES:
            raise HTTPException(400, "Estilo de foto inválido.")
        if not configured():
            raise HTTPException(503, "Las fotos con IA todavía no están activadas: falta configurar Cloudflare Workers AI (CF_ACCOUNT_ID y CF_API_TOKEN).")
        if not ag.rate_ok(("img", sid), limit=25, window=3600):
            raise HTTPException(429, "Vas muy rápido: esperá un rato antes de generar más fotos.")

    def run(prompt, ref=None, size=(OUT_SIDE, OUT_SIDE)):
        try:
            return run_image(prompt, ref, size)
        except gk.AllKeysExhausted:
            raise HTTPException(429, "Se agotó la cuota diaria gratuita de imágenes. Probá mañana.")
        except gk.GeminiError as e:
            log.warning("Imágenes: %s %s", e.kind, e)
            if e.kind == "invalid":
                raise HTTPException(502, "Cloudflare rechazó las credenciales. Revisá CF_ACCOUNT_ID y CF_API_TOKEN (el token necesita permiso Workers AI).")
            if "nsfw" in str(e).lower() or "flagged" in str(e).lower():
                raise HTTPException(422, "La IA no pudo procesar esa foto. Probá con otra.")
            raise HTTPException(502, "El servicio de imágenes no respondió. Probá de nuevo en un momento.")

    @R.get("/status")
    def status(u=Depends(current_user)):
        return {"ready": configured(), "styles": {k: v[0] for k, v in STYLES.items()}}

    @R.post("/enhance")
    def enhance(d: EnhanceIn, u=Depends(current_user)):
        sid, image, name = u["store_id"], d.image.strip(), d.name.strip()[:120]
        guard(sid, d.style)
        m = ag.IMG_LOCAL.match(image)                        # foto guardada del producto (el formulario la muestra por URL)
        if m:
            with db.conn() as c:
                r = c.execute("SELECT images FROM products WHERE id=? AND store_id=?", (d.product_id or 0, sid)).fetchone()
            try: stored = json.loads(r["images"] or "[]") if r else []
            except ValueError: stored = []
            image = stored[int(m.group(2))] if r and int(m.group(1)) == d.product_id and int(m.group(2)) < len(stored) else ""
        if not image or len(image) > 600_000 or not ag.IMG.match(image):
            raise HTTPException(400, "No pudimos leer esa foto. Subila de nuevo.")
        try:
            ref, w, h = prepare_input(image)
        except Exception:
            raise HTTPException(400, "No pudimos leer esa foto. Subila de nuevo.")
        return {"image": run(enhance_prompt(name, d.style), ref, (w, h))}

    @R.post("/create")
    def create(d: CreateIn, u=Depends(current_user)):
        name = d.name.strip()[:120]
        if not name:
            raise HTTPException(400, "Escribí primero el nombre del producto.")
        guard(u["store_id"], d.style)
        return {"image": run(create_prompt(name, d.category.strip()[:40], d.style))}

    return R
