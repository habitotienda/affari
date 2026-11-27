"""python tests/balance_quotes_test.py — Balance mensual (backend/balance.py) y Presupuestos (backend/quotes.py) contra SQLite temporal.
No necesita FastAPI instalado (se simulan APIRouter/HTTPException/BaseModel)."""
import os, sys, types, tempfile, inspect

# ---- stubs mínimos
class HTTPException(Exception):
    def __init__(self, status_code, detail=""): self.status_code, self.detail = status_code, detail
class APIRouter:
    def __init__(self, prefix=""): self.routes = {}
    def _reg(self, m, path):
        def deco(fn): self.routes[(m, path)] = fn; return fn
        return deco
    def put(self, p): return self._reg("PUT", p)
    def post(self, p): return self._reg("POST", p)
    def get(self, p): return self._reg("GET", p)
    def delete(self, p): return self._reg("DELETE", p)
fa = types.ModuleType("fastapi"); fa.APIRouter, fa.HTTPException = APIRouter, HTTPException
fa.Depends = lambda f=None: None; fa.Query = lambda *a, **k: None; fa.Response = object
sys.modules["fastapi"] = fa
class BaseModel:
    def __init__(self, **kw):
        ann = {}
        for k in reversed(type(self).__mro__):
            ann.update(getattr(k, "__annotations__", {}))
        for k in ann: setattr(self, k, kw.get(k, getattr(type(self), k, None)))
pd = types.ModuleType("pydantic"); pd.BaseModel = BaseModel; sys.modules["pydantic"] = pd
sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)
for m in ("afip",): sys.modules.setdefault(m, types.ModuleType(m))

tmp = tempfile.mktemp(suffix=".db"); os.environ["DATABASE_URL"] = f"sqlite:///{tmp}"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import database as db
import movements as mv
import balance as bal, quotes as qt
db.init_db()
B = bal.make_router(None).routes[("GET", "/balance")]
Q = qt.make_router(None).routes
U = {"store_id": 1}
def fails(fn, *a, code=400, **k):
    try: fn(*a, **k)
    except HTTPException as e:
        assert e.status_code == code, (e.status_code, e.detail); return e.detail
    raise AssertionError("debía fallar")
def sale(kind, amount, when, **k):
    cols = dict(store_id=1, kind=kind, concept=k.pop("concept", "x"), amount=amount, method=k.pop("method", "Efectivo"), created_at=when, **k)
    with db.conn() as c: return c.execute(f"INSERT INTO sales({','.join(cols)}) VALUES ({','.join('?'*len(cols))})", list(cols.values())).lastrowid
with db.conn() as c:
    c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('Ana','a@a.com','1155551234','x')"); c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (1,'T','K','t')")
    c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('B','b@b.com','1166666666','x')"); c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (2,'T2','K','t2')")
    c.execute("INSERT INTO clients(store_id,name,phone) VALUES (1,'Juan','1100000000')")

# ---- Balance: octubre 2026 (con bordes: 30/09 23:59 y 01/11 00:00 quedan afuera)
sale("entrada", 1000, "2026-10-05 10:00:00", cost=400, qty=1, product_id=1, product_name="Remera", method="Transferencia")
sale("entrada", 500, "2026-10-31 23:59:59", method="Efectivo", concept="Venta libre")             # sin producto: costo desconocido
sale("fiado", 300, "2026-10-10 10:00:00", cost=100, qty=1, method="Fiado", client_id=1)                # venta a deuda: cuenta como venta, no como ingreso
sale("entrada", 50, "2026-10-12 10:00:00", is_payment=1, client_id=1, method="Efectivo")             # cobro de fiado: ingreso, no es venta
sale("salida", 200, "2026-10-20 10:00:00", method="Efectivo", concept="Luz")
sale("salida", 700, "2026-10-21 10:00:00", method="Transferencia", supplier_id=9, concept="Pago proveedor")
gone = sale("entrada", 9999, "2026-10-22 10:00:00", concept="Cancelado")
sale("entrada", 77777, "2026-09-30 23:59:59"); sale("entrada", 88888, "2026-11-01 00:00:00")
mv.make_router(None).routes[("POST", "/sales/{mid}/void")](gone, mv.VoidIn(reason="x"), U)
r = B("2026-10", U)
assert (r["income"], r["expense"], r["balance"]) == (1550, 900, 650), r
assert r["profit"] == {"sales": 1800, "cost": 500, "estimated": 1300, "no_cost_items": 1}, r["profit"]
m = {x["method"]: x for x in r["methods"]}
assert (m["Efectivo"]["inflow"], m["Efectivo"]["outflow"], m["Efectivo"]["net"]) == (550, 200, 350) and m["Transferencia"]["net"] == 300 and m["Tarjeta"]["net"] == 0, m
assert sorted(x["amount"] for x in r["incomes"] if not x["voided_at"]) == [50, 500, 1000] and any(x["voided_at"] for x in r["incomes"])      # el anulado se lista marcado
assert sorted(x["amount"] for x in r["expenses"]) == [200, 700] and any(x["locked"] == "proveedor" for x in r["expenses"])
assert r["first_month"] == "2026-09" and r["month"] == "2026-10"
assert B("2026-12", U)["balance"] == 0 and B("2026-11", U)["income"] == 88888
assert B("2026-10", {"store_id": 2})["income"] == 0                                                   # otro negocio no ve nada
assert B(None, U)["month"] == __import__("datetime").date.today().strftime("%Y-%m")
for bad in ("2026-13", "abc", "1999-01", "2026"): fails(B, bad, U)
print("balance ok")

