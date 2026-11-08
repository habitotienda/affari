"""python tests/google_flow_test.py  (desde affari-app/)
Prueba el flujo de Google y los horarios contra SQLite real (schema.sql + migraciones), sin FastAPI ni Google:
si FastAPI/bcrypt no están instalados usa reemplazos mínimos; el verificador de Google se simula."""
import os, sys, types, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db"); os.environ["GOOGLE_CLIENT_ID"] = "cid.apps.googleusercontent.com"; os.environ["JWT_SECRET"] = "x"
try:
    import fastapi, bcrypt, pydantic  # noqa
except ImportError:
    fa = types.ModuleType("fastapi")
    class HTTPException(Exception):
        def __init__(s, status, detail=""): s.status, s.detail = status, detail
    class APIRouter:
        def __init__(s, prefix=""): s.routes = {}
        def _d(s, m, p):
            def w(f): s.routes[(m, p)] = f; return f
            return w
        def get(s, p): return s._d("GET", p)
        def post(s, p): return s._d("POST", p)
    fa.HTTPException, fa.APIRouter = HTTPException, APIRouter
    pd = types.ModuleType("pydantic")
    class BaseModel:
        def __init__(s, **k):
            for n in getattr(type(s), "__annotations__", {}): setattr(s, n, k[n] if n in k else getattr(type(s), n, None))
    pd.BaseModel = BaseModel
    bc = types.ModuleType("bcrypt"); bc.gensalt = lambda: b""; bc.hashpw = lambda p, s: b"h:" + p; bc.checkpw = lambda p, h: h == b"h:" + p
    sys.modules.update(fastapi=fa, pydantic=pd, bcrypt=bc)
import database as db, auth_handler as auth, google_auth as G, hours as H
from fastapi import HTTPException
db.init_db()

def load_user(c, uid, logo=False):
    u = dict(c.execute("SELECT u.id,u.name,u.email,u.phone,s.name AS business,s.hours FROM users u JOIN stores s ON s.user_id=u.id WHERE u.id=?", (uid,)).fetchone())
    u["hours"] = H.parse_hours(u["hours"]); return u
R = G.make_router(load_user, lambda u: u)
cfg, login, complete = R.routes[("GET", "/config")], R.routes[("POST", "/auth/google")], R.routes[("POST", "/auth/google/complete")]

def fails(fn, status, *a):
    try: fn(*a)
    except HTTPException as e: assert e.status == status, (e.status, e.detail); return e.detail
    raise AssertionError("debió fallar con %s" % status)
mk = lambda **k: types.SimpleNamespace(**k)

assert cfg() == {"google_client_id": "cid.apps.googleusercontent.com"}

# 1) token inválido → 401 (el verificador real rechaza; acá se simula)
def bad(_): raise ValueError("firma")
G.verify_google = bad; fails(login, 401, mk(credential="x"))

# 2) usuario nuevo → pide perfil, NO crea cuenta todavía
G.verify_google = lambda _: {"sub": "111", "email": "marcela@gmail.com", "name": "Marcela Gómez"}
r = login(mk(credential="ok")); assert r["needs_profile"] and r["email"] == "marcela@gmail.com" and "token" not in r
with db.conn() as c: assert c.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0

# 3) el ticket NO sirve como sesión (ni su 'sub'), y uno falso tampoco como ticket
assert auth.decode_token(r["ticket"]) is None
assert auth.read_ticket(auth.create_token(1), "google_signup") is None
fails(complete, 401, mk(ticket="basura", business="X", business_type="Kiosco", phone="3515550123"))

# 4) validaciones del paso rápido
fails(complete, 400, mk(ticket=r["ticket"], business="  ", business_type="Kiosco", phone="3515550123"))
fails(complete, 400, mk(ticket=r["ticket"], business="Kiosco Ana", business_type="Kiosco", phone="123"))

# 5) alta completa
ok = complete(mk(ticket=r["ticket"], business="Kiosco Ana", business_type="Kiosco", phone="351 555-0123"))
uid = auth.decode_token(ok["token"]); assert uid and ok["user"]["business"] == "Kiosco Ana" and ok["user"]["hours"]["enabled"] is False
with db.conn() as c:
    row = c.execute("SELECT phone, google_sub, password_hash FROM users WHERE id=?", (uid,)).fetchone()
    assert row["phone"] == "3515550123" and row["google_sub"] == "111" and row["password_hash"]
    assert c.execute("SELECT slug FROM stores WHERE user_id=?", (uid,)).fetchone()["slug"] == "kiosco-ana"

# 6) segunda vez con el mismo Google → entra directo; completar de nuevo → 409
assert auth.decode_token(login(mk(credential="ok"))["token"]) == uid
fails(complete, 409, mk(ticket=r["ticket"], business="Otra", business_type="Otro", phone="3515559999"))

# 7) cuenta creada con email+contraseña y luego Google con el mismo email verificado → se vincula, sin duplicar
with db.conn() as c:
    u2 = c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES (?,?,?,?)", ("Luis", "luis@gmail.com", "3515551111", "h")).lastrowid
    c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (?,?,?,?)", (u2, "Ferretería Luis", "Ferretería", "ferreteria-luis"))
G.verify_google = lambda _: {"sub": "222", "email": "luis@gmail.com", "name": "Luis"}
assert auth.decode_token(login(mk(credential="ok"))["token"]) == u2
with db.conn() as c: assert c.execute("SELECT google_sub FROM users WHERE id=?", (u2,)).fetchone()[0] == "222"

# 8) teléfono repetido → 409
G.verify_google = lambda _: {"sub": "333", "email": "nuevo@gmail.com", "name": "Nuevo"}
t = login(mk(credential="ok"))["ticket"]; fails(complete, 409, mk(ticket=t, business="Dup", business_type="Otro", phone="351-555-0123"))

# 9) sin GOOGLE_CLIENT_ID → 503
os.environ["GOOGLE_CLIENT_ID"] = ""; fails(login, 503, mk(credential="x"))

# 10) los horarios se guardan y se leen de la base (columna stores.hours creada por la migración)
h = H.clean_hours({"enabled": True, "days": {"mon": [["09:00", "18:00"]]}})
with db.conn() as c:
    c.execute("UPDATE stores SET hours=? WHERE user_id=?", (json.dumps(h), uid)); assert load_user(c, uid)["hours"] == h
print("google + hours (SQLite): OK")
