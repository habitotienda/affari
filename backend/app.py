import base64, hashlib, io, json, os, re, threading, time
from typing import Optional
from fastapi import FastAPI, HTTPException, Depends, Header, Request, Query
from fastapi.responses import FileResponse, Response, JSONResponse
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
import database as db
import auth_handler as auth
import reports, exporters, operations as ops, ai_agent, hours as hrs, google_auth, billing

load_dotenv()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
app = FastAPI(title="Affari API")
app.add_middleware(GZipMiddleware, minimum_size=700)      # los JSON (listados, reportes) viajan comprimidos

@app.middleware("http")
async def server_timing(request, call_next):
    """Cabecera Server-Timing: en el navegador (F12 > Network > Timing) se ve cuánto tardó el servidor en cada pedido, para separar «base de datos lenta» de «red lenta»."""
    t0 = time.perf_counter()
    resp = await call_next(request)
    resp.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - t0) * 1000:.0f}"
    return resp

db.init_db()
with db.conn() as _c:
    billing.migrate(_c)

DEFAULT_TPL = ("Hola {cliente}! Te escribimos de {negocio}. Tenés un saldo pendiente de {saldo}. "
               "¿Cuándo podés acercarte o transferirnos? ¡Gracias!")
METHODS = ops.PAY_METHODS            # Efectivo, Transferencia, Tarjeta
DEFAULT_THEME = {"bg": "#F8FAFC", "accent": "#10B981", "text": "#0F172A", "title": "", "description": "", "banner": "",
                 "font": "modern", "radius": "round", "cols": 2, "open": True, "delivery": False, "optPickup": True, "optDelivery": False,
                 # Editor visual (parte 3)
                 "pattern": "none", "patColor": "", "patOpacity": 24, "patAnimate": True,
                 "headColor": "", "priceColor": "", "cardColor": "",
                 "cardStyle": "solid", "logoShape": "rounded", "heroAlign": "left", "addLabel": "Agregar", "footer": "",
                 # Imágenes propias del comercio (p. ej. hechas en Canva): fondo, portada y banners promocionales
                 "patSpeed": 2, "bgImg": "", "bgImgMode": "cover", "bgImgDim": 35, "coverImg": "", "coverDim": 30, "promos": []}