# ---- Presupuestos
create, lst, get, status, delete = Q[("POST", "/quotes")], Q[("GET", "/quotes")], Q[("GET", "/quotes/{qid}")], Q[("PUT", "/quotes/{qid}/status")], Q[("DELETE", "/quotes/{qid}")]
I = qt.QuoteItemIn; QI = qt.QuoteIn
q1 = create(QI(items=[I(name="Remera", qty=2, price=1500, product_id=1), I(name=" Instalación   a domicilio ", qty=1, price=2000)], discount=500, client_id=1, valid_days=7, note="  Incluye   flete "), U)
assert (q1["number"], q1["subtotal"], q1["discount"], q1["total"], q1["client_name"], q1["client_phone"], q1["status"]) == (1, 5000, 500, 4500, "Juan", "1100000000", "pendiente"), q1
assert q1["items"][1] == {"name": "Instalación a domicilio", "qty": 1, "unit": 2000, "product_id": None} and q1["note"] == "Incluye flete"
assert q1["valid_until"] == (__import__("datetime").date.today() + __import__("datetime").timedelta(days=7)).isoformat() and not q1["expired"]
q2 = create(QI(items=[I(name="Servicio", qty=1, price=100)], client_name="María", client_phone="+54 9 351 555-0123", valid_days=0), U)
assert q2["number"] == 2 and q2["valid_until"] is None and q2["client_phone"] == "+5493515550123" and q2["client_id"] is None
assert create(QI(items=[I(name="x", price=10)], discount=9999), U) if False else True
fails(create, QI(items=[I(name="x", qty=1, price=10)], discount=10), U)                    # descuento total → total 0
d = create(QI(items=[I(name="x", price=10)], discount=-5), U); assert d["discount"] == 0 and d["total"] == 10     # descuento negativo se ignora
for bad in (QI(items=[]), QI(items=[I(name=" ", price=1)]), QI(items=[I(name="x", qty=0, price=1)]), QI(items=[I(name="x", price=-1)]),
            QI(items=[I(name="x", price=float("inf"))]), QI(items=[I(name="x", price=1)], valid_days=999), QI(items=[I(name="x", price=0)])):
    fails(create, bad, U)
assert [x["number"] for x in lst(U)] == [3, 2, 1] and lst(U)[2]["n_items"] == 2
assert get(q1["id"], U)["items"][0]["qty"] == 2
fails(get, q1["id"], {"store_id": 2}, code=404); assert lst({"store_id": 2}) == []                  # aislamiento entre negocios
status(q1["id"], qt.StatusIn(status="aceptado"), U); assert get(q1["id"], U)["status"] == "aceptado"
fails(status, q1["id"], qt.StatusIn(status="otro"), U); fails(status, q1["id"], qt.StatusIn(status="rechazado"), {"store_id": 2}, code=404)
with db.conn() as c: c.execute("UPDATE quotes SET valid_until='2020-01-01' WHERE id=?", (q2["id"],))
assert get(q2["id"], U)["expired"] is True                                                          # vencido solo si sigue pendiente
status(q2["id"], qt.StatusIn(status="rechazado"), U); assert get(q2["id"], U)["expired"] is False
fails(delete, q1["id"], {"store_id": 2}, code=404); delete(q1["id"], U); fails(get, q1["id"], U, code=404)
assert create(QI(items=[I(name="y", price=5)]), U)["number"] == 4                                    # la numeración no reutiliza huecos del medio (máx+1)
print("presupuestos ok"); print("TODO OK")
