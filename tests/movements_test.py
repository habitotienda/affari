"""python tests/movements_test.py — corregir entradas y salidas (backend/movements.py) contra una base SQLite temporal.
No necesita FastAPI instalado: se simulan APIRouter/HTTPException/BaseModel y se llama a la lógica de cada ruta directamente.
Cubre: anular/restaurar (stock, variantes, fiados, cobros, ventas de varios productos), editar (monto, concepto, medio, fecha, cantidad, tipo),
bloqueo de comprobantes y pagos a proveedores, aislamiento entre negocios y que reportes/flujo ignoren los anulados."""
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
import operations as ops
import movements as mv
db.init_db()

R = mv.make_router(None).routes
edit, void, restore = R[("PUT", "/sales/{mid}")], R[("POST", "/sales/{mid}/void")], R[("POST", "/sales/{mid}/restore")]
U = {"store_id": 1}
E = mv.MoveEditIn; V = mv.VoidIn

def q(sql, *p):
    with db.conn() as c: return [dict(r) for r in c.execute(sql, p).fetchall()]
def one(sql, *p): return q(sql, *p)[0]
def fails(fn, *a, code=400, **k):
    try: fn(*a, **k)
    except HTTPException as e:
        assert e.status_code == code, (e.status_code, e.detail); return e.detail
    raise AssertionError("debía fallar")

with db.conn() as c:
    c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('Ana','a@a.com','1155551234','x')")
    c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (1,'T','K','t')")
    c.execute("INSERT INTO products(store_id,name,price,cost,stock) VALUES (1,'Remera',100,40,10)")           # p1 sin variantes
    c.execute("INSERT INTO products(store_id,name,price,cost,stock) VALUES (1,'Jean',200,80,5)")               # p2 con variantes
    c.execute("INSERT INTO product_variants(product_id,name,stock) VALUES (2,'M',3)")
    c.execute("INSERT INTO product_variants(product_id,name,stock) VALUES (2,'L',2)")
    c.execute("INSERT INTO clients(store_id,name,phone,balance) VALUES (1,'Juan','1100000000',0)")

today = one("SELECT date('now','localtime') d")["d"]
def sale(kind="entrada", amount=100, **k):
    cols = dict(store_id=1, kind=kind, concept=k.pop("concept", "x"), amount=amount, method=k.pop("method", "Efectivo"), **k)
    with db.conn() as c:
        return c.execute(f"INSERT INTO sales({','.join(cols)}) VALUES ({','.join('?'*len(cols))})", list(cols.values())).lastrowid
stock = lambda pid: one("SELECT stock FROM products WHERE id=?", pid)["stock"]
vstock = lambda n: one("SELECT stock FROM product_variants WHERE name=?", n)["stock"]
bal = lambda: one("SELECT balance FROM clients WHERE id=1")["balance"]

# 1) anular venta con producto: devuelve stock, queda marcada, sale de los cálculos
with db.conn() as c: c.execute("UPDATE products SET stock=8 WHERE id=1")                       # se vendieron 2
s1 = sale(amount=200, concept="2 × Remera", cost=80, product_id=1, product_name="Remera", qty=2)
r = void(s1, V(reason="Cancelaron el pedido"), U); assert r["stock_back"] == 2 and stock(1) == 10, r
row = one("SELECT * FROM sales WHERE id=?", s1); assert row["voided_at"] and row["void_reason"] == "Cancelaron el pedido"
fails(void, s1, V(), U)                                                                       # no se anula dos veces
fails(edit, s1, E(amount=5), U)                                                               # anulado no se edita
r = restore(s1, U); assert stock(1) == 8 and not one("SELECT voided_at v FROM sales WHERE id=?", s1)["v"]
print("1 ok · anular / restaurar venta con producto")