PATTERNS = ("none", "dots", "grid", "diagonal", "scales", "grain", "bubbles", "aurora", "mesh", "sparkles", "waves")
MAX_PROMOS = 5
MAX_THEME_IMG = 1_600_000          # caracteres base64 por imagen (≈1,2 MB); el navegador ya las reduce antes de enviarlas
MEDIA_KEYS = ("bgImg", "coverImg")
DESIGN_URL = re.compile(r"^/assets/designs/[a-z0-9-]{1,40}\.svg$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
IMG = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$")

def _keep_img(v, old):
    """Imagen del tema: una imagen nueva (data:image/…) se acepta; la URL /api/media/… que devuelve la API significa «dejar la que ya estaba»."""
    if isinstance(v, str) and v.startswith("data:"):
        if len(v) > MAX_THEME_IMG or not IMG.match(v):
            raise HTTPException(400, "Las imágenes del catálogo deben ser PNG, JPG o WebP y pesar menos de 1,2 MB.")
        return v
    if isinstance(v, str) and DESIGN_URL.match(v):          # diseño incluido en la app (galería)
        return v
    if isinstance(v, str) and v.startswith("/api/media/") and isinstance(old, str) and old.startswith("data:"):
        return old
    return ""

def clean_theme(t, old=None):
    """Valida el diseño del catálogo: solo valores conocidos, nunca HTML/CSS libre. `old` = tema ya guardado (para conservar imágenes sin reenviarlas)."""
    old = old or {}
    o = dict(DEFAULT_THEME)
    for k in ("bg", "accent", "text"):
        if isinstance(t.get(k), str) and HEX.match(t[k]):
            o[k] = t[k].lower()
    for k, n in (("title", 80), ("description", 300), ("banner", 140)):
        o[k] = str(t.get(k) or "").strip()[:n]
    if t.get("font") in ("modern", "classic", "tech"): o["font"] = t["font"]
    if t.get("radius") in ("sharp", "round", "industrial"): o["radius"] = t["radius"]
    if t.get("cols") in (1, 2): o["cols"] = t["cols"]
    for k in ("open", "delivery", "patAnimate"):
        o[k] = bool(t.get(k, o[k]))
    # Formas de entrega que ofrece el comercio. Siempre queda al menos una (si apaga las dos, se mantiene el retiro).
    o["optPickup"] = bool(t.get("optPickup", True))
    o["optDelivery"] = bool(t.get("optDelivery", False))
    if not o["optPickup"] and not o["optDelivery"]:
        o["optPickup"] = True
    # Colores opcionales: "" = automático
    for k in ("patColor", "headColor", "priceColor", "cardColor"):
        v = t.get(k)
        o[k] = v.lower() if isinstance(v, str) and HEX.match(v) else ""
    if t.get("pattern") in PATTERNS: o["pattern"] = t["pattern"]
    try:
        o["patOpacity"] = max(8, min(60, int(t.get("patOpacity", o["patOpacity"]))))
    except (TypeError, ValueError):
        pass
    for k, allowed in (("cardStyle", ("solid", "glass", "outline", "soft")), ("logoShape", ("rounded", "circle", "square")), ("heroAlign", ("left", "center"))):
        if t.get(k) in allowed: o[k] = t[k]
    if t.get("patSpeed") in (1, 2, 3): o["patSpeed"] = t["patSpeed"]
    if t.get("bgImgMode") in ("cover", "tile"): o["bgImgMode"] = t["bgImgMode"]
    for k, lo, hi in (("bgImgDim", 0, 85), ("coverDim", 0, 70)):
        try:
            o[k] = max(lo, min(hi, int(t.get(k, o[k]))))
        except (TypeError, ValueError):
            pass
    for k in MEDIA_KEYS:
        o[k] = _keep_img(t.get(k), old.get(k))
    old_p = old.get("promos") if isinstance(old.get("promos"), list) else []
    raw_p = t.get("promos") if isinstance(t.get("promos"), list) else []
    o["promos"] = [x for x in (_keep_img(v, _promo_old(v, old_p)) for v in raw_p[:MAX_PROMOS]) if x]
    o["addLabel"] = str(t.get("addLabel") or "").strip()[:16] or "Agregar"
    o["footer"] = str(t.get("footer") or "").strip()[:160]
    return o

MEDIA_URL = re.compile(r"^/api/media/\d+/(bgImg|coverImg|p\d)\?v=[0-9a-f]{0,12}$")

def _promo_old(v, old_p):
    """Un banner ya guardado llega como /api/media/<tienda>/p<n>?v=…: busca la imagen original por su posición."""
    m = re.match(r"^/api/media/\d+/p(\d)\?v=", v) if isinstance(v, str) else None
    return old_p[int(m.group(1))] if m and int(m.group(1)) < len(old_p) else None

def _vers(data):
    return hashlib.md5(data.encode()).hexdigest()[:8]

def theme_view(theme, store_id):
    """El tema que viaja al navegador: las imágenes (base64) se reemplazan por URLs cacheables /api/media/…, así la página no carga megas de JSON."""
    o = dict(theme)
    for k in MEDIA_KEYS:
        if str(o.get(k) or "").startswith("data:"):
            o[k] = f"/api/media/{store_id}/{k}?v={_vers(o[k])}"
    o["promos"] = [f"/api/media/{store_id}/p{i}?v={_vers(v)}" if str(v).startswith("data:") else v for i, v in enumerate(o.get("promos") or [])]
    return o

def parse_theme(raw):
    try:
        saved = json.loads(raw or "{}")
        t = {**DEFAULT_THEME, **saved}
        if "optDelivery" not in saved:        # catálogos anteriores: el envío seguía al interruptor viejo «delivery»
            t["optDelivery"] = bool(saved.get("delivery"))
        return t
    except ValueError:
        return dict(DEFAULT_THEME)

def parse_images(raw):
    try:
        return json.loads(raw or "[]")
    except ValueError:
        return []

# ---------- Modelos ----------
class RegisterIn(BaseModel):
    name: str; business: str; business_type: str; email: str; password: str; phone: str

class LoginIn(BaseModel):
    identifier: str; password: str

class ProductIn(BaseModel):
    name: str; description: str = ""; price: float = 0; cost: float = 0
    stock: int = 0; min_stock: int = 5; active: bool = True
    category: str = ""; images: list[str] = []

class SaleIn(BaseModel):
    concept: str = ""; amount: Optional[float] = None; method: str = "Efectivo"
    kind: str = "entrada"; product_id: Optional[int] = None; qty: int = 1; variant_id: Optional[int] = None

class FiadoIn(BaseModel):
    client_id: Optional[int] = None; name: str = ""; phone: str = ""
    amount: Optional[float] = None; concept: str = ""; product_id: Optional[int] = None; qty: int = 1; variant_id: Optional[int] = None

class PayIn(BaseModel):
    amount: float; method: str = "Efectivo"

class StockIn(BaseModel):
    qty: int

class DesignIn(BaseModel):
    theme: dict; logo: Optional[str] = None  # logo: None = sin cambios, "" = quitar

class StoreIn(BaseModel):
    name: str; type: str; slug: str; reminder_tpl: str = ""

# ---------- Auth ----------
def load_user(c, uid, logo=False):
    """El logo (base64, hasta 300 KB) solo se trae cuando de verdad se devuelve al navegador: no en cada request autenticado."""
    u = c.execute(f"""SELECT u.id, u.name, u.email, u.phone, s.id AS store_id, s.name AS business, s.type AS business_type,
                            s.slug, s.reminder_tpl, s.theme, s.hours, u.created_at, u.plan, u.plan_expires_at, u.trial_ends_at, {"s.logo" if logo else "NULL"} AS logo FROM users u JOIN stores s ON s.user_id = u.id WHERE u.id = ?""", (uid,)).fetchone()
    if not u:
        return None
    u = dict(u); u["reminder_tpl"] = u["reminder_tpl"] or DEFAULT_TPL
    u["billing"] = billing.access(u)          # plan efectivo: VIP / pago / prueba / gratis
    u["theme"] = parse_theme(u["theme"])
    u["hours"] = hrs.parse_hours(u["hours"])
    return u

def public_user(u):
    return {**{k: u[k] for k in ("id", "name", "email", "phone", "business", "business_type", "slug", "reminder_tpl", "logo", "hours")}, "theme": theme_view(u["theme"], u["store_id"]), "billing": u["billing"]}

_ucache, _ucache_lock, USER_TTL = {}, threading.Lock(), 20

def forget_user(uid):
    with _ucache_lock:
        _ucache.pop(uid, None)

def current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "No autenticado")
    uid = auth.decode_token(authorization[7:])
    if not uid:
        raise HTTPException(401, "Tu sesión venció. Ingresá de nuevo.")
    now = time.time()
    with _ucache_lock:
        hit = _ucache.get(uid)
    if hit and now - hit[0] < USER_TTL:          # evita una consulta a la base por cada request del mismo usuario
        return dict(hit[1])
    with db.conn() as c:
        u = load_user(c, uid)
    if not u:
        raise HTTPException(401, "Usuario inexistente")
    with _ucache_lock:
        if len(_ucache) > 500: _ucache.clear()
        _ucache[uid] = (now, u)
    return dict(u)

