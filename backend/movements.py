"""Corrección de movimientos de caja: editar, anular y restaurar entradas y salidas.

Se monta desde app.py con `app.include_router(movements.make_router(current_user))`.

  PUT  /api/sales/{id}          editar concepto, monto, medio de pago, fecha, cantidad o tipo (entrada ⇄ salida)
  POST /api/sales/{id}/void     anular (cancelaron el pedido, error de carga): no se borra, queda marcado en el historial
  POST /api/sales/{id}/restore  deshacer una anulación

Qué pasa en cada caso (todo en una sola transacción: si algo falla, no se cambia nada):
  - Anular una venta con producto devuelve el stock (y el de su variante).
  - Anular un fiado descuenta esa deuda del cliente; anular el cobro de un fiado hace que el cliente vuelva a deber ese monto.
  - Un movimiento anulado no suma en caja, flujo de caja, estadísticas ni reportes (columna `sales.voided_at`, ver `voided_at IS NULL`).
  - Editar la cantidad ajusta el stock; editar el monto de un fiado o de un cobro ajusta la deuda del cliente.
  - Una venta con varios productos (mismo `ticket`) se anula entera; de esa venta solo se pueden editar el nombre, el medio de pago y la fecha.
  - Los movimientos de un comprobante o de un pago a proveedor no se tocan desde acá: también mueven otra cuenta (comprobantes / cuenta corriente).
"""
import re
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import database as db
import operations as ops

r2 = ops.r2
NOW = "datetime('now','localtime')"


class MoveEditIn(BaseModel):
    concept: Optional[str] = None
    amount: Optional[float] = None
    method: Optional[str] = None
    kind: Optional[str] = None          # 'entrada' | 'salida' (solo movimientos sin producto)
    qty: Optional[int] = None
    date: str = ""                      # AAAA-MM-DD; vacío o igual al día actual del movimiento = no cambia


class VoidIn(BaseModel):
    reason: str = ""


# ---------------------------------------------------------------- helpers
def _rows(c, sid, mid):
    """El movimiento y, si es una venta con varios productos, todas las filas de esa venta."""
    base = c.execute("SELECT * FROM sales WHERE id=? AND store_id=?", (mid, sid)).fetchone()
    if not base:
        raise HTTPException(404, "El movimiento no existe.")
    if base["ticket"]:
        rows = c.execute("SELECT * FROM sales WHERE store_id=? AND ticket=? ORDER BY id", (sid, base["ticket"])).fetchall()
    else:
        rows = [base]
    return [dict(r) for r in rows]


def _check_manageable(rows):
    for r in rows:
        if r["invoice_id"]:
            raise HTTPException(400, "Este movimiento viene de un comprobante: anulá el comprobante desde la sección Comprobantes.")
        if r["supplier_id"]:
            raise HTTPException(400, "Es un pago a un proveedor y también cambia su cuenta corriente, por eso no se puede corregir desde acá.")


def _has_item(r):
    """Fila de venta con producto (descontó stock): entrada o fiado, no es cobro de fiado."""
    return r["kind"] in ("entrada", "fiado") and not r["is_payment"] and bool(r["product_id"]) and (r["qty"] or 0) > 0


def _stock(c, sid, r, sign, qty=None):
    """Mueve stock: sign=+1 devuelve unidades, sign=-1 las descuenta. False si el producto (o su variante) ya no existe."""
    qty = r["qty"] if qty is None else qty
    if not r["product_id"] or not qty or qty < 1:
        return True
    p = c.execute("SELECT id,name,stock FROM products WHERE id=? AND store_id=?", (r["product_id"], sid)).fetchone()
    if not p:
        return False
    if ops.has_variants(c, p["id"]):
        v = c.execute("SELECT id,name,stock FROM product_variants WHERE product_id=? AND name=?", (p["id"], r["variant_name"] or "")).fetchone()
        if not v:
            return False
        if sign < 0 and v["stock"] < qty:
            raise HTTPException(400, f"Stock insuficiente de {p['name']} ({v['name']}): quedan {v['stock']}.")
        c.execute("UPDATE product_variants SET stock = stock + ? WHERE id=?", (sign * qty, v["id"]))
        c.execute("UPDATE products SET stock = stock + ? WHERE id=?", (sign * qty, p["id"]))
    else:
        if sign < 0 and p["stock"] < qty:
            raise HTTPException(400, f"Stock insuficiente de {p['name']}: quedan {p['stock']}.")
        c.execute("UPDATE products SET stock = stock + ? WHERE id=?", (sign * qty, p["id"]))
    return True