# 2) editar monto, concepto, medio, fecha
s2 = sale(amount=500, concept="Venta mostrador")
edit(s2, E(amount=450, concept="  Venta   mostrador  ", method="Transferencia", date="2025-01-10"), U)
row = one("SELECT * FROM sales WHERE id=?", s2)
assert (row["amount"], row["concept"], row["method"], row["created_at"][:10]) == (450, "Venta mostrador", "Transferencia", "2025-01-10") and row["edited_at"], row
fails(edit, s2, E(amount=0), U); fails(edit, s2, E(amount=float("nan")), U); fails(edit, s2, E(method="Cripto"), U); fails(edit, s2, E(date="2999-01-01"), U); fails(edit, s2, E(concept="  "), U)
fails(edit, 999, E(amount=1), U, code=404)
print("2 ok · editar monto/concepto/medio/fecha + validaciones")

# 3) entrada ⇄ salida (me equivoqué: era un gasto)
edit(s2, E(kind="salida"), U); assert one("SELECT kind FROM sales WHERE id=?", s2)["kind"] == "salida"
fails(edit, s1, E(kind="salida"), U)                                                          # con producto no se cambia el tipo
print("3 ok · cambiar entrada/salida")

# 4) cantidad: ajusta stock, costo, concepto
r = edit(s1, E(qty=5, amount=500), U)
row = one("SELECT * FROM sales WHERE id=?", s1); assert (row["qty"], row["cost"], row["concept"], stock(1)) == (5, 200, "5 × Remera", 5), (row, stock(1))
edit(s1, E(qty=1, amount=100), U); assert stock(1) == 9 and one("SELECT cost c FROM sales WHERE id=?", s1)["c"] == 40
fails(edit, s1, E(qty=50, amount=5000), U)                                                    # stock insuficiente → no cambia nada
assert stock(1) == 9 and one("SELECT qty q FROM sales WHERE id=?", s1)["q"] == 1
fails(edit, s2, E(qty=3), U)                                                                  # sin producto
print("4 ok · cantidad ajusta stock y costo; stock insuficiente hace rollback")

# 5) variantes
with db.conn() as c: c.execute("UPDATE product_variants SET stock=1 WHERE name='M'"); c.execute("UPDATE products SET stock=3 WHERE id=2")
s3 = sale(amount=400, concept="2 × Jean (M)", cost=160, product_id=2, product_name="Jean", variant_name="M", qty=2)
void(s3, V(), U); assert vstock("M") == 3 and stock(2) == 5
restore(s3, U); assert vstock("M") == 1 and stock(2) == 3
print("5 ok · variantes")

# 6) fiado: anular descuenta deuda; editar monto ajusta deuda; restaurar vuelve a sumar
with db.conn() as c: c.execute("UPDATE clients SET balance=300 WHERE id=1")
f1 = sale("fiado", 300, concept="Fiado: Juan", method="Fiado", client_id=1)
edit(f1, E(amount=350, method="Tarjeta"), U); assert bal() == 350 and one("SELECT method m FROM sales WHERE id=?", f1)["m"] == "Fiado"
void(f1, V(), U); assert bal() == 0
restore(f1, U); assert bal() == 350
print("6 ok · fiados")

# 7) cobro de fiado
with db.conn() as c: c.execute("UPDATE clients SET balance=200 WHERE id=1")                   # debía 300, pagó 100
p1 = sale("entrada", 100, concept="Cobro fiado: Juan", is_payment=1, client_id=1)
edit(p1, E(amount=150), U); assert bal() == 150
fails(edit, p1, E(amount=999), U)
void(p1, V(), U); assert bal() == 300
restore(p1, U); assert bal() == 150
void(p1, V(), U)
with db.conn() as c: c.execute("UPDATE clients SET balance=0 WHERE id=1")                      # el cliente pagó todo por otro lado
fails(restore, p1, U); assert bal() == 0
print("7 ok · cobros")

