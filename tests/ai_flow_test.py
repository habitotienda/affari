"""Prueba de punta a punta del agente con un Gemini falso (servidor HTTP local) y SQLite."""
import sys, types, os, json, threading, tempfile, base64
from http.server import BaseHTTPRequestHandler, HTTPServer
# --- stubs de librerías no instaladas en este entorno
sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)
fa = types.ModuleType("fastapi")
class HTTPException(Exception):
    def __init__(s, status, detail=""): s.status, s.detail = status, detail
fa.HTTPException = HTTPException; fa.APIRouter = lambda **k: types.SimpleNamespace(post=lambda *a, **k: (lambda f: f), get=lambda *a, **k: (lambda f: f), delete=lambda *a, **k: (lambda f: f))
try:
    import pydantic  # noqa
except ImportError:
    sys.modules["pydantic"] = types.SimpleNamespace(BaseModel=object)
fa.Query = lambda *a, **k: None; fa.Response = object; fa.Depends = lambda f: f; sys.modules["fastapi"] = fa
tmp = tempfile.mkdtemp(); os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/t.db"
os.environ["GEMINI_API_KEYS"] = "KEY_DAILY_EXHAUSTED_000001,KEY_OK_SECOND_00000000002,KEY_THIRD_0000000000000003"
sys.path.insert(0, ""+os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","backend")+"")
import database as db, ai_keys as gk, ai_agent as ag
db.init_db()

SCRIPT = []   # respuestas en orden: cada una es (status, body) y se elige según la clave
CALLS = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        key = self.headers.get("x-goog-api-key"); ok = key.startswith("GOOD")
        self.send_response(200 if ok else 400); self.end_headers()
        self.wfile.write(json.dumps({"models": []} if ok else {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}}).encode())
    def do_POST(self):
        key = self.headers.get("x-goog-api-key"); body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CALLS.append((key, self.path, body))
        if key == "KEY_DAILY_EXHAUSTED_000001":
            self.send_response(429); self.end_headers()
            self.wfile.write(json.dumps({"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota", "details": [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}).encode()); return
        if key == "KEY_THIRD_0000000000000003" and "ONLY_THIRD" not in json.dumps(body):
            pass
        resp = SCRIPT.pop(0) if SCRIPT else {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
        if resp == "quota":
            self.send_response(429); self.end_headers()
            self.wfile.write(json.dumps({"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "rpm", "details": [{"retryDelay": "30s"}]}}).encode()); return
        self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(resp).encode())
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
gk.API = f"http://127.0.0.1:{srv.server_port}/v1beta"

with db.conn() as c:
    c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('Ana','a@a.com','1155551234','x')")
    c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (1,'Tienda','Indumentaria','tienda')")
    c.execute("INSERT INTO products(store_id,name,price,cost,stock,min_stock) VALUES (1,'Buzo gris',32000,10000,3,5)")
    c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (1,'Otra','Kiosco','otra')")
    c.execute("INSERT INTO products(store_id,name,price,stock) VALUES (2,'Ajeno',1,1)")
u = {"store_id": 1, "business": "Tienda", "business_type": "Indumentaria"}
img = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8fakejpeg").decode()
fc = lambda name, args: {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": name, "args": args}, "thoughtSignature": "SIG"}]}}]}
txt = lambda t: {"candidates": [{"content": {"role": "model", "parts": [{"text": t}]}}]}

# 1) crear producto con foto + ajustar stock del existente; la primera clave está agotada -> usa la segunda
SCRIPT += [fc("create_product", {"name": "Remera negra", "stock": 20, "price": 15000, "description": "Remera lisa negra.", "category": "Remeras", "image_indexes": [0]}),
           fc("search_products", {"query": "buzo"}), fc("adjust_stock", {"product_id": 1, "quantity": 10, "mode": "add"}), txt("Listo")]
reply, acts = ag.converse(u, "cargá 20 remeras negras a 15000 y sumale 10 al buzo", [img])
print("reply:", reply, "|", [a["text"] for a in acts])
assert reply == "Listo" and len(acts) == 2 and all(a["ok"] for a in acts)
assert CALLS[0][0] == "KEY_DAILY_EXHAUSTED_000001" and all(k == "KEY_OK_SECOND_00000000002" for k, _, _ in CALLS[1:]), [k for k, _, _ in CALLS]
with db.conn() as c:
    p = c.execute("SELECT * FROM products WHERE name='Remera negra'").fetchone()
    assert p["stock"] == 20 and p["price"] == 15000 and p["active"] == 1 and json.loads(p["images"]) == [img] and p["description"]
    assert c.execute("SELECT stock FROM products WHERE id=1").fetchone()[0] == 13
    assert c.execute("SELECT COUNT(*) FROM ai_messages WHERE store_id=1").fetchone()[0] == 2
# la firma de pensamiento viaja de vuelta
assert any("thoughtSignature" in json.dumps(b["contents"]) for _, _, b in CALLS[2:])
# imagen enviada como inlineData
assert "inlineData" in json.dumps(CALLS[0][2]["contents"])
print("1 OK  (rotación 429 diario + crear + stock + firma + imagen)")

# 2) la clave 1 sigue enfriada: no se vuelve a llamar
n = len(CALLS); SCRIPT.append(txt("hola")); ag.converse(u, "hola", [])
assert all(k != "KEY_DAILY_EXHAUSTED_000001" for k, _, _ in CALLS[n:]); print("2 OK  (clave agotada en enfriamiento)")

# 3) errores de herramienta: duplicado, stock insuficiente, producto de otro negocio, sin variante
SCRIPT += [fc("create_product", {"name": "buzo GRIS", "stock": 1}), fc("adjust_stock", {"product_id": 1, "quantity": 999, "mode": "remove"}),
           fc("adjust_stock", {"product_id": 2, "quantity": 1, "mode": "add"}), txt("errores")]
ag.converse(u, "x", [])
last = [b for _, _, b in CALLS][-1]["contents"]
res = [p["functionResponse"]["response"] for m in last if m["role"] == "user" for p in m["parts"] if "functionResponse" in p][-3:]
print([list(r)[0] for r in res], res[0]["error"][:50])
assert all("error" in r for r in res)
with db.conn() as c:
    assert c.execute("SELECT stock FROM products WHERE id=2").fetchone()[0] == 1 and c.execute("SELECT stock FROM products WHERE id=1").fetchone()[0] == 13
print("3 OK  (duplicados / stock negativo / aislamiento entre negocios)")

# 4) variantes + resumen de ventas + deudores
SCRIPT += [fc("create_product", {"name": "Campera", "stock": 0, "price": 50000, "variants": [{"name": "M", "stock": 4}, {"name": "L", "stock": 6}]}),
           fc("sales_summary", {}), fc("list_debtors", {}), fc("get_low_stock", {}), txt("fin")]
ag.converse(u, "y", [])
with db.conn() as c:
    pr = c.execute("SELECT id, stock FROM products WHERE name='Campera'").fetchone(); assert pr["stock"] == 10
SCRIPT += [fc("adjust_stock", {"product_id": pr["id"], "quantity": 1, "mode": "add"}), txt("pidió variante")]
ag.converse(u, "z", [])
print("4 OK  (variantes, resumen, deudores, stock bajo)")

# 5) 429 por minuto en la clave 2 -> pasa a la 3
n = len(CALLS); SCRIPT += ["quota", txt("desde la 3ra")]
r, _ = ag.converse(u, "q", []); assert r == "desde la 3ra" and CALLS[-1][0] == "KEY_THIRD_0000000000000003", CALLS[-1][0]
print("5 OK  (rotación por 429 por minuto)")

# 6) todas agotadas -> AllKeysExhausted; con clave propia -> sigue andando
for k in gk.server_keys(): gk.cool(k, 600)
try: ag.converse(u, "w", []); raise SystemExit("debía fallar")
except gk.AllKeysExhausted: print("6a OK (todas agotadas -> AllKeysExhausted)")
with db.conn() as c: c.execute("INSERT INTO ai_keys(store_id,label,api_key) VALUES (1,'mia','OWN_KEY_FROM_USER_0000000004')")
SCRIPT.append(txt("con la mía")); r, _ = ag.converse(u, "w", [])
assert r == "con la mía" and CALLS[-1][0] == "OWN_KEY_FROM_USER_0000000004"; print("6b OK (usa la clave propia del negocio)")

# 7) verify_key
try: gk.verify_key("BAD_KEY_xxxxxxxxxxxxxxxxxxx"); raise SystemExit("debía fallar")
except gk.GeminiError as e: assert e.kind == "invalid"
assert gk.verify_key("GOOD_KEY_xxxxxxxxxxxxxxxxxxx"); print("7 OK  (verificación de clave)")
# 8) velocidad: sin "thinking", y las fotos no se reenvían una vez asignadas a un producto
gk.reset_cooldowns(); CALLS.clear(); big = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8" + b"x" * 5000).decode()
SCRIPT += [fc("create_product", {"name": "Campera azul", "stock": 4, "price": 90000, "image_indexes": [0]}), txt("Listo, cargada")]
reply, acts = ag.converse(u, "cargá una campera azul, 4 unidades a 90000", [big])
good = [c for c in CALLS if c[0] != "KEY_DAILY_EXHAUSTED_000001"]      # (la primera clave siempre responde 429 en este servidor falso)
assert reply == "Listo, cargada" and len(good) == 2, len(good)
assert good[0][2]["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}
assert "inlineData" in json.dumps(good[0][2]["contents"]) and "inlineData" not in json.dumps(good[1][2]["contents"])
with db.conn() as c:
    p = c.execute("SELECT img_n, img_v FROM products WHERE name='Campera azul'").fetchone()
assert p["img_n"] == 1 and p["img_v"]
print("8 OK  (thinking apagado + fotos no reenviadas + metadatos)")

# 9) si un modelo no admite apagar el thinking, se reintenta solo sin pedirlo
CALLS.clear(); gk.THINK = "0"
class Once:  # el servidor falso responde 400 la primera vez que ve thinkingConfig
    done = False
orig_post = H.do_POST
def post(self):
    body = json.loads(self.rfile.read(int(self.headers["Content-Length"]))); CALLS.append((self.headers.get("x-goog-api-key"), self.path, body))
    if "thinkingConfig" in body["generationConfig"] and not Once.done:
        Once.done = True; self.send_response(400); self.end_headers()
        self.wfile.write(json.dumps({"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": "Budget 0 is invalid. This model only works in thinking mode."}}).encode()); return
    self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(txt("ok sin thinking")).encode())
H.do_POST = post
r, _ = ag.converse(u, "hola", [])
assert r == "ok sin thinking" and len(CALLS) == 2 and "thinkingConfig" not in CALLS[1][2]["generationConfig"] and gk.THINK == "auto"
H.do_POST = orig_post
print("9 OK  (reintento sin thinkingConfig)")
print("TODO OK")
