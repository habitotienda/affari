"""Parte 5 · Gestión operativa: variantes, clientes, proveedores, deudas, flujo de caja y comprobantes.

Se monta desde app.py con `app.include_router(operations.make_router(current_user))`.
Reglas contables (iguales en toda la app):
  - Efectivo / Transferencia / Tarjeta mueven caja. "Fiado" no mueve caja hasta que se cobra.
  - Pagar a un proveedor es una salida de caja con supplier_id: NO es gasto del período (la mercadería se cuenta como costo al vender).
"""
import io, json, re
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
import database as db
import afip

PAY_METHODS = ("Efectivo", "Transferencia", "Tarjeta")
SALE = "kind IN ('entrada','fiado') AND is_payment=0"
r2 = lambda x: round(float(x or 0), 2)

# ---------------------------------------------------------------- helpers compartidos con app.py
def sync_variant_stock(c, pid):
    """Si el producto tiene variantes, su stock total es la suma de ellas."""
    if c.execute("SELECT 1 FROM product_variants WHERE product_id=?", (pid,)).fetchone():
        c.execute("UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id=?) WHERE id=?", (pid, pid))

def has_variants(c, pid):
    return bool(c.execute("SELECT 1 FROM product_variants WHERE product_id=?", (pid,)).fetchone())

def attach_variants(c, products):
    """Agrega la lista `variants` a cada producto (dicts)."""
    if not products:
        return products
    ids = [p["id"] for p in products]
    rows = c.execute(f"SELECT * FROM product_variants WHERE product_id IN ({','.join('?' * len(ids))}) ORDER BY id", ids).fetchall()
    by = {}
    for v in rows:
        by.setdefault(v["product_id"], []).append(dict(v))
    for p in products:
        p["variants"] = by.get(p["id"], [])
    return products

def take_product(c, sid, product_id, qty, variant_id=None):
    """Descuenta stock (del producto o de su variante). Devuelve (producto como dict con price/cost/label efectivos, costo total)."""
    if qty < 1:
        raise HTTPException(400, "La cantidad debe ser al menos 1.")
    row = c.execute("SELECT id,store_id,name,description,price,cost,stock,min_stock,active,category FROM products WHERE id=? AND store_id=?", (product_id, sid)).fetchone()   # sin la columna images: pesa mucho
    if not row:
        raise HTTPException(404, "Producto inexistente.")
    p = dict(row); p["label"], p["variant_name"] = p["name"], None
    if has_variants(c, p["id"]):
        v = c.execute("SELECT * FROM product_variants WHERE id=? AND product_id=?", (variant_id, p["id"])).fetchone() if variant_id else None
        if not v:
            raise HTTPException(400, f"Elegí la variante de {p['name']}.")
        if v["stock"] < qty:
            raise HTTPException(400, f"Stock insuficiente de {p['name']} ({v['name']}): quedan {v['stock']}.")
        c.execute("UPDATE product_variants SET stock = stock - ? WHERE id=?", (qty, v["id"]))
        c.execute("UPDATE products SET stock = stock - ? WHERE id=?", (qty, p["id"]))
        p["price"] = v["price"] or p["price"]; p["cost"] = v["cost"] or p["cost"]
        p["label"], p["variant_name"], p["variant_id"] = f"{p['name']} ({v['name']})", v["name"], v["id"]
    else:
        if p["stock"] < qty:
            raise HTTPException(400, f"Stock insuficiente de {p['name']}: quedan {p['stock']}.")
        c.execute("UPDATE products SET stock = stock - ? WHERE id=?", (qty, p["id"]))
        p["variant_id"] = None
    return p, p["cost"] * qty

def low_stock(c, sid, limit=8):
    """Productos sin variantes y variantes con stock en o por debajo del mínimo (alerta roja)."""
    rows = c.execute("""SELECT p.id, p.name, p.stock, p.min_stock FROM products p WHERE p.store_id=? AND p.stock<=p.min_stock
                        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
                        UNION ALL
                        SELECT p.id, p.name || ' · ' || v.name, v.stock, v.min_stock FROM product_variants v JOIN products p ON p.id=v.product_id
                        WHERE p.store_id=? AND v.stock<=v.min_stock ORDER BY 3 LIMIT ?""", (sid, sid, limit)).fetchall()
    return [dict(r) for r in rows]