def _bump_balance(c, cid, delta):
    """Suma (o resta) a lo que debe un cliente, sin dejarlo en negativo. Hecho en Python para que ande igual en SQLite y Postgres."""
    if not cid:
        return
    cl = c.execute("SELECT balance FROM clients WHERE id=?", (cid,)).fetchone()
    if cl:
        c.execute("UPDATE clients SET balance=? WHERE id=?", (max(r2((cl["balance"] or 0) + delta), 0), cid))


def _closed_days(c, sid, days):
    """Días tocados que ya tenían cierre de caja (el cierre guardado no se recalcula: conviene revisarlo)."""
    return [d for d in sorted(set(days)) if c.execute("SELECT 1 FROM cash_closures WHERE store_id=? AND day=?", (sid, d)).fetchone()]


def _new_when(date_str, old):
    d = (date_str or "").strip()
    if not d or d == old[:10]:
        return None
    try:
        day = datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "La fecha no es válida.")
    if day.date() > (datetime.now() + timedelta(days=1)).date():      # +1 día de margen por la diferencia horaria con el celular
        raise HTTPException(400, "La fecha no puede ser futura.")
    if day.year < 2000:
        raise HTTPException(400, "La fecha no es válida.")
    return d + " 12:00:00"


def _ars(x):
    return "$" + f"{x:,.0f}".replace(",", ".")