@app.middleware("http")
async def paywall(request, call_next):
    """Bloqueo de funciones avanzadas en el servidor (el candado del navegador es solo cosmético): responde 402 si el plan no las incluye."""
    feature = billing.gate_for(request.url.path) if request.method != "OPTIONS" else None
    if feature:
        try:
            u = await run_in_threadpool(current_user, request.headers.get("authorization"))
        except HTTPException:
            return await call_next(request)        # sin sesión válida: el endpoint responde su 401 de siempre
        if not billing.allows(u["billing"], feature):
            return JSONResponse({"detail": billing.LOCK_MSG}, status_code=402)
    return await call_next(request)

@app.post("/api/register")
def register(d: RegisterIn):
    if not d.name.strip() or not d.business.strip():
        raise HTTPException(400, "Completá tu nombre y el nombre del negocio.")
    if len(d.password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres.")
    if "@" not in d.email:
        raise HTTPException(400, "Ingresá un email válido.")
    phone = re.sub(r"\D", "", d.phone or "")
    if not 8 <= len(phone) <= 15:
        raise HTTPException(400, "El teléfono / WhatsApp es obligatorio. Ingresalo con código de área.")
    with db.conn() as c:
        if c.execute("SELECT 1 FROM users WHERE email = ? OR substr(phone, -10) = substr(?, -10)", (d.email.lower(), phone)).fetchone():
            raise HTTPException(409, "Ya existe una cuenta con ese email o teléfono.")
        uid = c.execute("INSERT INTO users(name,email,phone,password_hash,trial_ends_at) VALUES (?,?,?,?,?)",
                        (d.name.strip(), d.email.lower(), phone, auth.hash_password(d.password), billing.trial_end_str())).lastrowid
        c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (?,?,?,?)",
                  (uid, d.business.strip(), d.business_type, db.unique_slug(c, d.business)))
        user = public_user(load_user(c, uid, logo=True))
    return {"token": auth.create_token(uid), "user": user}