# ---------------------------------------------------------------- modelos
class VariantIn(BaseModel):
    name: str; sku: str = ""; price: float = 0; cost: float = 0; stock: int = 0; min_stock: int = 2

class StockIn(BaseModel):
    qty: int

class PartyIn(BaseModel):
    name: str; phone: str = ""; email: str = ""; cuit: str = ""; address: str = ""; notes: str = ""

class SupplierMoveIn(BaseModel):
    amount: float; concept: str = ""; method: str = "Efectivo"; due_date: Optional[str] = None; paid: bool = False

class ClosureIn(BaseModel):
    day: Optional[str] = None; counted: float; notes: str = ""

class FiscalIn(BaseModel):
    razon_social: str = ""; cuit: str = ""; cond_iva: str = "Monotributo"; pto_vta: int = 1; domicilio: str = ""
    inicio_actividades: str = ""; ingresos_brutos: str = ""; afip_enabled: bool = False; afip_env: str = "homologacion"

class InvItemIn(BaseModel):
    product_id: Optional[int] = None; variant_id: Optional[int] = None; description: str = ""
    qty: int = 1; unit_price: Optional[float] = None; iva_rate: float = 21

class InvoiceIn(BaseModel):
    type: Optional[str] = None; client_id: Optional[int] = None; client_name: str = ""
    client_doc: str = ""; client_iva: str = "Consumidor Final"
    items: list[InvItemIn]; method: str = "Efectivo"; notes: str = ""

def clean_party(d: PartyIn, label):
    name, cuit = d.name.strip(), re.sub(r"\D", "", d.cuit or "")
    phone = re.sub(r"\D", "", d.phone or "")
    if not name:
        raise HTTPException(400, f"Indicá el nombre del {label}.")
    if phone and not 8 <= len(phone) <= 15:
        raise HTTPException(400, "El teléfono debe tener entre 8 y 15 dígitos (con código de área).")
    if d.email.strip() and "@" not in d.email:
        raise HTTPException(400, "El email no parece válido.")
    if cuit and not afip.valid_cuit(cuit):
        raise HTTPException(400, "El CUIT/CUIL no es válido (11 dígitos, verificá el último número).")
    return name, phone, d.email.strip().lower(), cuit, d.address.strip()[:160], d.notes.strip()[:400]

def valid_day(s):
    try:
        return date.fromisoformat(s).isoformat() if s else date.today().isoformat()
    except ValueError:
        raise HTTPException(400, "La fecha debe tener formato AAAA-MM-DD.")

