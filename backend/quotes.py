"""Presupuestos: se arman como una venta (productos o ítems libres con su precio), se guardan y se mandan al cliente como imagen / WhatsApp.

Se monta desde app.py con `app.include_router(quotes.make_router(current_user))`.
Un presupuesto NO descuenta stock ni mueve la caja: es solo la cotización. Estados: pendiente · aceptado · rechazado.

  GET    /api/quotes            lista (más nuevos primero)
  GET    /api/quotes/{id}       detalle con ítems
  POST   /api/quotes            crear
  PUT    /api/quotes/{id}/status  {status}
  DELETE /api/quotes/{id}
"""
import json, math, re
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import database as db

STATUS = ("pendiente", "aceptado", "rechazado")
r2 = lambda x: round(float(x or 0), 2)


class QuoteItemIn(BaseModel):
    name: str
    qty: int = 1
    price: float = 0
    product_id: Optional[int] = None


class QuoteIn(BaseModel):
    items: list[QuoteItemIn]
    discount: float = 0
    client_id: Optional[int] = None
    client_name: str = ""
    client_phone: str = ""
    valid_days: int = 7            # validez desde hoy (0 = sin vencimiento)
    note: str = ""


class StatusIn(BaseModel):
    status: str


def _view(r, full=False):
    d = {k: r[k] for k in ("id", "number", "client_id", "client_name", "client_phone", "subtotal", "discount", "total", "valid_until", "note", "status", "created_at")}
    items = json.loads(r["items"] or "[]")
    d["n_items"] = len(items)
    if full:
        d["items"] = items
    d["expired"] = bool(r["valid_until"] and r["valid_until"] < date.today().isoformat() and r["status"] == "pendiente")
    return d


def make_router(current_user):
    R = APIRouter(prefix="/api")

    @R.get("/quotes")
    def list_quotes(u=Depends(current_user)):
        with db.conn() as c:
            rows = c.execute("SELECT * FROM quotes WHERE store_id=? ORDER BY id DESC LIMIT 300", (u["store_id"],)).fetchall()
        return [_view(r) for r in rows]

    @R.get("/quotes/{qid}")
    def get_quote(qid: int, u=Depends(current_user)):
        with db.conn() as c:
            r = c.execute("SELECT * FROM quotes WHERE id=? AND store_id=?", (qid, u["store_id"])).fetchone()
        if not r:
            raise HTTPException(404, "El presupuesto no existe.")
        return _view(r, full=True)

    @R.post("/quotes")
    def create_quote(d: QuoteIn, u=Depends(current_user)):
        sid = u["store_id"]
        if not d.items or len(d.items) > 60:
            raise HTTPException(400, "Agregá al menos un producto o ítem (máximo 60).")
        items = []
        for it in d.items:
            name = re.sub(r"\s+", " ", it.name or "").strip()[:150]
            if not name:
                raise HTTPException(400, "Todos los ítems necesitan un nombre.")
            if not 1 <= it.qty <= 100000:
                raise HTTPException(400, "La cantidad debe ser entre 1 y 100.000.")
            if not (math.isfinite(it.price) and 0 <= it.price <= 1e12):
                raise HTTPException(400, "El precio no es válido.")
            items.append({"name": name, "qty": it.qty, "unit": r2(it.price), "product_id": it.product_id})
        subtotal = r2(sum(i["qty"] * i["unit"] for i in items))
        disc = r2(min(max(d.discount if math.isfinite(d.discount) else 0, 0), subtotal))
        total = r2(subtotal - disc)
        if total <= 0:
            raise HTTPException(400, "El total del presupuesto debe ser mayor a cero.")
        if not 0 <= d.valid_days <= 365:
            raise HTTPException(400, "La validez debe estar entre 0 y 365 días.")
        valid = (date.today() + timedelta(days=d.valid_days)).isoformat() if d.valid_days else None
        phone = re.sub(r"[^\d+]", "", d.client_phone or "")[:20]
        with db.conn() as c:
            cl = c.execute("SELECT id,name,phone FROM clients WHERE id=? AND store_id=?", (d.client_id, sid)).fetchone() if d.client_id else None
            name = cl["name"] if cl else re.sub(r"\s+", " ", d.client_name or "").strip()[:100]
            phone = phone or (cl["phone"] if cl and cl["phone"] else "")
            number = (c.execute("SELECT MAX(number) m FROM quotes WHERE store_id=?", (sid,)).fetchone()["m"] or 0) + 1
            qid = c.execute("""INSERT INTO quotes(store_id,number,client_id,client_name,client_phone,items,subtotal,discount,total,valid_until,note)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                            (sid, number, cl["id"] if cl else None, name, phone, json.dumps(items, ensure_ascii=False), subtotal, disc, total, valid,
                             re.sub(r"[ \t]+", " ", d.note or "").strip()[:300])).lastrowid
            r = c.execute("SELECT * FROM quotes WHERE id=?", (qid,)).fetchone()
        return _view(r, full=True)

    @R.put("/quotes/{qid}/status")
    def set_status(qid: int, d: StatusIn, u=Depends(current_user)):
        if d.status not in STATUS:
            raise HTTPException(400, "Estado inválido.")
        with db.conn() as c:
            if not c.execute("UPDATE quotes SET status=? WHERE id=? AND store_id=?", (d.status, qid, u["store_id"])).rowcount:
                raise HTTPException(404, "El presupuesto no existe.")
        return {"ok": True}

    @R.delete("/quotes/{qid}")
    def delete_quote(qid: int, u=Depends(current_user)):
        with db.conn() as c:
            if not c.execute("DELETE FROM quotes WHERE id=? AND store_id=?", (qid, u["store_id"])).rowcount:
                raise HTTPException(404, "El presupuesto no existe.")
        return {"ok": True}

    return R
