"""Prueba de las fotos con Cloudflare Workers AI, con un servidor falso. Correr: python tests/cf_images_test.py"""
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
os.environ["CF_ACCOUNTS"] = "acctA:tokA,acctB:tokB"; os.environ["CF_IMAGE_MODELS"] = "@cf/m/one,@cf/m/two"
import database as db, ai_keys as gk, ai_agent as ag, cf_images as cf
db.init_db()


from PIL import Image
def png(w=64, h=64, color="red"):
    b = io.BytesIO(); Image.new("RGB", (w, h), color).save(b, "PNG"); return base64.b64encode(b.getvalue()).decode()

HITS, MODE = [], {}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        acct = self.path.split("/accounts/")[1].split("/")[0]; model = self.path.split("/ai/run/")[1]
        HITS.append((acct, model, self.headers.get("Authorization"), self.headers.get("Content-Type"), raw))
        def send(code, obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
        if acct in MODE.get("quota", ()): return send(429, {"success": False, "errors": [{"code": 4006, "message": "you have used up your daily free allocation of 10,000 neurons"}]})
        if model in MODE.get("gone", ()): return send(404, {"success": False, "errors": [{"code": 5007, "message": "No such model"}]})
        send(200, {"success": True, "result": {"image": png(1024, 1024, "white")}})
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
cf.CF_API = f"http://127.0.0.1:{srv.server_port}/client/v4"

assert cf.configured() and cf.accounts() == [("acctA", "tokA"), ("acctB", "tokB")], cf.accounts()

# 1) foto de referencia: < 512 px, proporción conservada, salida múltiplo de 16
big = "data:image/png;base64," + png(2000, 1000, "blue")
ref, w, h = cf.prepare_input(big)
rim = Image.open(io.BytesIO(ref)); assert max(rim.size) < 512 and rim.size[0] == 2 * rim.size[1], rim.size
assert w % 16 == 0 and h % 16 == 0 and abs(w / h - 2) < .1, (w, h)
print("1 OK  (referencia reducida y proporción de salida)")

# 2) mejorar: multipart con prompt + input_image_0, token en Authorization, salida JPEG que entra en el límite
out = cf.run_image(cf.enhance_prompt("Buzo gris", "blanco"), ref, (w, h))
acct, model, auth, ctype, raw = HITS[-1]
assert (acct, model, auth) == ("acctA", "@cf/m/one", "Bearer tokA") and ctype.startswith("multipart/form-data; boundary="), HITS[-1][:4]
assert b'name="input_image_0"' in raw and b'name="prompt"' in raw and b"white seamless" in raw and b"exactly as it is" in raw and b"Buzo gris" in raw
assert out.startswith("data:image/jpeg;base64,") and len(out) <= cf.MAX_DATA_URL and ag.IMG.match(out), len(out)
print("2 OK  (multipart correcto y resultado válido para guardar como foto de producto)")

# 3) crear desde cero: sin imagen de referencia
HITS.clear(); cf.run_image(cf.create_prompt("Mate de calabaza", "Mates", "gris"))
assert b"input_image_0" not in HITS[-1][4] and b"Mate de calabaza" in HITS[-1][4]
print("3 OK  (crear sin referencia)")

# 4) cuota diaria agotada en la cuenta A -> pasa a la B y A queda en espera
HITS.clear(); MODE["quota"] = {"acctA"}
cf.run_image("x"); assert [h[0] for h in HITS] == ["acctA", "acctB"], [h[0] for h in HITS]
HITS.clear(); cf.run_image("x"); assert [h[0] for h in HITS] == ["acctB"], "A debe seguir en espera"
print("4 OK  (rotación de cuentas por cuota)")

# 5) modelo retirado -> siguiente modelo; todas las cuentas agotadas -> AllKeysExhausted
HITS.clear(); MODE.clear(); MODE["gone"] = {"@cf/m/one"}; gk.reset_cooldowns()
cf.run_image("x"); assert [h[1] for h in HITS] == ["@cf/m/one", "@cf/m/two"], [h[1] for h in HITS]
MODE.clear(); MODE["quota"] = {"acctA", "acctB"}; gk.reset_cooldowns()
try: cf.run_image("x"); raise SystemExit("debía agotarse")
except gk.AllKeysExhausted: pass
print("5 OK  (modelo retirado y cuota agotada en todas las cuentas)")

# 6) clasificación de errores de Cloudflare
assert cf._classify(401, '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}').kind == "invalid"
assert cf._classify(500, "boom").kind == "transient" and cf._classify(400, "{}").kind == "fatal"
print("6 OK  (clasificación de errores)")
print("TODO OK")
