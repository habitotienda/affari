"""Rendimiento e imágenes: listado liviano con fotos por URL, endpoint de imagen cacheable, edición que conserva fotos,
dashboard en pocas consultas, caché de usuario y herramientas de IA para fotos. Corre con SQLite y sin FastAPI instalado (stubs)."""
import sys, types, os, json, base64, tempfile, io
from types import SimpleNamespace as NS

# --- stubs mínimos de librerías no instaladas en este entorno
sys.modules.setdefault("dotenv", NS(load_dotenv=lambda *a, **k: None))
try:
    import bcrypt  # noqa
except ImportError:
    sys.modules["bcrypt"] = NS(hashpw=lambda p, s: b"x", gensalt=lambda: b"", checkpw=lambda p, h: True)
class HTTPException(Exception):
    def __init__(s, status, detail=""): s.status_code, s.detail = status, detail
class _Router:
    def __init__(s, *a, **k): pass
    def _d(s, *a, **k): return lambda f: f
    get = post = put = delete = _d
    def include_router(s, *a, **k): pass
    def mount(s, *a, **k): pass
    def add_middleware(s, *a, **k): s.mw = a
class Response:
    def __init__(s, content=b"", media_type=None, headers=None): s.content, s.media_type, s.headers = content, media_type, headers or {}
for name, attrs in {
    "fastapi": dict(FastAPI=_Router, APIRouter=_Router, HTTPException=HTTPException, Depends=lambda f: f, Header=lambda *a, **k: None, Request=object, Query=lambda *a, **k: None, Response=Response, UploadFile=object, File=lambda *a, **k: None, Form=lambda *a, **k: None, Body=lambda *a, **k: None),
    "fastapi.responses": dict(FileResponse=object, Response=Response),
    "fastapi.staticfiles": dict(StaticFiles=lambda **k: None),
    "fastapi.middleware": dict(), "fastapi.middleware.gzip": dict(GZipMiddleware=object)}.items():
    m = types.ModuleType(name); m.__dict__.update(attrs); sys.modules[name] = m
try:
    import pydantic  # noqa
except ImportError:
    sys.modules["pydantic"] = NS(BaseModel=object)

tmp = tempfile.mkdtemp(); os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/t.db"; os.environ["GEMINI_API_KEYS"] = "K_TEST_000000000000000001"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import database as db, app as A, ai_agent as ag, auth_handler as auth

