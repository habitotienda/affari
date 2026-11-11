"""Prueba de Grok (xAI) y de la rotación entre proveedores, con un servidor falso. Correr: python tests/grok_flow_test.py"""
import base64, io, json, os, sys, tempfile, threading, types
from http.server import BaseHTTPRequestHandler, HTTPServer
# --- stubs de librerías no instaladas en este entorno (igual que ai_flow_test.py)
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
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
tmp = tempfile.mkdtemp(); os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/t.db"
os.environ["GEMINI_API_KEYS"] = "GEM_EXHAUSTED_00000000000001"
os.environ["GROK_API_KEYS"] = "xai-SERVER_KEY_000000000000000001"
import database as db, ai_keys as gk, ai_agent as ag
db.init_db()

CALLS, GROK = [], []          # CALLS: pedidos a Gemini; GROK: (clave, ruta, cuerpo) a xAI
SCRIPT = []                   # respuestas de Grok en orden
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        ok = auth.startswith("Bearer xai-GOOD")
        self._send(200 if ok else 401, {"data": []} if ok else {"code": "Client specified an invalid argument", "error": "Incorrect API key provided: xai-BAD***."})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.startswith("/v1beta"):
            CALLS.append(self.headers.get("x-goog-api-key"))
            return self._send(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota", "details": [{"violations": [{"quotaId": "PerDayPerModel"}]}]}})
        GROK.append((self.headers.get("Authorization"), self.path, body))
        if body.get("model") == "grok-4" and os.environ.get("GROK4_GONE"):
            return self._send(404, {"code": "Some resource was not found", "error": "The model grok-4 does not exist or your team does not have access to it."})
        self._send(200, SCRIPT.pop(0) if SCRIPT else {"choices": [{"message": {"role": "assistant", "content": "ok grok"}, "finish_reason": "stop"}]})
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
gk.API = f"http://127.0.0.1:{srv.server_port}/v1beta"; gk.GROK_API = f"http://127.0.0.1:{srv.server_port}/v1"

with db.conn() as c:
    c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('Ana','a@a.com','1155551234','x')")
    c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (1,'Tienda','Indumentaria','tienda')")
    c.execute("INSERT INTO products(store_id,name,price,cost,stock,min_stock) VALUES (1,'Buzo gris',32000,10000,3,5)")
u = {"store_id": 1, "business": "Tienda", "business_type": "Indumentaria"}

assert gk.provider_of("xai-abc") == "grok" and gk.provider_of("AIzaSy123") == "gemini"
assert gk.server_keys() == ["GEM_EXHAUSTED_00000000000001", "xai-SERVER_KEY_000000000000000001"], gk.server_keys()
print("0 OK  (proveedor por prefijo y orden Gemini -> Grok)")

# 1) Gemini agotado -> Grok; ida y vuelta de herramientas (search_products -> adjust_stock -> texto)
tc = lambda i, name, args: {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{"id": f"x{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}, "finish_reason": "tool_calls"}]}
SCRIPT += [tc(1, "search_products", {"query": "buzo"}), tc(2, "adjust_stock", {"product_id": 1, "quantity": 5, "mode": "add"}),
           {"choices": [{"message": {"role": "assistant", "content": "Listo, sumé 5"}, "finish_reason": "stop"}]}]
webp = io.BytesIO()
from PIL import Image; Image.new("RGB", (10, 10), "red").save(webp, "WEBP")
img = "data:image/webp;base64," + base64.b64encode(webp.getvalue()).decode()
reply, acts = ag.converse(u, "sumale 5 al buzo", [img])
assert reply == "Listo, sumé 5", reply
assert CALLS == ["GEM_EXHAUSTED_00000000000001"], CALLS                        # Gemini se probó una vez y se enfrió
assert all(a == "Bearer xai-SERVER_KEY_000000000000000001" and p == "/v1/chat/completions" for a, p, _ in GROK)
first = GROK[0][2]
assert first["messages"][0]["role"] == "system" and first["model"] == "grok-4"
assert all(t["function"]["parameters"]["type"] == "object" for t in first["tools"]), first["tools"][0]
assert first["tools"][1]["function"]["parameters"]["properties"]["name"]["type"] == "string"          # STRING -> string
user_content = first["messages"][1]["content"]
assert any(p["type"] == "image_url" and p["image_url"]["url"].startswith("data:image/jpeg;base64,") for p in user_content), "WebP debe pasar a JPEG"
third = GROK[2][2]["messages"]                                                    # assistant(tool_calls) seguido de su respuesta tool
roles = [m["role"] for m in third]
assert roles[-4:] == ["assistant", "tool", "assistant", "tool"], roles
assert third[-2]["tool_calls"][0]["id"] == third[-1]["tool_call_id"]
assert any("3 → 8" in a["text"] for a in acts), acts
print("1 OK  (Gemini agotado -> Grok, herramientas y foto WebP->JPEG)")

# 2) Gemini ya enfriado: no se vuelve a llamar; el modelo grok-4 no existe -> usa grok-3
CALLS.clear(); GROK.clear(); os.environ["GROK4_GONE"] = "1"
reply, _ = ag.converse(u, "hola", [])
assert reply == "ok grok" and CALLS == [], CALLS
assert [b["model"] for _, _, b in GROK] == ["grok-4", "grok-3"], [b["model"] for _, _, b in GROK]
print("2 OK  (clave en espera no se reintenta; modelo inexistente -> siguiente modelo)")

# 3) Todo agotado -> AllKeysExhausted; la clave propia de Grok del negocio sigue
del os.environ["GROK4_GONE"]
for k in gk.server_keys(): gk.cool(k, 600)
try: ag.converse(u, "hola", []); raise SystemExit("debía agotarse")
except gk.AllKeysExhausted: pass
with db.conn() as c: c.execute("INSERT INTO ai_keys(store_id,label,api_key) VALUES (1,'mia','xai-GOOD_OWN_KEY_00000000000003')")
GROK.clear(); reply, _ = ag.converse(u, "hola", [])
assert reply == "ok grok" and GROK[0][0] == "Bearer xai-GOOD_OWN_KEY_00000000000003", GROK
print("3 OK  (se agotó el servidor -> usa la clave Grok propia del negocio)")

# 4) Verificación de claves Grok
assert gk.verify_key("xai-GOOD_xxxxxxxxxxxxxxxxxxxxxxxx")
try: gk.verify_key("xai-BAD_xxxxxxxxxxxxxxxxxxxxxxxxx"); raise SystemExit("debía fallar")
except gk.GeminiError as e: assert e.kind == "invalid", e.kind
print("4 OK  (verificación de clave Grok)")

# 5) Clasificación de errores raros: lista JSON y error en texto plano no deben romper
assert gk._classify(429, '[{"error": {"status": "RESOURCE_EXHAUSTED", "message": "x"}}]').kind == "quota"
assert gk._classify(403, '{"code": "x", "error": "Your team has either used all available credits or reached its monthly spending limit"}').kind == "quota"
assert gk._classify(500, "<html>boom</html>").kind == "transient"
print("5 OK  (clasificación de errores)")
print("TODO OK")