@app.post("/api/login")
def login(d: LoginIn):
    ident = d.identifier.strip().lower()
    with db.conn() as c:
        u = c.execute("SELECT id, password_hash FROM users WHERE email = ? OR substr(phone, -10) = substr(?, -10)",
                      (ident, re.sub(r"\D", "", d.identifier) or "-")).fetchone()
        if not u or not auth.verify_password(d.password, u["password_hash"]):
            raise HTTPException(401, "Email, teléfono o contraseña incorrectos.")
        user = public_user(load_user(c, u["id"], logo=True))
    return {"token": auth.create_token(u["id"]), "user": user}

@app.get("/api/me")
def me(u=Depends(current_user)):
    with db.conn() as c:
        return public_user(load_user(c, u["id"], logo=True))

@app.put("/api/store")
def update_store(d: StoreIn, u=Depends(current_user)):
    slug = d.slug.strip().lower()
    if not d.name.strip():
        raise HTTPException(400, "El negocio necesita un nombre.")
    if not re.fullmatch(r"[a-z0-9-]{3,40}", slug):
        raise HTTPException(400, "El enlace solo puede tener letras minúsculas, números y guiones (3 a 40).")
    with db.conn() as c:
        if c.execute("SELECT 1 FROM stores WHERE slug=? AND id<>?", (slug, u["store_id"])).fetchone():
            raise HTTPException(409, "Ese enlace ya está en uso. Probá con otro.")
        c.execute("UPDATE stores SET name=?, type=?, slug=?, reminder_tpl=? WHERE id=?",
                  (d.name.strip(), d.type, slug, d.reminder_tpl.strip() or None, u["store_id"]))
        forget_user(u["id"])
        return public_user(load_user(c, u["id"], logo=True))

@app.put("/api/store/design")
def save_design(d: DesignIn, u=Depends(current_user)):
    with db.conn() as c:
        row = c.execute("SELECT theme FROM stores WHERE id=?", (u["store_id"],)).fetchone()
    theme = json.dumps(clean_theme(d.theme, parse_theme(row["theme"] if row else None)))
    if d.logo and (len(d.logo) > 300_000 or not IMG.match(d.logo)):
        raise HTTPException(400, "El logo debe ser una imagen PNG, JPG o WebP de hasta 300 KB.")
    with db.conn() as c:
        if d.logo is None:
            c.execute("UPDATE stores SET theme=? WHERE id=?", (theme, u["store_id"]))
        else:
            c.execute("UPDATE stores SET theme=?, logo=? WHERE id=?", (theme, d.logo or None, u["store_id"]))
        forget_user(u["id"])
        return public_user(load_user(c, u["id"], logo=True))

class HoursIn(BaseModel):
    hours: dict

@app.put("/api/store/hours")
def save_hours(d: HoursIn, u=Depends(current_user)):
    """Horarios de atención: días y franjas (apertura/cierre). La tienda pública calcula «Abierto ahora / Cerrado» con esto."""
    try:
        h = hrs.clean_hours(d.hours)
    except ValueError as e:
        raise HTTPException(400, str(e))
    with db.conn() as c:
        c.execute("UPDATE stores SET hours=? WHERE id=?", (json.dumps(h), u["store_id"]))
        forget_user(u["id"])
        return public_user(load_user(c, u["id"], logo=True))

