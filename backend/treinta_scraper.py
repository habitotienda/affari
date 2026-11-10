"""Scraper del catálogo público de Treinta.

Sin dependencias de FastAPI ni de la base: recibe una URL y devuelve productos normalizados.
Estrategias de extracción, en orden (se queda con la primera que encuentre productos):
  1. JSON embebido en <script> (Next.js __NEXT_DATA__, application/json, window.__ESTADO__ = {...})
  2. JSON-LD (schema.org Product / ItemList)
  3. Microdatos HTML (itemtype=Product)
Un recorrido genérico del JSON detecta "algo que parece un producto" (nombre + precio) sin depender
de la ruta exacta, así que tolera cambios de estructura. Si Treinta renderiza todo del lado del
cliente (la página no trae productos), lanza ScrapeError("no_products") con una pista.
"""
import ipaddress, json, logging, re, socket
from io import BytesIO
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

log = logging.getLogger("affari.treinta")

# Dominios desde los que se acepta importar (editá esta lista si tus tiendas viven en otro dominio).
ALLOWED_HOSTS = ("treinta.co", "treinta.app", "trinta.co")
UA = "Mozilla/5.0 (compatible; AffariImporter/1.0; +catalog-import)"
TIMEOUT = (5, 15)                    # (conexión, lectura) en segundos
MAX_HTML = 4_000_000                 # bytes
MAX_IMG = 6_000_000
MAX_PRODUCTS = 500
MAX_REDIRECTS = 3
MAX_PAGES = 30                       # páginas extra que se piden como máximo
MAX_SECONDS = 40                     # tiempo total de la paginación
MAX_IMGS_PER_PRODUCT = 3
NAME_MAX, DESC_MAX, CAT_MAX = 120, 600, 40      # mismos límites que el resto de Affari


class ScrapeError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ------------------------------------------------------------------ URL y red
def validate_url(raw):
    """Normaliza y valida la URL de la tienda. Solo https y solo dominios de Treinta."""
    url = (raw or "").strip()
    if not url or len(url) > 500:
        raise ScrapeError("invalid_url", "Pegá el link público de tu tienda de Treinta.")
    if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
        url = "https://" + url
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if p.scheme not in ("http", "https") or not host or p.username or p.password or p.port not in (None, 80, 443):
        raise ScrapeError("invalid_url", "El link no es válido. Debe ser algo como https://treinta.co/…")
    if not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise ScrapeError("invalid_url", "Solo se pueden importar catálogos públicos de Treinta (treinta.co).")
    return p._replace(scheme="https", fragment="").geturl()


