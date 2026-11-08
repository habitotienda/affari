"""Estadísticas y balances. Solo lectura: todo se calcula desde la tabla `sales`.

Definiciones (iguales en pantalla, Excel y PDF):
  Ventas             = ventas cobradas + ventas fiadas del período (los cobros de fiados NO son ventas nuevas)
  Costo mercadería   = suma del costo de los productos vendidos
  Ganancia bruta     = Ventas - Costo mercadería
  Gastos             = salidas de caja registradas como gasto (los pagos a proveedores NO: la mercadería ya se descuenta en el costo)
  Ganancia neta      = Ganancia bruta - Gastos
"""
from datetime import date, timedelta

SALE = "kind IN ('entrada','fiado') AND is_payment=0"
IN_RANGE = "store_id=? AND date(created_at) BETWEEN ? AND ?"
MAX_DAYS = 731

def parse_range(date_from, date_to):
    today = date.today()
    try:
        d1 = date.fromisoformat(date_from) if date_from else today.replace(day=1)
        d2 = date.fromisoformat(date_to) if date_to else today
    except ValueError:
        raise ValueError("Las fechas deben tener formato AAAA-MM-DD.")
    if d2 < d1:
        raise ValueError("La fecha 'hasta' no puede ser anterior a 'desde'.")
    if (d2 - d1).days >= MAX_DAYS:
        raise ValueError("El período máximo es de 2 años.")
    return d1, d2

def _r(x):
    return round(float(x or 0), 2)

def _totals(c, sid, d1, d2):
    r = c.execute(f"""SELECT
        SUM(CASE WHEN {SALE} THEN amount END) sales, SUM(CASE WHEN {SALE} THEN cost END) cogs,
        SUM(CASE WHEN kind='salida' AND supplier_id IS NULL THEN amount END) expenses, COUNT(CASE WHEN {SALE} THEN 1 END) n,
        SUM(CASE WHEN kind='fiado' THEN amount END) fiado_new, SUM(CASE WHEN is_payment=1 THEN amount END) fiado_paid
        FROM sales WHERE {IN_RANGE}""", (sid, d1.isoformat(), d2.isoformat())).fetchone()
    sales, cogs, exp = _r(r["sales"]), _r(r["cogs"]), _r(r["expenses"])
    gross, net = sales - cogs, sales - cogs - exp
    return {"sales": sales, "cogs": cogs, "gross": _r(gross), "expenses": exp, "costs": _r(cogs + exp), "net": _r(net),
            "margin": _r(net / sales * 100) if sales else 0, "count": r["n"] or 0, "avg_ticket": _r(sales / r["n"]) if r["n"] else 0,
            "fiado_new": _r(r["fiado_new"]), "fiado_paid": _r(r["fiado_paid"])}

def build(c, sid, d1, d2):
    days = (d2 - d1).days + 1
    p1, p2 = d1 - timedelta(days=days), d1 - timedelta(days=1)       # período anterior de igual duración
    args = (sid, d1.isoformat(), d2.isoformat())

    per_day = {r["d"]: r for r in c.execute(f"""SELECT date(created_at) d,
        SUM(CASE WHEN {SALE} THEN amount END) sales, SUM(CASE WHEN {SALE} THEN cost END) cogs,
        SUM(CASE WHEN kind='salida' AND supplier_id IS NULL THEN amount END) expenses FROM sales WHERE {IN_RANGE} GROUP BY d""", args)}
    daily = []
    for i in range(days):
        d = (d1 + timedelta(days=i)).isoformat(); r = per_day.get(d)
        s, k, g = (_r(r["sales"]), _r(r["cogs"]), _r(r["expenses"])) if r else (0, 0, 0)
        daily.append({"date": d, "sales": s, "cogs": k, "expenses": g, "costs": _r(k + g), "net": _r(s - k - g)})

    methods = [{"method": r["method"], "inflow": _r(r["i"]), "outflow": _r(r["o"]), "balance": _r((r["i"] or 0) - (r["o"] or 0))}
               for r in c.execute(f"""SELECT method, SUM(CASE WHEN kind='entrada' THEN amount END) i, SUM(CASE WHEN kind='salida' THEN amount END) o
               FROM sales WHERE {IN_RANGE} AND kind IN ('entrada','salida') GROUP BY method ORDER BY i DESC""", args)]

    products = [{"name": r["name"] or "Producto sin nombre", "units": r["units"], "revenue": _r(r["revenue"]), "cost": _r(r["cost"]),
                 "profit": _r((r["revenue"] or 0) - (r["cost"] or 0))}
                for r in c.execute(f"""SELECT MIN(COALESCE(p.name, s.product_name)) name, SUM(s.qty) units, SUM(s.amount) revenue, SUM(s.cost) cost
                FROM sales s LEFT JOIN products p ON p.id = s.product_id
                WHERE s.store_id=? AND date(s.created_at) BETWEEN ? AND ? AND {SALE} AND s.qty > 0
                GROUP BY COALESCE(CAST(s.product_id AS TEXT), s.product_name) ORDER BY units DESC, revenue DESC LIMIT 50""", args)]
    loose = c.execute(f"SELECT COUNT(*) n, SUM(amount) a FROM sales WHERE {IN_RANGE} AND {SALE} AND qty=0", args).fetchone()

    expenses = [{"concept": r["concept"], "count": r["n"], "total": _r(r["t"])}
                for r in c.execute(f"""SELECT MIN(concept) concept, COUNT(*) n, SUM(amount) t FROM sales WHERE {IN_RANGE} AND kind='salida' AND supplier_id IS NULL
                GROUP BY lower(trim(concept)) ORDER BY t DESC LIMIT 10""", args)]

    moves = [dict(r) for r in c.execute(f"""SELECT created_at, kind, is_payment, concept, method, amount, cost FROM sales
                WHERE {IN_RANGE} ORDER BY created_at, id LIMIT 5000""", args)]
    pending = c.execute("SELECT SUM(balance) b, COUNT(CASE WHEN balance>0 THEN 1 END) n FROM clients WHERE store_id=?", (sid,)).fetchone()

    return {"period": {"from": d1.isoformat(), "to": d2.isoformat(), "days": days},
            "totals": _totals(c, sid, d1, d2), "prev": _totals(c, sid, p1, p2),
            "daily": daily, "methods": methods, "products": products,
            "unassigned": {"count": loose["n"] or 0, "amount": _r(loose["a"])},
            "expenses": expenses, "movements": moves,
            "fiados": {"pending": _r(pending["b"]), "clients": pending["n"] or 0}}