# ---------- Dashboard y caja ----------
@app.get("/api/dashboard")
def dashboard(u=Depends(current_user)):
    sid = u["store_id"]
    day = "date(created_at) = date('now','localtime')"
    sale = f"kind IN ('entrada','fiado') AND is_payment=0 AND {day}"
    flow = lambda m: f"SUM(CASE WHEN {day} AND method='{m}' THEN (CASE WHEN kind='entrada' THEN amount WHEN kind='salida' THEN -amount ELSE 0 END) ELSE 0 END)"
    with db.conn() as c:
        # Una sola consulta con todos los números: cada ida y vuelta a Supabase cuesta, así que se juntan
        k = c.execute(f"""SELECT SUM(CASE WHEN {sale} THEN amount ELSE 0 END), SUM(CASE WHEN {sale} THEN 1 ELSE 0 END),
                                 {flow('Efectivo')}, {flow('Transferencia')}, {flow('Tarjeta')}, SUM(CASE WHEN {sale} THEN amount-cost ELSE 0 END),
                                 (SELECT SUM(balance) FROM clients WHERE store_id=?), (SELECT COUNT(*) FROM clients WHERE store_id=? AND balance>0),
                                 (SELECT SUM(balance) FROM suppliers WHERE store_id=?)
                          FROM sales WHERE store_id=?""", (sid, sid, sid, sid)).fetchone()
        moves = [dict(r) for r in c.execute("SELECT id,kind,concept,amount,method,created_at FROM sales WHERE store_id=? ORDER BY id DESC LIMIT 8", (sid,))]
        low = ops.low_stock(c, sid, 6)
    n = lambda v: v or 0
    return {"kpis": {"sales_today": n(k[0]), "sales_count": int(n(k[1])), "cash": n(k[2]), "transfer": n(k[3]), "card": n(k[4]), "payable": n(k[8]),
                     "fiados": n(k[6]), "fiados_clients": int(n(k[7])), "profit": n(k[5])},
            "movements": moves, "low_stock": low}

take_product = ops.take_product      # descuenta stock del producto o de su variante

@app.get("/api/sales")
def list_sales(limit: int = 100, u=Depends(current_user)):
    with db.conn() as c:
        rows = c.execute("SELECT id,kind,concept,amount,method,is_payment,created_at FROM sales WHERE store_id=? ORDER BY id DESC LIMIT ?",
                         (u["store_id"], min(max(limit, 1), 500))).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/sales")
def add_sale(d: SaleIn, u=Depends(current_user)):
    if d.kind not in ("entrada", "salida") or d.method not in METHODS:
        raise HTTPException(400, "Tipo de movimiento o medio de pago inválido.")
    concept, amount, cost, item = d.concept.strip(), d.amount, 0, (None, None, 0)
    with db.conn() as c:
        if d.product_id and d.kind == "entrada":
            p, cost = take_product(c, u["store_id"], d.product_id, d.qty, d.variant_id)
            item = (p["id"], p["name"], d.qty)
            amount = amount or p["price"] * d.qty
            concept = concept or f"{d.qty} × {p['label']}"
        if not amount or amount <= 0:
            raise HTTPException(400, "El monto debe ser mayor a cero.")
        c.execute("INSERT INTO sales(store_id,kind,concept,amount,cost,method,product_id,product_name,qty) VALUES (?,?,?,?,?,?,?,?,?)",
                  (u["store_id"], d.kind, concept or ("Venta" if d.kind == "entrada" else "Gasto"), amount, cost, d.method, *item))
    return {"ok": True}

# ---------- Fiados ----------
@app.get("/api/clients")
def list_clients(u=Depends(current_user)):
    with db.conn() as c:
        rows = c.execute("""SELECT cl.id, cl.name, cl.phone, cl.balance, cl.email, cl.cuit, cl.address, cl.notes,
                            (SELECT MAX(created_at) FROM sales s WHERE s.client_id = cl.id) AS last_move
                            FROM clients cl WHERE cl.store_id=? ORDER BY cl.balance DESC, cl.name""", (u["store_id"],)).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/fiados")
