"""Balance mensual (estilo Treinta): ingresos, egresos, ganancia estimada y desglose por medio de pago.

Se monta desde app.py con `app.include_router(balance.make_router(current_user))`.

  GET /api/balance?month=AAAA-MM   (sin `month`: el mes en curso)

Definiciones (iguales a las de Estadísticas, ver reports.py):
  Ingresos  = entradas de caja del mes (ventas cobradas y cobros de fiados)
  Egresos   = salidas de caja del mes (gastos y pagos a proveedores)
  Balance   = Ingresos - Egresos
  Ganancia  = Ventas del mes (cobradas + fiadas) - costo de los productos vendidos
Los movimientos anulados no suman, pero se listan marcados para poder restaurarlos (ver movements.py).
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import database as db
import operations as ops

r2 = ops.r2


def month_range(month):
    """'AAAA-MM' -> (desde, hasta_exclusivo) como texto 'AAAA-MM-DD' (las fechas se guardan como texto, comparan bien en SQLite y Postgres)."""
    try:
        y, m = (int(x) for x in (month or date.today().strftime("%Y-%m")).split("-"))
        first = date(y, m, 1)
    except (ValueError, TypeError):
        raise HTTPException(400, "El mes debe tener formato AAAA-MM.")
    if y < 2000 or first > date(date.today().year + 1, 12, 31):
        raise HTTPException(400, "El mes no es válido.")
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return first.isoformat(), nxt.isoformat()


def make_router(current_user):
    R = APIRouter(prefix="/api")

    @R.get("/balance")
    def balance(month: Optional[str] = Query(None), u=Depends(current_user)):
        sid, (d1, d2) = u["store_id"], month_range(month)
        with db.conn() as c:
            t = c.execute(f"""SELECT SUM(CASE WHEN kind='entrada' THEN amount END) i, SUM(CASE WHEN kind='salida' THEN amount END) o,
                       SUM(CASE WHEN {ops.SALE} THEN amount END) sales, SUM(CASE WHEN {ops.SALE} THEN cost END) cogs,
                       SUM(CASE WHEN {ops.SALE} AND qty=0 THEN 1 ELSE 0 END) loose
                       FROM sales WHERE store_id=? AND created_at >= ? AND created_at < ? AND voided_at IS NULL""", (sid, d1, d2)).fetchone()
            meth = {r["method"]: r for r in c.execute("""SELECT method, SUM(CASE WHEN kind='entrada' THEN amount END) i, SUM(CASE WHEN kind='salida' THEN amount END) o
                       FROM sales WHERE store_id=? AND created_at >= ? AND created_at < ? AND voided_at IS NULL AND kind IN ('entrada','salida') GROUP BY method""", (sid, d1, d2))}
            win = "AND s.created_at >= ? AND s.created_at < ? "
            incomes = ops.grouped_sales(c, sid, win + "AND s.kind='entrada' ", (d1, d2), 500)
            expenses = ops.grouped_sales(c, sid, win + "AND s.kind='salida' ", (d1, d2), 500)
            first = c.execute("SELECT MIN(created_at) f FROM sales WHERE store_id=?", (sid,)).fetchone()["f"]
        ing, egr, ventas, costo = r2(t["i"]), r2(t["o"]), r2(t["sales"]), r2(t["cogs"])
        methods = []
        for m in ops.PAY_METHODS:
            r = meth.get(m)
            i, o = r2(r["i"]) if r else 0, r2(r["o"]) if r else 0
            methods.append({"method": m, "inflow": i, "outflow": o, "net": r2(i - o)})
        return {"month": d1[:7], "first_month": (first or d1)[:7],
                "income": ing, "expense": egr, "balance": r2(ing - egr),
                "profit": {"sales": ventas, "cost": costo, "estimated": r2(ventas - costo), "no_cost_items": int(t["loose"] or 0)},
                "methods": methods, "incomes": incomes, "expenses": expenses}

    return R