# 8) venta con varios productos (ticket)
with db.conn() as c: c.execute("UPDATE clients SET balance=0 WHERE id=1"); c.execute("UPDATE products SET stock=7 WHERE id=1"); c.execute("UPDATE product_variants SET stock=0 WHERE name='L'"); c.execute("UPDATE product_variants SET stock=0 WHERE name='M'"); c.execute("UPDATE products SET stock=0 WHERE id=2")
a = sale(amount=100, concept="1 × Remera", cost=40, product_id=1, product_name="Remera", qty=1, ticket="tk1", ticket_concept="Pedido Marta")
b = sale(amount=200, concept="1 × Jean (L)", cost=80, product_id=2, product_name="Jean", variant_name="L", qty=1, ticket="tk1", ticket_concept="Pedido Marta")
fails(edit, b, E(amount=10), U); fails(edit, b, E(qty=3), U)
edit(b, E(concept="Pedido de Marta", method="Tarjeta", date="2025-02-02"), U)
rows = q("SELECT method,ticket_concept,created_at FROM sales WHERE ticket='tk1'"); assert all(r["method"] == "Tarjeta" and r["ticket_concept"] == "Pedido de Marta" and r["created_at"][:10] == "2025-02-02" for r in rows), rows
void(a, V(reason="Cancelaron el pedido"), U)
assert all(r["voided_at"] for r in q("SELECT voided_at FROM sales WHERE ticket='tk1'")) and stock(1) == 8 and vstock("L") == 1 and stock(2) == 1
print("8 ok · venta con varios productos se anula entera")

# 9) bloqueos: comprobante y proveedor
inv = sale(amount=10, invoice_id=77); sup = sale("salida", 10, supplier_id=5)
for x in (inv, sup):
    fails(edit, x, E(amount=1), U); fails(void, x, V(), U)
print("9 ok · comprobantes y pagos a proveedor bloqueados")

# 10) otro negocio no puede tocarlo
with db.conn() as c: c.execute("INSERT INTO users(name,email,phone,password_hash) VALUES ('B','b@b.com','1166666666','x')"); c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (2,'T2','K','t2')")
fails(void, s2, V(), {"store_id": 2}, code=404); fails(edit, s2, E(amount=1), {"store_id": 2}, code=404)
print("10 ok · aislamiento entre negocios")

# 11) los anulados no suman: dashboard-style, flujo de caja y reportes
import reports
from datetime import date
with db.conn() as c:
    c.execute("DELETE FROM sales")
    c.execute("UPDATE products SET stock=10 WHERE id=1")
ok  = sale(amount=1000, concept="1 × Remera", cost=40, product_id=1, product_name="Remera", qty=1)
bad = sale(amount=5000, concept="1 × Remera", cost=40, product_id=1, product_name="Remera", qty=1)
gas = sale("salida", 300, concept="Luz")
gas2 = sale("salida", 700, concept="Alquiler")
void(bad, V(), U); void(gas2, V(), U)
with db.conn() as c:
    d = date.today()
    b = reports.build(c, 1, d, d)
    assert b["totals"]["sales"] == 1000 and b["totals"]["expenses"] == 300 and b["totals"]["count"] == 1, b["totals"]
    assert [p["units"] for p in b["products"]] == [1] and len(b["movements"]) == 2 and [e["concept"] for e in b["expenses"]] == ["Luz"], b
    net = "SUM(CASE WHEN kind='entrada' THEN amount WHEN kind='salida' THEN -amount ELSE 0 END)"
    assert c.execute(f"SELECT {net} FROM sales WHERE store_id=1 AND voided_at IS NULL").fetchone()[0] == 700
    lst = ops.grouped_sales(c, 1, "", (), 50)
    byid = {m["id"]: m for m in lst}
    assert byid[bad]["voided_at"] and byid[gas2]["voided_at"] and not byid[ok]["voided_at"] and byid[bad]["locked"] == "" and byid[bad]["qty"] == 1, byid[bad]
print("11 ok · reportes y listado ignoran anulados pero los muestran marcados")
print("TODO OK")