def add_fiado(d: FiadoIn, u=Depends(current_user)):
    sid, phone = u["store_id"], re.sub(r"\D", "", d.phone or "")
    with db.conn() as c:
        cl = c.execute("SELECT * FROM clients WHERE id=? AND store_id=?", (d.client_id, sid)).fetchone() if d.client_id else None
        if not cl:
            if not d.name.strip():
                raise HTTPException(400, "Indicá el nombre del cliente.")
            if not 8 <= len(phone) <= 15:
                raise HTTPException(400, "El teléfono / WhatsApp del cliente es obligatorio para el recordatorio de cobro.")
            cid = c.execute("INSERT INTO clients(store_id,name,phone) VALUES (?,?,?)", (sid, d.name.strip(), phone)).lastrowid
            cl = c.execute("SELECT * FROM clients WHERE id=?", (cid,)).fetchone()
        elif phone and phone != cl["phone"]:
            c.execute("UPDATE clients SET phone=? WHERE id=?", (phone, cl["id"]))
        amount, cost, concept, item = d.amount, 0, d.concept.strip(), (None, None, 0)
        if d.product_id:
            p, cost = take_product(c, sid, d.product_id, d.qty, d.variant_id)
            item = (p["id"], p["name"], d.qty)
            amount = amount or p["price"] * d.qty
            concept = concept or f"{d.qty} × {p['label']}"
        if not amount or amount <= 0:
            raise HTTPException(400, "El monto debe ser mayor a cero.")
        c.execute("UPDATE clients SET balance = balance + ? WHERE id=?", (amount, cl["id"]))
        c.execute("INSERT INTO sales(store_id,client_id,kind,concept,amount,cost,method,product_id,product_name,qty) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (sid, cl["id"], "fiado", f"Fiado: {cl['name']}" + (f" ({concept})" if concept else ""), amount, cost, "Fiado", *item))
    return {"ok": True}

@app.post("/api/clients/{cid}/pay")
def pay_fiado(cid: int, d: PayIn, u=Depends(current_user)):
    if d.method not in METHODS:
        raise HTTPException(400, "Medio de pago inválido.")
    with db.conn() as c:
        cl = c.execute("SELECT * FROM clients WHERE id=? AND store_id=?", (cid, u["store_id"])).fetchone()
        if not cl:
            raise HTTPException(404, "Cliente inexistente.")
        if d.amount <= 0 or d.amount > cl["balance"] + 0.005:
            raise HTTPException(400, "El monto debe ser mayor a cero y no superar la deuda.")
        c.execute("UPDATE clients SET balance = MAX(balance - ?, 0) WHERE id=?", (d.amount, cid))
        c.execute("INSERT INTO sales(store_id,client_id,kind,concept,amount,method,is_payment) VALUES (?,?,?,?,?,?,1)",
                  (u["store_id"], cid, "entrada", f"Cobro fiado: {cl['name']}", d.amount, d.method))
    return {"ok": True}

# ---------- Productos / inventario / catálogo ----------
def check_product(d: ProductIn):
    if not d.name.strip():
        raise HTTPException(400, "El producto necesita un nombre.")
    if d.price < 0 or d.cost < 0 or d.stock < 0 or d.min_stock < 0:
        raise HTTPException(400, "Precio, costo y stock no pueden ser negativos.")
    if len(d.images) > 5:
        raise HTTPException(400, "Cada producto admite hasta 5 imágenes.")
    if any(not IMG_URL.match(i) and (len(i) > 450_000 or not IMG.match(i)) for i in d.images):
        raise HTTPException(400, "Las imágenes deben ser PNG, JPG o WebP y pesar menos de 450 KB cada una.")

IMG_URL = re.compile(r"^/api/img/(\d+)/(\d+)\?v=[0-9a-f]{0,12}$")

def img_url(pid, i, v):
    return f"/api/img/{pid}/{i}?v={v}"

def resolve_images(c, sid, pid, images):
    """El navegador devuelve las fotos que ya tenía como URL (no las reenvía en base64): se reemplazan por lo guardado. Las nuevas llegan como data URL."""
    stored = None
    out = []
    for i in images:
        m = IMG_URL.match(i)
        if not m:
            out.append(i); continue
        if pid is None or int(m.group(1)) != pid:
            continue
        if stored is None:
            r = c.execute("SELECT images FROM products WHERE id=? AND store_id=?", (pid, sid)).fetchone()
            stored = parse_images(r["images"]) if r else []
        k = int(m.group(2))
        if k < len(stored): out.append(stored[k])
    return out

def save_meta(c, pid, imgs):
    n, v = db.img_meta(imgs)
    c.execute("UPDATE products SET img_n=?, img_v=? WHERE id=?", (n, v, pid))

@app.get("/api/products")
def list_products(u=Depends(current_user)):
    with db.conn() as c:
        rows = c.execute("SELECT id,store_id,name,description,price,cost,stock,min_stock,active,category,img_n,img_v FROM products WHERE store_id=? ORDER BY name COLLATE NOCASE", (u["store_id"],)).fetchall()
        out = ops.attach_variants(c, [{**{k: v for k, v in dict(r).items() if k not in ("img_n", "img_v")}, "active": bool(r["active"]),
                                       "images": [img_url(r["id"], i, r["img_v"]) for i in range(r["img_n"])]} for r in rows])
    return out

@app.get("/api/img/{pid}/{i}")
def product_image(pid: int, i: int, v: str = ""):
    """Foto de producto como archivo cacheable (la URL incluye la versión, así que el navegador la baja una sola vez)."""
    with db.conn() as c:
        r = c.execute("SELECT images, img_v FROM products WHERE id=?", (pid,)).fetchone()
    imgs = parse_images(r["images"]) if r else []
    if not r or v != r["img_v"] or not 0 <= i < len(imgs):
        raise HTTPException(404, "Imagen inexistente.")
    m = re.match(r"^data:(image/[a-z]+);base64,(.+)$", imgs[i], re.S)
    if not m:
        raise HTTPException(404, "Imagen inexistente.")
    return Response(base64.b64decode(m.group(2)), media_type=m.group(1), headers={"Cache-Control": "public, max-age=31536000, immutable"})

@app.post("/api/products")
def create_product(d: ProductIn, u=Depends(current_user)):
    check_product(d)
    imgs = [i for i in d.images if not IMG_URL.match(i)]
    with db.conn() as c:
        billing.check_product_limit(c, u)         # plan gratis: hasta 50 productos
        pid = c.execute("INSERT INTO products(store_id,name,description,price,cost,stock,min_stock,active,category,images) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (u["store_id"], d.name.strip(), d.description.strip(), d.price, d.cost, d.stock, d.min_stock, int(d.active), d.category.strip()[:40], json.dumps(imgs))).lastrowid
        save_meta(c, pid, imgs)
    return {"id": pid}

@app.put("/api/products/{pid}")
def update_product(pid: int, d: ProductIn, u=Depends(current_user)):
    check_product(d)
    with db.conn() as c:
        imgs = resolve_images(c, u["store_id"], pid, d.images)
        n = c.execute("UPDATE products SET name=?,description=?,price=?,cost=?,stock=?,min_stock=?,active=?,category=?,images=? WHERE id=? AND store_id=?",
                      (d.name.strip(), d.description.strip(), d.price, d.cost, d.stock, d.min_stock, int(d.active), d.category.strip()[:40], json.dumps(imgs), pid, u["store_id"])).rowcount
        if n:
            save_meta(c, pid, imgs)
            ops.sync_variant_stock(c, pid)     # con variantes, el stock total es la suma de ellas
    if not n:
        raise HTTPException(404, "Producto inexistente.")
    return {"ok": True}

@app.delete("/api/products/{pid}")
def delete_product(pid: int, u=Depends(current_user)):
    with db.conn() as c:
        c.execute("DELETE FROM products WHERE id=? AND store_id=?", (pid, u["store_id"]))
    return {"ok": True}

@app.post("/api/products/{pid}/stock")
def add_stock(pid: int, d: StockIn, u=Depends(current_user)):
    if d.qty < 1:
        raise HTTPException(400, "Ingresá una cantidad mayor a cero.")
    with db.conn() as c:
        if ops.has_variants(c, pid):
            raise HTTPException(400, "Este producto tiene variantes: ingresá el stock en cada variante.")
        n = c.execute("UPDATE products SET stock = stock + ? WHERE id=? AND store_id=?", (d.qty, pid, u["store_id"])).rowcount
        row = c.execute("SELECT stock FROM products WHERE id=?", (pid,)).fetchone()
    if not n:
        raise HTTPException(404, "Producto inexistente.")
    return {"stock": row["stock"]}

# ---------- Estadísticas y reportes ----------
def _report(u, date_from, date_to):
    try:
        d1, d2 = reports.parse_range(date_from, date_to)
    except ValueError as e:
        raise HTTPException(400, str(e))
    with db.conn() as c:
        return reports.build(c, u["store_id"], d1, d2)

@app.get("/api/reports")
def report_json(date_from: Optional[str] = Query(None, alias="from"), date_to: Optional[str] = Query(None, alias="to"), u=Depends(current_user)):
    return _report(u, date_from, date_to)

@app.get("/api/reports/export.{fmt}")
def report_export(fmt: str, date_from: Optional[str] = Query(None, alias="from"), date_to: Optional[str] = Query(None, alias="to"), u=Depends(current_user)):
    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(404, "Formato no disponible.")
    r = _report(u, date_from, date_to)
    data, mime = (exporters.to_xlsx(r, u["business"]), exporters.XLSX_MIME) if fmt == "xlsx" else (exporters.to_pdf(r, u["business"]), "application/pdf")
    name = f'affari-balance-{r["period"]["from"]}_{r["period"]["to"]}.{fmt}'
    return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})