def jpeg(w=1600, h=1200, color=(200, 30, 30)):
    from PIL import Image
    b = io.BytesIO(); Image.new("RGB", (w, h), color).save(b, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()
img1, img2, img3 = jpeg(color=(200, 30, 30)), jpeg(color=(30, 200, 30)), jpeg(color=(30, 30, 200))

with db.conn() as c:
    c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('Ana','a@a.com','1155551234','x')")
    c.execute("INSERT INTO stores(user_id,name,type,slug,logo) VALUES (1,'Tienda','Indumentaria','tienda','data:image/png;base64,AAAA')")
u = {"id": 1, "store_id": 1, "business": "Tienda", "business_type": "Indumentaria"}
pd = lambda **k: NS(**{**dict(name="Remera", description="", price=100, cost=40, stock=5, min_stock=2, active=True, category="Ropa", images=[]), **k})

# 1) listado liviano: las fotos salen como URL, no como base64
pid = A.create_product(pd(images=[img1, img2]), u)["id"]
out = A.list_products(u)
assert out[0]["images"] == [f"/api/img/{pid}/0?v={out[0]['images'][0].split('v=')[1]}", f"/api/img/{pid}/1?v={out[0]['images'][1].split('v=')[1]}"], out[0]["images"]
assert len(json.dumps(out)) < 3000, len(json.dumps(out))
v1 = out[0]["images"][0].split("v=")[1]
print("1 OK  (listado sin base64:", len(json.dumps(out)), "bytes)")

# 2) endpoint de imagen: sirve el archivo, cache inmutable, versión incorrecta = 404
r = A.product_image(pid, 0, v1)
assert r.media_type == "image/jpeg" and r.content == base64.b64decode(img1.split(",")[1]) and "immutable" in r.headers["Cache-Control"]
for bad in ((pid, 0, "deadbeef"), (pid, 5, v1), (999, 0, v1)):
    try: A.product_image(*bad); raise SystemExit("debía dar 404")
    except HTTPException as e: assert e.status_code == 404
print("2 OK  (imagen cacheable + 404)")

# 3) editar el producto desde el navegador: las fotos viejas vuelven como URL y se conservan; la nueva llega en base64
cur = A.list_products(u)[0]["images"]
A.update_product(pid, pd(images=[cur[1], img3, f"/api/img/999/0?v={v1}"]), u)      # reordena, agrega y descarta una URL ajena
with db.conn() as c:
    row = c.execute("SELECT images, img_n, img_v FROM products WHERE id=?", (pid,)).fetchone()
assert json.loads(row["images"]) == [img2, img3] and row["img_n"] == 2 and row["img_v"] != v1
try: A.update_product(pid, pd(images=["data:image/jpeg;base64," + "A" * 460_000]), u); raise SystemExit("debía rechazar")
except HTTPException as e: assert e.status_code == 400
print("3 OK  (edición conserva/reordena/agrega fotos y valida tamaño)")

# 4) catálogo público también por URL
pub = A.public_catalog("tienda")
assert pub["products"][0]["images"][0].startswith("/api/img/") and "base64" not in json.dumps(pub["products"])
print("4 OK  (catálogo público por URL)")

# 5) dashboard: números correctos con una sola consulta de ventas
with db.conn() as c:
    c.execute("INSERT INTO sales(store_id,kind,concept,amount,cost,method) VALUES (1,'entrada','v1',1000,400,'Efectivo')")
    c.execute("INSERT INTO sales(store_id,kind,concept,amount,cost,method) VALUES (1,'entrada','v2',500,100,'Tarjeta')")
    c.execute("INSERT INTO sales(store_id,kind,concept,amount,cost,method) VALUES (1,'salida','gasto',200,0,'Efectivo')")
    c.execute("INSERT INTO sales(store_id,kind,concept,amount,cost,method) VALUES (1,'fiado','f',300,100,'Fiado')")
    c.execute("INSERT INTO sales(store_id,kind,concept,amount,cost,method,is_payment) VALUES (1,'entrada','cobro',50,0,'Transferencia',1)")
    c.execute("INSERT INTO clients(store_id,name,phone,balance) VALUES (1,'Cli','1',300)")
    c.execute("INSERT INTO suppliers(store_id,name,balance) VALUES (1,'Prov',70)")
k = A.dashboard(u)["kpis"]
exp = dict(sales_today=1800, sales_count=3, cash=800, transfer=50, card=500, payable=70, fiados=300, fiados_clients=1, profit=1200)
assert k == exp, (k, exp)
empty = A.dashboard({**u, "store_id": 2})["kpis"]; assert all(v == 0 for v in empty.values()), empty
print("5 OK  (dashboard", k["sales_today"], ")")

# 6) usuario autenticado: se cachea y no arrastra el logo; /me sí lo devuelve; editar la tienda invalida la caché
calls = []; orig = A.load_user
A.load_user = lambda c, uid, logo=False: (calls.append(logo), orig(c, uid, logo))[1]
tok = "Bearer " + auth.create_token(1)
a = A.current_user(tok); b = A.current_user(tok)
assert len(calls) == 1 and calls == [False] and a["logo"] is None
assert A.me(a)["logo"] == "data:image/png;base64,AAAA"
A.update_store(NS(name="Tienda 2", type="Kiosco", slug="tienda", reminder_tpl=""), a)
assert A.current_user(tok)["business"] == "Tienda 2"
A.load_user = orig
print("6 OK  (caché de usuario)")

# 7) backfill de productos viejos con fotos
with db.conn() as c:
    c.execute("INSERT INTO products(store_id,name,images) VALUES (1,'Viejo',?)", (json.dumps([img1]),))
    db.backfill_images(c)
    r = c.execute("SELECT img_n, img_v FROM products WHERE name='Viejo'").fetchone()
assert r["img_n"] == 1 and len(r["img_v"]) == 12
print("7 OK  (backfill)")

# 8) IA: foto reducida para el modelo, herramienta para sumar/reemplazar fotos y metadatos coherentes
small = ag._for_model(img1)
assert len(small) < len(img1) and small.startswith("data:image/jpeg")
from PIL import Image
assert max(Image.open(io.BytesIO(base64.b64decode(small.split(",")[1]))).size) <= 768
assert ag._for_model("data:image/jpeg;base64,AAAA") == "data:image/jpeg;base64,AAAA"       # basura: se devuelve igual, sin romper
with db.conn() as c:
    res, ui = ag.t_update_product(c, 1, {"product_id": pid, "add_image_indexes": [0]}, [img1])
    assert res["images_saved"] == 3, res                                                    # tenía 2, suma 1
    res, ui = ag.t_update_product(c, 1, {"product_id": pid, "add_image_indexes": [0], "replace_images": True}, [img1])
    assert res["images_saved"] == 1
    row = c.execute("SELECT images, img_n, img_v FROM products WHERE id=?", (pid,)).fetchone()
    assert json.loads(row["images"]) == [img1] and row["img_n"] == 1 and row["img_v"]
    created, _ = ag.t_create_product(c, 1, {"name": "Con foto", "stock": 3, "price": 10, "image_indexes": [0, 0, 7]}, [img1])
    n = c.execute("SELECT img_n FROM products WHERE id=?", (created["id"],)).fetchone()[0]
    assert created["images_saved"] == 1 and n == 1
    found, _ = ag.t_search_products(c, 1, {"query": "con foto"}, [])
    assert found["products"][0]["images_count"] == 1 and "images" not in found["products"][0]
print("8 OK  (herramientas de IA con fotos)")
print("TODO OK")