# ---------------------------------------------------------------- router
def make_router(current_user):
    R = APIRouter(prefix="/api")

    # ----- Variantes -----
    def own_product(c, u, pid):
        p = c.execute("SELECT id FROM products WHERE id=? AND store_id=?", (pid, u["store_id"])).fetchone()
        if not p:
            raise HTTPException(404, "Producto inexistente.")

    def check_variant(d: VariantIn):
        if not d.name.strip():
            raise HTTPException(400, "La variante necesita un nombre (ej: Talle M / Rojo).")
        if min(d.price, d.cost, d.stock, d.min_stock) < 0:
            raise HTTPException(400, "Precio, costo y stock no pueden ser negativos.")

    @R.post("/products/{pid}/variants")
    def add_variant(pid: int, d: VariantIn, u=Depends(current_user)):
        check_variant(d)
        with db.conn() as c:
            own_product(c, u, pid)
            vid = c.execute("INSERT INTO product_variants(product_id,name,sku,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?,?)",
                            (pid, d.name.strip()[:60], d.sku.strip()[:40], d.price, d.cost, d.stock, d.min_stock)).lastrowid
            sync_variant_stock(c, pid)
        return {"id": vid}

    def own_variant(c, u, vid):
        v = c.execute("SELECT v.* FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.store_id=?", (vid, u["store_id"])).fetchone()
        if not v:
            raise HTTPException(404, "Variante inexistente.")
        return v

    @R.put("/variants/{vid}")
    def edit_variant(vid: int, d: VariantIn, u=Depends(current_user)):
        check_variant(d)
        with db.conn() as c:
            v = own_variant(c, u, vid)
            c.execute("UPDATE product_variants SET name=?,sku=?,price=?,cost=?,stock=?,min_stock=? WHERE id=?",
                      (d.name.strip()[:60], d.sku.strip()[:40], d.price, d.cost, d.stock, d.min_stock, vid))
            sync_variant_stock(c, v["product_id"])
        return {"ok": True}

    @R.delete("/variants/{vid}")
    def del_variant(vid: int, u=Depends(current_user)):
        with db.conn() as c:
            v = own_variant(c, u, vid)
            c.execute("DELETE FROM product_variants WHERE id=?", (vid,))
            if has_variants(c, v["product_id"]):
                sync_variant_stock(c, v["product_id"])
        return {"ok": True}

    @R.post("/variants/{vid}/stock")
    def variant_stock(vid: int, d: StockIn, u=Depends(current_user)):
        if d.qty < 1:
            raise HTTPException(400, "Ingresá una cantidad mayor a cero.")
        with db.conn() as c:
            v = own_variant(c, u, vid)
            c.execute("UPDATE product_variants SET stock = stock + ? WHERE id=?", (d.qty, vid))
            sync_variant_stock(c, v["product_id"])
            return {"stock": c.execute("SELECT stock FROM product_variants WHERE id=?", (vid,)).fetchone()[0]}

    # ----- Clientes (base de datos) -----
    @R.post("/clients")
    def create_client(d: PartyIn, u=Depends(current_user)):
        name, phone, email, cuit, addr, notes = clean_party(d, "cliente")
        with db.conn() as c:
            if c.execute("SELECT 1 FROM clients WHERE store_id=? AND lower(name)=lower(?)", (u["store_id"], name)).fetchone():
                raise HTTPException(409, "Ya tenés un cliente con ese nombre.")
            cid = c.execute("INSERT INTO clients(store_id,name,phone,email,cuit,address,notes) VALUES (?,?,?,?,?,?,?)",
                            (u["store_id"], name, phone, email, cuit, addr, notes)).lastrowid
        return {"id": cid}

    @R.put("/clients/{cid}")
    def edit_client(cid: int, d: PartyIn, u=Depends(current_user)):
        name, phone, email, cuit, addr, notes = clean_party(d, "cliente")
        with db.conn() as c:
            n = c.execute("UPDATE clients SET name=?,phone=?,email=?,cuit=?,address=?,notes=? WHERE id=? AND store_id=?",
                          (name, phone, email, cuit, addr, notes, cid, u["store_id"])).rowcount
        if not n:
            raise HTTPException(404, "Cliente inexistente.")
        return {"ok": True}

    @R.delete("/clients/{cid}")
    def delete_client(cid: int, u=Depends(current_user)):
        with db.conn() as c:
            cl = c.execute("SELECT balance FROM clients WHERE id=? AND store_id=?", (cid, u["store_id"])).fetchone()
            if not cl:
                raise HTTPException(404, "Cliente inexistente.")
            if cl["balance"] > 0.005:
                raise HTTPException(400, "No se puede borrar un cliente con deuda pendiente. Cobrala primero.")
            c.execute("UPDATE sales SET client_id=NULL WHERE client_id=?", (cid,))      # el historial de caja se conserva
            c.execute("UPDATE invoices SET client_id=NULL WHERE client_id=?", (cid,))
            c.execute("DELETE FROM clients WHERE id=?", (cid,))
        return {"ok": True}

    @R.get("/clients/{cid}/moves")
    def client_moves(cid: int, u=Depends(current_user)):
        with db.conn() as c:
            if not c.execute("SELECT 1 FROM clients WHERE id=? AND store_id=?", (cid, u["store_id"])).fetchone():
                raise HTTPException(404, "Cliente inexistente.")
            rows = c.execute("SELECT id,kind,concept,amount,method,is_payment,created_at FROM sales WHERE client_id=? ORDER BY id DESC LIMIT 60", (cid,)).fetchall()
        return [dict(r) for r in rows]

    # ----- Proveedores -----
    def own_supplier(c, u, sid):
        s = c.execute("SELECT * FROM suppliers WHERE id=? AND store_id=?", (sid, u["store_id"])).fetchone()
        if not s:
            raise HTTPException(404, "Proveedor inexistente.")
        return s

    @R.get("/suppliers")
    def list_suppliers(u=Depends(current_user)):
        with db.conn() as c:
            rows = c.execute("""SELECT s.*, (SELECT MAX(created_at) FROM supplier_moves m WHERE m.supplier_id=s.id) AS last_move,
                                (SELECT MIN(due_date) FROM supplier_moves m WHERE m.supplier_id=s.id AND m.kind='compra' AND m.due_date IS NOT NULL) AS next_due
                                FROM suppliers s WHERE s.store_id=? ORDER BY s.balance DESC, s.name COLLATE NOCASE""", (u["store_id"],)).fetchall()
        return [dict(r) for r in rows]

    @R.post("/suppliers")
    def create_supplier(d: PartyIn, u=Depends(current_user)):
        name, phone, email, cuit, addr, notes = clean_party(d, "proveedor")
        with db.conn() as c:
            if c.execute("SELECT 1 FROM suppliers WHERE store_id=? AND lower(name)=lower(?)", (u["store_id"], name)).fetchone():
                raise HTTPException(409, "Ya tenés un proveedor con ese nombre.")
            sid = c.execute("INSERT INTO suppliers(store_id,name,phone,email,cuit,address,notes) VALUES (?,?,?,?,?,?,?)",
                            (u["store_id"], name, phone, email, cuit, addr, notes)).lastrowid
        return {"id": sid}

    @R.put("/suppliers/{sid}")
    def edit_supplier(sid: int, d: PartyIn, u=Depends(current_user)):
        name, phone, email, cuit, addr, notes = clean_party(d, "proveedor")
        with db.conn() as c:
            own_supplier(c, u, sid)
            c.execute("UPDATE suppliers SET name=?,phone=?,email=?,cuit=?,address=?,notes=? WHERE id=?", (name, phone, email, cuit, addr, notes, sid))
        return {"ok": True}

    @R.delete("/suppliers/{sid}")
    def delete_supplier(sid: int, u=Depends(current_user)):
        with db.conn() as c:
            s = own_supplier(c, u, sid)
            if s["balance"] > 0.005:
                raise HTTPException(400, "Todavía le debés a este proveedor. Registrá el pago antes de borrarlo.")
            c.execute("UPDATE sales SET supplier_id=NULL WHERE supplier_id=?", (sid,))
            c.execute("DELETE FROM suppliers WHERE id=?", (sid,))
        return {"ok": True}

    @R.get("/suppliers/{sid}/moves")
    def supplier_moves(sid: int, u=Depends(current_user)):
        with db.conn() as c:
            own_supplier(c, u, sid)
            rows = c.execute("SELECT id,kind,concept,amount,method,due_date,created_at FROM supplier_moves WHERE supplier_id=? ORDER BY id DESC LIMIT 80", (sid,)).fetchall()
        return [dict(r) for r in rows]

    def _pay_out(c, u, s, amount, method, concept):
        c.execute("INSERT INTO supplier_moves(store_id,supplier_id,kind,concept,amount,method) VALUES (?,?,?,?,?,?)", (u["store_id"], s["id"], "pago", concept, amount, method))
        c.execute("INSERT INTO sales(store_id,kind,concept,amount,method,supplier_id) VALUES (?,?,?,?,?,?)",
                  (u["store_id"], "salida", f"Pago proveedor: {s['name']}" + (f" ({concept})" if concept else ""), amount, method, s["id"]))

    @R.post("/suppliers/{sid}/purchase")
    def supplier_purchase(sid: int, d: SupplierMoveIn, u=Depends(current_user)):
        if d.amount <= 0:
            raise HTTPException(400, "El monto debe ser mayor a cero.")
        if d.paid and d.method not in PAY_METHODS:
            raise HTTPException(400, "Medio de pago inválido.")
        due = valid_day(d.due_date) if d.due_date else None
        with db.conn() as c:
            s = own_supplier(c, u, sid)
            concept = d.concept.strip()[:120] or "Compra de mercadería"
            c.execute("INSERT INTO supplier_moves(store_id,supplier_id,kind,concept,amount,due_date) VALUES (?,?,?,?,?,?)", (u["store_id"], sid, "compra", concept, d.amount, due))
            c.execute("UPDATE suppliers SET balance = balance + ? WHERE id=?", (d.amount, sid))
            if d.paid:                                                      # compra al contado: se paga en el momento
                c.execute("UPDATE suppliers SET balance = balance - ? WHERE id=?", (d.amount, sid))
                _pay_out(c, u, s, d.amount, d.method, concept)
        return {"ok": True}

    @R.post("/suppliers/{sid}/pay")
    def supplier_pay(sid: int, d: SupplierMoveIn, u=Depends(current_user)):
        if d.method not in PAY_METHODS:
            raise HTTPException(400, "Medio de pago inválido.")
        with db.conn() as c:
            s = own_supplier(c, u, sid)
            if d.amount <= 0 or d.amount > s["balance"] + 0.005:
                raise HTTPException(400, "El monto debe ser mayor a cero y no superar la deuda.")
            c.execute("UPDATE suppliers SET balance = MAX(balance - ?, 0) WHERE id=?", (d.amount, sid))
            _pay_out(c, u, s, d.amount, d.method, d.concept.strip()[:120])
        return {"ok": True}

    # ----- Deudas: por cobrar (clientes) y por pagar (proveedores) -----
    @R.get("/debts")
    def debts(u=Depends(current_user)):
        today = date.today().isoformat()
        with db.conn() as c:
            recv = [dict(r) for r in c.execute("""SELECT cl.id, cl.name, cl.phone, cl.balance, MAX(s.created_at) AS last_move
                       FROM clients cl LEFT JOIN sales s ON s.client_id=cl.id WHERE cl.store_id=? AND cl.balance>0 GROUP BY cl.id ORDER BY cl.balance DESC""", (u["store_id"],))]
            for x in recv:                      # días sin movimientos (calculado en Python: igual en SQLite y Postgres)
                x["days"] = (date.today() - date.fromisoformat(x["last_move"][:10])).days if x["last_move"] else 0
            pay = [dict(r) for r in c.execute("""SELECT s.id, s.name, s.phone, s.balance,
                       (SELECT MIN(due_date) FROM supplier_moves m WHERE m.supplier_id=s.id AND m.kind='compra' AND m.due_date IS NOT NULL) AS next_due
                       FROM suppliers s WHERE s.store_id=? AND s.balance>0 ORDER BY s.balance DESC""", (u["store_id"],))]
        for p in pay:
            p["overdue"] = bool(p["next_due"] and p["next_due"] < today)
        tr, tp = r2(sum(x["balance"] for x in recv)), r2(sum(x["balance"] for x in pay))
        return {"receivable": {"total": tr, "items": recv, "over30": r2(sum(x["balance"] for x in recv if x["days"] >= 30))},
                "payable": {"total": tp, "items": pay, "overdue": r2(sum(x["balance"] for x in pay if x["overdue"]))}, "position": r2(tr - tp)}

    # ----- Flujo de caja diario -----
    @R.get("/cashflow")
    def cashflow(day: Optional[str] = Query(None), u=Depends(current_user)):
        day, sid = valid_day(day), u["store_id"]
        net = "SUM(CASE WHEN kind='entrada' THEN amount WHEN kind='salida' THEN -amount ELSE 0 END)"
        with db.conn() as c:
            methods = []
            for m in PAY_METHODS:
                opening = c.execute(f"SELECT {net} FROM sales WHERE store_id=? AND method=? AND date(created_at) < ?", (sid, m, day)).fetchone()[0]
                r = c.execute("SELECT SUM(CASE WHEN kind='entrada' THEN amount END) i, SUM(CASE WHEN kind='salida' THEN amount END) o FROM sales WHERE store_id=? AND method=? AND date(created_at)=?", (sid, m, day)).fetchone()
                methods.append({"method": m, "opening": r2(opening), "inflow": r2(r["i"]), "outflow": r2(r["o"]), "closing": r2((opening or 0) + (r["i"] or 0) - (r["o"] or 0))})
            t = c.execute(f"""SELECT SUM(CASE WHEN {SALE} THEN amount END) sales, COUNT(CASE WHEN {SALE} THEN 1 END) n,
                       SUM(CASE WHEN kind='fiado' THEN amount END) fiado, SUM(CASE WHEN is_payment=1 THEN amount END) cobros,
                       SUM(CASE WHEN kind='salida' AND supplier_id IS NULL THEN amount END) gastos,
                       SUM(CASE WHEN kind='salida' AND supplier_id IS NOT NULL THEN amount END) proveedores
                       FROM sales WHERE store_id=? AND date(created_at)=?""", (sid, day)).fetchone()
            moves = [dict(r) for r in c.execute("SELECT id,kind,concept,amount,method,is_payment,supplier_id,created_at FROM sales WHERE store_id=? AND date(created_at)=? ORDER BY id DESC LIMIT 300", (sid, day))]
            closure = c.execute("SELECT day,expected,counted,diff,notes,created_at FROM cash_closures WHERE store_id=? AND day=?", (sid, day)).fetchone()
            recv = c.execute("SELECT SUM(balance) FROM clients WHERE store_id=?", (sid,)).fetchone()[0]
            pay = c.execute("SELECT SUM(balance) FROM suppliers WHERE store_id=?", (sid,)).fetchone()[0]
        return {"day": day, "methods": methods, "total_closing": r2(sum(m["closing"] for m in methods)),
                "summary": {"sales": r2(t["sales"]), "count": t["n"] or 0, "fiado": r2(t["fiado"]), "cobros": r2(t["cobros"]), "gastos": r2(t["gastos"]), "proveedores": r2(t["proveedores"])},
                "expected_cash": methods[0]["closing"], "closure": dict(closure) if closure else None, "moves": moves,
                "receivable": r2(recv), "payable": r2(pay)}

    @R.post("/cashflow/close")
    def close_cash(d: ClosureIn, u=Depends(current_user)):
        day = valid_day(d.day)
        if d.counted < 0:
            raise HTTPException(400, "El efectivo contado no puede ser negativo.")
        cf = cashflow(day, u)
        diff = r2(d.counted - cf["expected_cash"])
        with db.conn() as c:
            c.execute("""INSERT INTO cash_closures(store_id,day,expected,counted,diff,notes) VALUES (?,?,?,?,?,?)
                         ON CONFLICT(store_id,day) DO UPDATE SET expected=excluded.expected, counted=excluded.counted, diff=excluded.diff, notes=excluded.notes, created_at=datetime('now','localtime')""",
                      (u["store_id"], day, cf["expected_cash"], d.counted, diff, d.notes.strip()[:300]))
        return {"expected": cf["expected_cash"], "counted": d.counted, "diff": diff}

    @R.get("/cashflow/closures")
    def closures(u=Depends(current_user)):
        with db.conn() as c:
            return [dict(r) for r in c.execute("SELECT day,expected,counted,diff,notes FROM cash_closures WHERE store_id=? ORDER BY day DESC LIMIT 30", (u["store_id"],))]

    # ----- Datos fiscales (estructura AFIP) -----
    def load_fiscal(c, sid):
        raw = c.execute("SELECT fiscal FROM stores WHERE id=?", (sid,)).fetchone()[0]
        try:
            return {**afip.DEFAULT_FISCAL, **json.loads(raw or "{}")}
        except ValueError:
            return dict(afip.DEFAULT_FISCAL)

    @R.get("/fiscal")
    def get_fiscal(u=Depends(current_user)):
        with db.conn() as c:
            f = load_fiscal(c, u["store_id"])
        return {**f, "allowed_types": afip.allowed_types(f["cond_iva"]), "cuit_ok": afip.valid_cuit(f["cuit"])}

    @R.put("/fiscal")
    def put_fiscal(d: FiscalIn, u=Depends(current_user)):
        cuit = re.sub(r"\D", "", d.cuit or "")
        if d.cond_iva not in afip.COND_IVA:
            raise HTTPException(400, "Condición frente al IVA inválida.")
        if cuit and not afip.valid_cuit(cuit):
            raise HTTPException(400, "El CUIT no es válido (11 dígitos, verificá el último número).")
        if not 1 <= d.pto_vta <= 99999:
            raise HTTPException(400, "El punto de venta debe estar entre 1 y 99999.")
        if d.afip_enabled and not cuit:
            raise HTTPException(400, "Para activar AFIP primero cargá tu CUIT.")
        data = {"razon_social": d.razon_social.strip()[:100], "cuit": cuit, "cond_iva": d.cond_iva, "pto_vta": d.pto_vta, "domicilio": d.domicilio.strip()[:160],
                "inicio_actividades": d.inicio_actividades.strip()[:10], "ingresos_brutos": d.ingresos_brutos.strip()[:30], "afip_enabled": d.afip_enabled,
                "afip_env": d.afip_env if d.afip_env in ("homologacion", "produccion") else "homologacion"}
        with db.conn() as c:
            c.execute("UPDATE stores SET fiscal=? WHERE id=?", (json.dumps(data), u["store_id"]))
        return get_fiscal(u)

    # ----- Comprobantes -----
    @R.get("/invoices")
    def list_invoices(limit: int = 100, u=Depends(current_user)):
        with db.conn() as c:
            rows = c.execute("SELECT id,type,pto_vta,number,issue_date,client_name,total,method,status,afip_status,cae FROM invoices WHERE store_id=? ORDER BY id DESC LIMIT ?",
                             (u["store_id"], min(max(limit, 1), 300))).fetchall()
        return [{**dict(r), "full_number": afip.fmt_number(r["pto_vta"], r["number"])} for r in rows]

    def get_invoice(c, u, iid):
        inv = c.execute("SELECT * FROM invoices WHERE id=? AND store_id=?", (iid, u["store_id"])).fetchone()
        if not inv:
            raise HTTPException(404, "Comprobante inexistente.")
        inv = dict(inv); inv["full_number"] = afip.fmt_number(inv["pto_vta"], inv["number"])
        inv["items"] = [dict(r) for r in c.execute("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id", (iid,))]
        return inv

    @R.get("/invoices/{iid}")
    def invoice_detail(iid: int, u=Depends(current_user)):
        with db.conn() as c:
            inv, f = get_invoice(c, u, iid), load_fiscal(c, u["store_id"])
        inv["qr_url"] = afip.qr_url(inv, f)
        return inv

    @R.post("/invoices")
    def create_invoice(d: InvoiceIn, u=Depends(current_user)):
        sid = u["store_id"]
        if not d.items or len(d.items) > 50:
            raise HTTPException(400, "Agregá entre 1 y 50 ítems al comprobante.")
        if d.method not in PAY_METHODS + ("Fiado",):
            raise HTTPException(400, "Medio de pago inválido.")
        with db.conn() as c:
            f = load_fiscal(c, sid)
            cl = c.execute("SELECT * FROM clients WHERE id=? AND store_id=?", (d.client_id, sid)).fetchone() if d.client_id else None
            if d.method == "Fiado" and not cl:
                raise HTTPException(400, "Para vender a cuenta (fiado) elegí un cliente de tu base.")
            name = cl["name"] if cl else (d.client_name.strip()[:100] or "Consumidor Final")
            doc = re.sub(r"\D", "", (cl["cuit"] if cl and cl["cuit"] else d.client_doc) or "")
            ivac = d.client_iva if d.client_iva in afip.CLIENT_IVA else "Consumidor Final"
            typ = d.type or afip.suggest_type(f, ivac)
            if typ not in afip.allowed_types(f["cond_iva"]):
                raise HTTPException(400, f"Con condición {f['cond_iva']} podés emitir: {', '.join(afip.allowed_types(f['cond_iva']))}. Revisá tus datos fiscales.")
            if typ != "X" and not afip.valid_cuit(f["cuit"]):
                raise HTTPException(400, "Para emitir facturas A, B o C cargá primero tu CUIT en Datos fiscales.")
            if typ == "A" and not afip.valid_cuit(doc):
                raise HTTPException(400, "La Factura A requiere el CUIT válido del cliente.")
            doc_type = 80 if afip.valid_cuit(doc) else (96 if 7 <= len(doc) <= 8 else 99)
            if doc_type == 99:
                doc = "0"
            lines, net_t, iva_t = [], 0.0, 0.0
            for it in d.items:
                if it.qty < 1:
                    raise HTTPException(400, "Las cantidades deben ser al menos 1.")
                if it.product_id:
                    p, cost = take_product(c, sid, it.product_id, it.qty, it.variant_id)
                    price = it.unit_price if it.unit_price is not None else p["price"]
                    desc, pid, vid, vname = it.description.strip() or p["label"], p["id"], p.get("variant_id"), p["variant_name"]
                else:
                    if not it.description.strip() or it.unit_price is None:
                        raise HTTPException(400, "Cada ítem libre necesita descripción y precio.")
                    price, cost, desc, pid, vid, vname = it.unit_price, 0, it.description.strip()[:120], None, None, None
                if price < 0:
                    raise HTTPException(400, "Los precios no pueden ser negativos.")
                rate = it.iva_rate if typ in ("A", "B") and it.iva_rate in afip.IVA_RATES else 0
                total = round(price * it.qty, 2)
                n, i = afip.split_iva(total, rate) if rate else (total, 0.0)
                net_t += n; iva_t += i
                lines.append({"product_id": pid, "variant_id": vid, "variant_name": vname, "description": desc, "qty": it.qty, "unit_price": price, "iva_rate": rate, "total": total, "cost": cost})
            total = round(sum(l["total"] for l in lines), 2)
            if total <= 0:
                raise HTTPException(400, "El total del comprobante debe ser mayor a cero.")
            pto = int(f["pto_vta"])
            number = (c.execute("SELECT MAX(number) FROM invoices WHERE store_id=? AND type=? AND pto_vta=?", (sid, typ, pto)).fetchone()[0] or 0) + 1
            iid = c.execute("""INSERT INTO invoices(store_id,client_id,type,pto_vta,number,client_name,client_doc_type,client_doc,client_iva,net,iva,total,method,notes,afip_status)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (sid, cl["id"] if cl else None, typ, pto, number, name, doc_type, doc, ivac, r2(net_t), r2(iva_t), total, d.method, d.notes.strip()[:300],
                             "no_fiscal" if typ == "X" else "pendiente")).lastrowid
            label, fiado = f"Comp. {typ} {afip.fmt_number(pto, number)}", d.method == "Fiado"
            for l in lines:
                c.execute("INSERT INTO invoice_items(invoice_id,product_id,variant_id,description,qty,unit_price,iva_rate) VALUES (?,?,?,?,?,?,?)",
                          (iid, l["product_id"], l["variant_id"], l["description"], l["qty"], l["unit_price"], l["iva_rate"]))
                c.execute("""INSERT INTO sales(store_id,client_id,kind,concept,amount,cost,method,product_id,product_name,qty,variant_name,invoice_id)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                          (sid, cl["id"] if cl else None, "fiado" if fiado else "entrada", f"{label}: {l['description']}" if l["qty"] == 1 else f"{label}: {l['qty']} × {l['description']}",
                           l["total"], l["cost"], d.method, l["product_id"], l["description"] if l["product_id"] else None, l["qty"] if l["product_id"] else 0, l["variant_name"], iid))
            if fiado:
                c.execute("UPDATE clients SET balance = balance + ? WHERE id=?", (total, cl["id"]))
            msg = "Comprobante registrado."
            if typ != "X":                                                  # intento de CAE (hoy: queda pendiente hasta integrar WSFE)
                inv = get_invoice(c, u, iid)
                req = afip.build_fecae_request(inv, inv["items"], f)
                c.execute("UPDATE invoices SET afip_payload=? WHERE id=?", (json.dumps(req), iid))
                try:
                    r = afip.request_cae(req, f)
                    c.execute("UPDATE invoices SET cae=?, cae_due=?, afip_status='aprobado' WHERE id=?", (r["cae"], r["cae_due"], iid))
                    msg = "Comprobante autorizado por AFIP."
                except afip.AfipNotConfigured:
                    msg = "Comprobante guardado. Queda pendiente de CAE hasta conectar AFIP."
        return {"id": iid, "number": afip.fmt_number(pto, number), "message": msg}

    @R.post("/invoices/{iid}/annul")
    def annul_invoice(iid: int, u=Depends(current_user)):
        with db.conn() as c:
            inv = get_invoice(c, u, iid)
            if inv["status"] == "anulado":
                raise HTTPException(400, "El comprobante ya está anulado.")
            if inv["cae"]:
                raise HTTPException(400, "Una factura con CAE no se anula: corresponde emitir una nota de crédito (próxima versión).")
            for it in inv["items"]:                                         # devuelve el stock
                if it["product_id"]:
                    c.execute("UPDATE products SET stock = stock + ? WHERE id=? AND store_id=?", (it["qty"], it["product_id"], u["store_id"]))
                    if it["variant_id"]:
                        c.execute("UPDATE product_variants SET stock = stock + ? WHERE id=?", (it["qty"], it["variant_id"]))
                        sync_variant_stock(c, it["product_id"])
            if inv["method"] == "Fiado" and inv["client_id"]:
                c.execute("UPDATE clients SET balance = MAX(balance - ?, 0) WHERE id=?", (inv["total"], inv["client_id"]))
            c.execute("DELETE FROM sales WHERE invoice_id=?", (iid,))
            c.execute("UPDATE invoices SET status='anulado' WHERE id=?", (iid,))
        return {"ok": True}

    @R.get("/invoices/{iid}/pdf")
    def invoice_pdf(iid: int, u=Depends(current_user)):
        import invoice_pdf as ip
        with db.conn() as c:
            inv, f = get_invoice(c, u, iid), load_fiscal(c, u["store_id"])
        inv["qr_url"] = afip.qr_url(inv, f)
        return Response(ip.render(inv, f, u["business"]), media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="comprobante-{inv["type"]}-{inv["full_number"]}.pdf"'})

    return R