# ---------- Catálogo público (sin login) ----------
def find_store(c, slug):
    s = c.execute("SELECT s.id, s.name, s.type, s.theme, s.logo, s.hours, u.phone FROM stores s JOIN users u ON u.id = s.user_id WHERE s.slug=?", (slug,)).fetchone()
    if not s:
        raise HTTPException(404, "Este catálogo no existe.")
    return s

@app.get("/api/public/{slug}")
def public_catalog(slug: str):
    with db.conn() as c:
        s = find_store(c, slug)
        ob = billing.owner_access(c, s["id"])
        if not ob or not billing.allows(ob, "catalog"):
            raise HTTPException(404, "Este catálogo no está disponible por ahora.")      # dueño en plan gratis: el catálogo público se apaga
        prods = c.execute("SELECT id,name,description,price,stock,category,img_n,img_v FROM products WHERE store_id=? AND active=1 ORDER BY name COLLATE NOCASE", (s["id"],)).fetchall()
    return {"server_now": int(time.time() * 1000),        # hora del servidor: el navegador corrige un reloj mal puesto al calcular «Abierto ahora»
            "store": {"name": s["name"], "type": s["type"], "phone": s["phone"], "logo": s["logo"], "hours": hrs.parse_hours(s["hours"]), "theme": theme_view(parse_theme(s["theme"]), s["id"])},
            "products": [{**{k: v for k, v in dict(p).items() if k not in ("img_n", "img_v")}, "images": [img_url(p["id"], i, p["img_v"]) for i in range(p["img_n"])]} for p in prods]}