# ---------------------------------------------------------------- rutas
def make_router(current_user):
    R = APIRouter(prefix="/api")

    @R.put("/sales/{mid}")
    def edit_move(mid: int, d: MoveEditIn, u=Depends(current_user)):
        sid = u["store_id"]
        with db.conn() as c:
            rows = _rows(c, sid, mid)
            _check_manageable(rows)
            r = rows[0]
            if r["voided_at"]:
                raise HTTPException(400, "Este movimiento está anulado: restauralo antes de editarlo.")
            when = _new_when(d.date, r["created_at"])
            fiado = r["kind"] == "fiado"
            method = r["method"]
            if d.method is not None and d.method != r["method"] and not fiado:
                if d.method not in ops.PAY_METHODS:
                    raise HTTPException(400, "Medio de pago inválido.")
                method = d.method
            concept = None
            if d.concept is not None:
                concept = re.sub(r"\s+", " ", d.concept).strip()[:160]
                if not concept and len(rows) == 1:
                    raise HTTPException(400, "El concepto no puede quedar vacío.")

            # ---- venta con varios productos: solo nombre, medio y fecha
            if len(rows) > 1:
                total = r2(sum(x["amount"] for x in rows))
                if (d.amount is not None and abs(d.amount - total) > 0.005) or d.qty is not None or (d.kind is not None and d.kind != r["kind"]):
                    raise HTTPException(400, "Una venta con varios productos solo permite cambiar el nombre, el medio de pago y la fecha. "
                                             "Para cambiar montos o cantidades, anulala y cargala de nuevo.")
                sets, args = ["method=?", "edited_at=" + NOW], [method]
                if concept is not None:
                    sets.append("ticket_concept=?"); args.append(concept)
                if when:
                    sets.append("created_at=?"); args.append(when)
                c.execute(f"UPDATE sales SET {','.join(sets)} WHERE store_id=? AND ticket=?", (*args, sid, r["ticket"]))
                return {"ok": True, "closed_days": _closed_days(c, sid, [x["created_at"][:10] for x in rows] + ([when[:10]] if when else []))}

            # ---- una sola fila
            item, pay = _has_item(r), bool(r["is_payment"])
            plain = not item and not pay and r["kind"] in ("entrada", "salida")
            kind = r["kind"]
            if d.kind is not None and d.kind != r["kind"]:
                if not plain or d.kind not in ("entrada", "salida"):
                    raise HTTPException(400, "Este movimiento no se puede pasar de entrada a salida (o al revés).")
                kind = d.kind
            amount = r["amount"] if d.amount is None else r2(d.amount)
            if not 0 < amount <= 1e12:                                  # también frena NaN / infinito
                raise HTTPException(400, "El monto debe ser mayor a cero.")

            qty, cost = r["qty"], r["cost"]
            if d.qty is not None and d.qty != r["qty"]:
                if not item:
                    raise HTTPException(400, "Este movimiento no tiene un producto: no hay cantidad para cambiar.")
                if d.qty < 1:
                    raise HTTPException(400, "La cantidad debe ser al menos 1.")
                delta = d.qty - r["qty"]
                if not _stock(c, sid, r, -1 if delta > 0 else 1, abs(delta)):
                    raise HTTPException(400, "El producto (o su variante) ya no existe, así que no se puede ajustar el stock. "
                                             "Anulá el movimiento y cargalo de nuevo.")
                qty, cost = d.qty, r2((r["cost"] or 0) / r["qty"] * d.qty)
                old_txt = f"{r['qty']} × "
                if (concept is None or concept == (r["concept"] or "").strip()) and old_txt in (r["concept"] or ""):
                    concept = r["concept"].replace(old_txt, f"{qty} × ", 1)       # «2 × Remera» → «3 × Remera»
            if concept is None:
                concept = r["concept"]

            diff = r2(amount - r["amount"])
            if abs(diff) > 0.004:
                if fiado and not pay:
                    _bump_balance(c, r["client_id"], diff)                       # el fiado cambió: la deuda cambia igual
                elif pay:
                    cl = c.execute("SELECT balance FROM clients WHERE id=?", (r["client_id"],)).fetchone() if r["client_id"] else None
                    if not cl:
                        raise HTTPException(400, "El cliente de este cobro ya no existe: solo se puede editar el concepto, el medio y la fecha.")
                    owed = r2((cl["balance"] or 0) + r["amount"])                 # lo que debía antes de este cobro
                    if amount > owed + 0.005:
                        raise HTTPException(400, f"El cobro no puede superar lo que el cliente debía ({_ars(owed)}).")
                    c.execute("UPDATE clients SET balance=? WHERE id=?", (max(r2(owed - amount), 0), r["client_id"]))

            sets = ["concept=?", "amount=?", "cost=?", "qty=?", "method=?", "kind=?", "edited_at=" + NOW]
            args = [concept, amount, cost, qty, "Fiado" if fiado else method, kind]
            if when:
                sets.append("created_at=?"); args.append(when)
            c.execute(f"UPDATE sales SET {','.join(sets)} WHERE id=? AND store_id=?", (*args, r["id"], sid))
            return {"ok": True, "closed_days": _closed_days(c, sid, [r["created_at"][:10]] + ([when[:10]] if when else []))}

    @R.post("/sales/{mid}/void")
    def void_move(mid: int, d: VoidIn, u=Depends(current_user)):
        sid = u["store_id"]
        with db.conn() as c:
            rows = _rows(c, sid, mid)
            _check_manageable(rows)
            if any(r["voided_at"] for r in rows):
                raise HTTPException(400, "Este movimiento ya está anulado.")
            back = lost = 0
            for r in rows:
                if _has_item(r):
                    if _stock(c, sid, r, +1):
                        back += r["qty"]
                    else:
                        lost += r["qty"]                                            # el producto se borró: no hay stock al que devolver
                if r["is_payment"]:
                    _bump_balance(c, r["client_id"], +r["amount"])                  # el cobro se cae: el cliente vuelve a deber
                elif r["kind"] == "fiado":
                    _bump_balance(c, r["client_id"], -r["amount"])                  # el fiado se cae: deja de deber
            ids = [r["id"] for r in rows]
            reason = re.sub(r"\s+", " ", d.reason or "").strip()[:120]
            c.execute(f"UPDATE sales SET voided_at={NOW}, void_reason=? WHERE store_id=? AND id IN ({','.join('?' * len(ids))})", (reason or None, sid, *ids))
            return {"ok": True, "stock_back": back, "stock_lost": lost, "closed_days": _closed_days(c, sid, [r["created_at"][:10] for r in rows])}

    @R.post("/sales/{mid}/restore")
    def restore_move(mid: int, u=Depends(current_user)):
        sid = u["store_id"]
        with db.conn() as c:
            rows = _rows(c, sid, mid)
            _check_manageable(rows)
            if not all(r["voided_at"] for r in rows):
                raise HTTPException(400, "Este movimiento no está anulado.")
            for r in rows:
                if _has_item(r):
                    _stock(c, sid, r, -1)                                           # vuelve a descontar (avisa si ya no alcanza)
                if r["is_payment"]:
                    cl = c.execute("SELECT balance FROM clients WHERE id=?", (r["client_id"],)).fetchone() if r["client_id"] else None
                    if cl and (cl["balance"] or 0) + 0.005 < r["amount"]:
                        raise HTTPException(400, "No se puede restaurar este cobro: el cliente ya no debe ese monto.")
                    _bump_balance(c, r["client_id"], -r["amount"])
                elif r["kind"] == "fiado":
                    _bump_balance(c, r["client_id"], +r["amount"])
            ids = [r["id"] for r in rows]
            c.execute(f"UPDATE sales SET voided_at=NULL, void_reason=NULL, edited_at={NOW} WHERE store_id=? AND id IN ({','.join('?' * len(ids))})", (sid, *ids))
            return {"ok": True, "closed_days": _closed_days(c, sid, [r["created_at"][:10] for r in rows])}

    return R