def _public_ip_only(host):
    """Anti-SSRF: el host debe resolver únicamente a IPs públicas."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ScrapeError("network", "No se pudo encontrar ese sitio. Revisá el link.", 502)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise ScrapeError("invalid_url", "Dirección no permitida.")


def _get(url, *, check_host, accept, max_bytes):
    """GET con redirecciones manuales (cada salto se vuelve a validar) y tope de tamaño."""
    for _ in range(MAX_REDIRECTS + 1):
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            raise ScrapeError("invalid_url", "Enlace no permitido.")
        if check_host:
            validate_url(url)
        _public_ip_only(p.hostname)
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Language": "es"},
                             timeout=TIMEOUT, allow_redirects=False, stream=True)
        except requests.Timeout:
            raise ScrapeError("timeout", "Treinta tardó demasiado en responder. Probá de nuevo en un momento.", 504)
        except requests.RequestException:
            raise ScrapeError("network", "No pudimos conectarnos con Treinta. Probá de nuevo en un momento.", 502)
        if r.is_redirect and r.headers.get("Location"):
            url = urljoin(url, r.headers["Location"]); r.close(); continue
        break
    else:
        raise ScrapeError("network", "Demasiadas redirecciones.", 502)
    try:
        if r.status_code == 404:
            raise ScrapeError("not_found", "No encontramos esa tienda. Revisá que el link sea correcto y que el catálogo esté publicado.", 404)
        if r.status_code in (401, 403, 429):
            raise ScrapeError("blocked", "Treinta rechazó la consulta (acceso restringido o demasiados intentos). Probá más tarde.", 502)
        if r.status_code >= 400:
            raise ScrapeError("network", f"Treinta respondió con un error ({r.status_code}).", 502)
        buf = bytearray()
        for chunk in r.iter_content(65536):
            buf += chunk
            if len(buf) > max_bytes:
                raise ScrapeError("too_big", "La respuesta es demasiado grande.", 502)
        return bytes(buf), r
    finally:
        r.close()


# ------------------------------------------------------------------ normalización
NAME_K = ("name", "nombre", "title", "titulo", "productname", "product_name", "nombreproducto")
PRICE_K = ("price", "precio", "saleprice", "sale_price", "sellingprice", "selling_price", "precioventa", "precio_venta",
           "unitprice", "unit_price", "preciounitario", "finalprice")
IMG_K = ("image", "images", "imageurl", "image_url", "imageurls", "photo", "photos", "picture", "pictures", "imagen",
         "imagenes", "img", "thumbnail", "thumb", "foto", "fotos")
DESC_K = ("description", "descripcion", "desc", "detail", "detalle")
CAT_K = ("category", "categoria", "categoryname", "category_name", "categories", "categorias")
STOCK_K = ("stock", "quantity", "cantidad", "inventory", "available", "availablequantity", "existencias")


def parse_price(v):
    """'$12.500' → 12500 · '12,500.50' → 12500.5 · '1.250,75' → 1250.75 · 15000 → 15000."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2) if 0 <= v < 1e12 else None
    if re.match(r"^\s*[-−]", str(v)):
        return None
    s = re.sub(r"[^\d.,]", "", str(v))
    if not s or not re.search(r"\d", s):
        return None
    if "," in s and "." in s:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        s = s.replace("," if dec == "." else ".", "").replace(dec, ".")
    elif "," in s or "." in s:
        sep = "," if "," in s else "."
        parts = s.split(sep)
        # varios separadores, o grupo final de 3 dígitos → son miles ("12.500", "1,250,000")
        s = "".join(parts) if len(parts) > 2 or len(parts[-1]) == 3 else s.replace(sep, ".")
    try:
        n = float(s)
    except ValueError:
        return None
    return round(n, 2) if 0 <= n < 1e12 else None


def _ci(d, keys):
    """Primer valor presente (no vacío) de d para cualquiera de las claves, sin distinguir mayúsculas."""
    low = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        v = low.get(k)
        if v not in (None, "", [], {}):
            return v
    return None


def _text(v, limit):
    if isinstance(v, dict):
        v = _ci(v, ("name", "nombre", "title", "label"))
    if isinstance(v, list):
        v = next((x for x in (_text(i, limit) for i in v) if x), "")
    if not isinstance(v, str):
        return ""
    return re.sub(r"\s+", " ", BeautifulSoup(v, "html.parser").get_text(" ")).strip()[:limit]


def _images(v, base):
    out = []
    def add(x):
        if isinstance(x, str):
            x = x.strip()
            if x and not x.startswith("data:"):
                u = urljoin(base, x)
                if u.startswith(("http://", "https://")) and u not in out:
                    out.append(u)
        elif isinstance(x, dict):
            add(_ci(x, ("url", "src", "uri", "image", "imageurl", "path", "large", "original")))
        elif isinstance(x, list):
            for i in x:
                add(i)
    add(v)
    return out[:MAX_IMGS_PER_PRODUCT]


def _stock(v):
    if isinstance(v, bool):
        return 0
    try:
        n = int(float(v))
        return n if 0 <= n < 10_000_000 else 0
    except (TypeError, ValueError):
        return 0


def _offer_price(d):
    """schema.org: price dentro de offers (dict o lista) o priceSpecification."""
    o = _ci(d, ("offers",))
    for item in (o if isinstance(o, list) else [o]):
        if isinstance(item, dict):
            p = parse_price(_ci(item, ("price", "lowprice")))
            if p is None and isinstance(item.get("priceSpecification"), dict):
                p = parse_price(item["priceSpecification"].get("price"))
            if p is not None:
                return p
    return None