@app.get("/api/media/{sid}/{key}")
def store_media(sid: int, key: str, v: str = ""):
    """Fondo, portada o banner del catálogo como archivo (la URL lleva la versión: el navegador lo guarda 1 año)."""
    with db.conn() as c:
        r = c.execute("SELECT theme FROM stores WHERE id=?", (sid,)).fetchone()
    th = parse_theme(r["theme"]) if r else {}
    if key in MEDIA_KEYS:
        data = th.get(key)
    else:
        m = re.match(r"^p(\d)$", key)
        ps = th.get("promos") or []
        data = ps[int(m.group(1))] if m and int(m.group(1)) < len(ps) else None
    m = re.match(r"^data:(image/[a-z]+);base64,(.+)$", data or "", re.S)
    if not m:
        raise HTTPException(404, "Imagen inexistente.")
    return Response(base64.b64decode(m.group(2)), media_type=m.group(1), headers={"Cache-Control": "public, max-age=31536000, immutable"})

@app.get("/api/public/{slug}/qr.svg")
def public_qr(slug: str, request: Request):
    import segno
    with db.conn() as c:
        find_store(c, slug)
    buf = io.BytesIO()
    segno.make(f"{str(request.base_url).rstrip('/')}/c/{slug}", error="m").save(buf, kind="svg", scale=8, border=2, dark="#0F172A", xmldecl=False)
    return Response(buf.getvalue(), media_type="image/svg+xml")

app.include_router(google_auth.make_router(load_user, public_user))   # inicio de sesión con Google + /api/config
app.include_router(ops.make_router(current_user))     # parte 5: variantes, proveedores, deudas, caja, comprobantes
app.include_router(billing.make_router(current_user, forget_user, db))   # planes, checkout y webhook de Mercado Pago
app.include_router(ai_agent.make_router(current_user))  # asistente IA (Gemini)

# Archivos estáticos: solo carpetas públicas (nunca la raíz, para no exponer backend/ ni .env)
for folder in ("css", "js", "assets"):
    app.mount(f"/{folder}", StaticFiles(directory=os.path.join(ROOT, folder)), name=folder)

@app.get("/c/{slug}")
def catalog_page(slug: str):
    return FileResponse(os.path.join(ROOT, "catalog.html"))

# PWA: el Service Worker debe servirse desde la raíz para controlar todo el sitio (scope "/")
@app.api_route("/ping", methods=["GET", "HEAD"], include_in_schema=False)
def ping():
    """Health check / keep-alive: no toca la base de datos, responde al instante."""
    return {"status": "ok", "message": "Affari is awake"}

@app.get("/sw.js", include_in_schema=False)
def service_worker():
    return FileResponse(os.path.join(ROOT, "sw.js"), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})

@app.get("/manifest.json", include_in_schema=False)
def web_manifest():
    return FileResponse(os.path.join(ROOT, "manifest.json"), media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})

@app.get("/")
def index():
    return FileResponse(os.path.join(ROOT, "index.html"))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    # Desarrollo local: python app.py (reload solo si DEV=1). En Render se usa gunicorn (ver Procfile / render.yaml).
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=os.getenv("DEV") == "1")