def _as_product(d, base):
    name = _text(_ci(d, NAME_K), NAME_MAX)
    if not name:
        return None
    price = parse_price(_ci(d, PRICE_K))
    if price is None:
        price = _offer_price(d)
    if price is None:
        return None
    imgs = _images(_ci(d, IMG_K), base)
    return {"name": name, "price": price, "image": imgs[0] if imgs else "", "images": imgs,
            "description": _text(_ci(d, DESC_K), DESC_MAX), "category": _text(_ci(d, CAT_K), CAT_MAX),
            "stock": _stock(_ci(d, STOCK_K)), "cost": 0.0}       # costo: dato privado, no está en la tienda pública


CATID_K = ("categoryid", "category_id", "categoriaid", "categoria_id", "collectionid", "collection_id", "sectionid")
LIST_K = ("products", "productos", "items", "data", "results")


def _category_map(node, out, depth=0):
    """id → nombre de categoría, buscando listas llamadas categories/categorias/collections con {id, name}."""
    if depth > 60:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            if str(k).lower() in ("categories", "categorias", "collections", "colecciones", "sections", "secciones", "tabs") and isinstance(v, list):
                for c in v:
                    if isinstance(c, dict):
                        cid, nm = _ci(c, ("id", "_id", "uuid", "slug")), _text(_ci(c, ("name", "nombre", "title", "label")), CAT_MAX)
                        if cid is not None and nm:
                            out[str(cid)] = nm
            _category_map(v, out, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _category_map(v, out, depth + 1)


def walk_products(node, base, out, depth=0, cat="", cats=None):
    """Recorre cualquier JSON y junta los dicts que parecen productos (nombre + precio).
    La categoría sale del propio producto, de su categoryId (mapa `cats`) o del contenedor que lo agrupa
    (p. ej. {"name": "Bebidas", "products": [...]})."""
    if depth > 60 or len(out) >= MAX_PRODUCTS:
        return
    if isinstance(node, dict):
        p = _as_product(node, base)
        if p:
            if not p["category"]:
                cid = _ci(node, CATID_K)
                p["category"] = (cats or {}).get(str(cid), "") if cid is not None else ""
            if not p["category"]:
                p["category"] = cat
            out.append(p)            # no bajamos: las variantes/ofertas internas no son productos aparte
            return
        own = _text(_ci(node, ("categoryname", "category_name", "categoria", "category", "label", "title", "name", "nombre")), CAT_MAX) \
            if any(isinstance(node.get(k), list) for k in LIST_K) else ""
        for v in node.values():
            walk_products(v, base, out, depth + 1, own or cat, cats)
    elif isinstance(node, list):
        for v in node:
            walk_products(v, base, out, depth + 1, cat, cats)


def _dedupe(items):
    seen, res = set(), []
    for p in items:
        k = (p["name"].lower(), p["price"])
        if k not in seen:
            seen.add(k); res.append(p)
    return res[:MAX_PRODUCTS]


# ------------------------------------------------------------------ estrategias
def _json_from_scripts(soup):
    """Todos los JSON embebidos: <script type=json>, __NEXT_DATA__ y asignaciones window.X = {...}."""
    dec = json.JSONDecoder()
    for s in soup.find_all("script"):
        raw = (s.string or s.get_text() or "").strip()
        if not raw or len(raw) < 20:
            continue
        typ = (s.get("type") or "").lower()
        if typ in ("application/json", "application/ld+json") or s.get("id") == "__NEXT_DATA__":
            try:
                yield json.loads(raw)
            except ValueError:
                pass
            continue
        m = re.search(r"=\s*([\[{])", raw[:300])
        if m and ("window" in raw[:m.start()] or "__" in raw[:m.start()]):
            try:
                yield dec.raw_decode(raw[m.start(1):])[0]
            except ValueError:
                pass


def _flight_json(soup):
    """Next.js App Router (catalogo.treinta.co): el estado viaja en self.__next_f.push([1,"..."]) (flight data)."""
    dec, parts = json.JSONDecoder(), []
    for s in soup.find_all("script"):
        raw = s.string or s.get_text() or ""
        if "__next_f" not in raw:
            continue
        for m in re.finditer(r"__next_f\.push\(", raw):
            try:
                arr, _ = dec.raw_decode(raw, m.end())
            except ValueError:
                continue
            if isinstance(arr, list) and len(arr) > 1 and arr[0] == 1 and isinstance(arr[1], str):
                parts.append(arr[1])
    for line in "".join(parts).split("\n"):
        m = re.match(r"^[0-9a-fA-F]+:([\[{].*)$", line)           # "5:[...]" · se ignoran módulos (I[...]) y textos (T..)
        if m:
            try:
                yield json.loads(m.group(1))
            except ValueError:
                pass


_PRICE_TXT = re.compile(r"^\$\s*[\d.,]+$")


def _card_image(a, base):
    img = a.find("img")
    if not img:
        return ""
    src = img.get("src") or img.get("data-src") or (img.get("srcset") or "").split(" ")[0]
    if not src or src.startswith("data:"):
        return ""
    q = parse_qs(urlparse(src).query)
    if "/_next/image" in src and q.get("url"):                    # next/image envuelve la URL real
        src = q["url"][0]
    return urljoin(base, src)


def _cards(soup, base):
    """Respaldo: tarjetas <a href=".../product/<id>"> con nombre, descripción y precio como texto.
    Ojo: los productos agotados pueden no ser links; esos solo salen por flight data."""
    out = []
    for a in soup.select('a[href*="/product/"]'):
        pieces = list(dict.fromkeys(t for t in a.stripped_strings if t))     # el nombre suele repetirse (título + alt)
        price_txt = next((t for t in reversed(pieces) if _PRICE_TXT.match(t)), None)
        rest = [t for t in pieces if t != price_txt]
        p = _as_product({"name": rest[0] if rest else "", "price": price_txt,
                         "image": _card_image(a, base), "description": " ".join(rest[1:])}, base)
        if p:
            out.append(p)
    return out


def _microdata(soup, base):
    out = []
    for el in soup.select('[itemtype*="schema.org/Product"]'):
        g = lambda prop: (lambda n: (n.get("content") or n.get("src") or n.get_text(" ")) if n else None)(el.select_one(f'[itemprop="{prop}"]'))
        p = _as_product({"name": g("name"), "price": g("price"), "image": g("image"),
                         "description": g("description"), "category": g("category")}, base)
        if p:
            out.append(p)
    return out


def _store_name(soup):
    for sel in ('meta[property="og:site_name"]', 'meta[property="og:title"]', "title"):
        n = soup.select_one(sel)
        t = _text((n.get("content") if n and n.has_attr("content") else n.get_text()) if n else "", 80)
        t = re.split(r"\s+[|\-–—]\s+", t)[0].strip()          # "Local Pepe | Treinta" → "Local Pepe"
        if t and t.lower() not in ("treinta", "trinta"):
            return t
    return ""


def extract_products(html, base_url):
    """HTML → (nombre_tienda, [productos]). Función pura: sirve también para probar con HTML guardado."""
    soup = BeautifulSoup(html, "html.parser")
    blobs = list(_json_from_scripts(soup)) + list(_flight_json(soup))
    cats = {}
    for b in blobs:
        _category_map(b, cats)
    found = []
    for b in blobs:
        walk_products(b, base_url, found, cats=cats)
    products = _dedupe(found + _cards(soup, base_url))      # tarjetas completan lo que flight data no traiga
    if not products:
        products = _dedupe(_microdata(soup, base_url))
    log.info("treinta: %s blobs JSON, %s productos, %s categorías", len(blobs), len(products), len(cats))
    return _store_name(soup), products


def _merge(a, b):
    """Suma productos nuevos (por nombre+precio) y completa la categoría/foto faltante de los repetidos."""
    idx = {(p["name"].lower(), p["price"]): p for p in a}
    for p in b:
        k = (p["name"].lower(), p["price"])
        if k in idx:
            for f in ("category", "description", "image"):
                if not idx[k][f] and p[f]:
                    idx[k][f] = p[f]
            if not idx[k]["images"] and p["images"]:
                idx[k]["images"] = p["images"]
        else:
            idx[k] = p; a.append(p)
    return a[:MAX_PRODUCTS]


def _next_pages(html, url):
    """Links de paginación reales de la página (rel=next, ?page=N, ?pagina=N) dentro del mismo sitio."""
    soup, host, out = BeautifulSoup(html, "html.parser"), urlparse(url).hostname, []
    for a in soup.select('a[rel~="next"], link[rel~="next"], a[href*="page="], a[href*="pagina="], a[href*="p="]'):
        u = urljoin(url, a.get("href") or "")
        q = parse_qs(urlparse(u).query)
        if urlparse(u).hostname == host and any(k in q for k in ("page", "pagina", "p")) and u not in out:
            out.append(u)
    return out


def _paginate(url, html, products):
    """Pide las páginas siguientes mientras aporten productos nuevos: primero los links que declara la página,
    después ?page=2, 3… (con tope de páginas y de tiempo, para no colgar la importación)."""
    import time
    t0, seen, queue = time.monotonic(), {url}, _next_pages(html, url)
    n, empty = 1, 0
    while len(products) < MAX_PRODUCTS and n < MAX_PAGES and time.monotonic() - t0 < MAX_SECONDS:
        if queue:
            nxt = queue.pop(0)
        else:
            sep = "&" if "?" in url else "?"
            nxt = f"{url}{sep}page={n + 1}"
        if nxt in seen:
            n += 1; continue
        seen.add(nxt); n += 1
        try:
            body, resp = _get(nxt, check_host=True, accept="text/html,application/xhtml+xml", max_bytes=MAX_HTML)
        except ScrapeError:
            break
        page = body.decode(resp.encoding or resp.apparent_encoding or "utf-8", errors="replace")
        before = len(products)
        _, more = extract_products(page, resp.url or nxt)
        _merge(products, more)
        for u in _next_pages(page, resp.url or nxt):
            if u not in seen and u not in queue:
                queue.append(u)
        empty = 0 if len(products) > before else empty + 1
        if empty >= 1 and not queue:          # una página sin nada nuevo y sin más links: se terminó (o el sitio ignora ?page=)
            break
    return products


def scrape_store(raw_url):
    """Punto de entrada: URL pública → {store, source_url, products}. Lanza ScrapeError con mensaje listo para mostrar."""
    url = validate_url(raw_url)
    body, resp = _get(url, check_host=True, accept="text/html,application/xhtml+xml", max_bytes=MAX_HTML)
    html = body.decode(resp.encoding or resp.apparent_encoding or "utf-8", errors="replace")
    store, products = extract_products(html, resp.url or url)
    if products:
        products = _paginate(resp.url or url, html, products)
    if not products:
        raise ScrapeError("no_products",
                          "No encontramos productos en esa página. Verificá que sea el link del catálogo (no de la página principal) "
                          "y que tenga productos publicados. Si el link es correcto, es posible que Treinta cargue los productos "
                          "desde otra dirección interna y haya que ajustar el importador.", 422)
    return {"store": store, "source_url": url, "products": products}


# ------------------------------------------------------------------ imágenes (al guardar)
def fetch_image_as_data_uri(url, max_side=800, quality=78):
    """Descarga una foto (solo IPs públicas), la reduce a JPEG y la devuelve como data URI, igual que las fotos subidas a mano."""
    from PIL import Image
    body, resp = _get(url, check_host=False, accept="image/*", max_bytes=MAX_IMG)
    if not (resp.headers.get("Content-Type", "").lower().startswith("image/")):
        raise ScrapeError("bad_image", "No es una imagen.")
    try:
        im = Image.open(BytesIO(body))
        im.load()
    except Exception:
        raise ScrapeError("bad_image", "Imagen ilegible.")
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA"); bg = Image.new("RGB", im.size, "white"); bg.paste(im, mask=im.split()[-1]); im = bg
    else:
        im = im.convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = BytesIO(); im.save(buf, "JPEG", quality=quality, optimize=True)
    import base64
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
