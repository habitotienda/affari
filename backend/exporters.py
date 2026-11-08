"""Exportación de balances a Excel (.xlsx, con fórmulas vivas y gráfico) y PDF (reportlab)."""
import io
from datetime import datetime

NAVY, EMERALD, RED, SLATE = "0F172A", "10B981", "BE123C", "64748B"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
KIND = {"entrada": "Entrada", "salida": "Salida", "fiado": "Fiado"}

def _date(iso):
    y, m, d = iso[:10].split("-"); return f"{d}/{m}/{y}"

def _period(r):
    return f'{_date(r["period"]["from"])} al {_date(r["period"]["to"])} ({r["period"]["days"]} días)'

def _kind(m):
    return "Cobro de fiado" if m["is_payment"] else KIND.get(m["kind"], m["kind"])

# ───────────────────────────── Excel ─────────────────────────────
def to_xlsx(r, store):
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter as L

    MONEY, PCT = '"$"#,##0;[Red]-"$"#,##0', "0.0%"
    F = lambda **k: Font(name="Arial", size=k.pop("size", 10), **k)
    head_fill, thin = PatternFill("solid", fgColor=NAVY), Side(style="thin", color="E2E8F0")
    wb = Workbook()

    def table(ws, row, headers, rows, money=(), pct=(), widths=None):
        for j, h in enumerate(headers, 1):
            c = ws.cell(row, j, h); c.font = F(bold=True, color="FFFFFF"); c.fill = head_fill
            c.alignment = Alignment(horizontal="left" if j == 1 else "center", vertical="center", wrap_text=True)
        ws.row_dimensions[row].height = 24
        for i, vals in enumerate(rows, row + 1):
            for j, v in enumerate(vals, 1):
                c = ws.cell(i, j, v); c.font = F(); c.border = Border(bottom=thin)
                if j in money: c.number_format = MONEY
                if j in pct: c.number_format = PCT
        for j, w in enumerate(widths or [], 1): ws.column_dimensions[L(j)].width = w
        return row + len(rows)          # última fila escrita

    def total_row(ws, row, first, last, cols, label="Total", money=(), pct_formula=None):
        ws.cell(row, 1, label)
        for j in cols: ws.cell(row, j, f"=SUM({L(j)}{first}:{L(j)}{last})").number_format = MONEY
        for c in ws[row]:
            c.font = F(bold=True); c.fill = PatternFill("solid", fgColor="ECFDF5"); c.border = Border(top=Side(style="medium", color=EMERALD))

    # --- Por día (los demás datos referencian estos totales)
    wd = wb.active; wd.title = "Por día"
    wd.sheet_view.showGridLines = False
    wd["A1"] = "Resultado día por día"; wd["A1"].font = F(bold=True, size=14, color=NAVY)
    rows = [[_date(d["date"]), d["sales"], d["cogs"], d["expenses"], f"=C{i}+D{i}", f"=B{i}-E{i}"] for i, d in enumerate(r["daily"], 4)]
    last = table(wd, 3, ["Fecha", "Ventas", "Costo de mercadería", "Gastos", "Costos totales", "Ganancia neta"], rows, money=range(2, 7), widths=[14, 16, 20, 16, 16, 16])
    first, tot = 4, last + 1
    total_row(wd, tot, first, last, range(2, 7))
    wd.freeze_panes = "A4"
    if len(r["daily"]) > 1:
        ch = BarChart(); ch.type = "col"; ch.title = "Costos vs ganancia neta"; ch.height, ch.width = 8.5, 20
        ch.add_data(Reference(wd, min_col=5, max_col=6, min_row=3, max_row=last), titles_from_data=True)
        ch.set_categories(Reference(wd, min_col=1, min_row=first, max_row=last))
        ch.series[0].graphicalProperties.solidFill = SLATE; ch.series[1].graphicalProperties.solidFill = EMERALD
        wd.add_chart(ch, "H3")

    # --- Resumen
    ws = wb.create_sheet("Resumen", 0); ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 34; ws.column_dimensions["B"].width = 20; ws.column_dimensions["C"].width = 60
    ws["A1"] = f"Balance de gestión · {store}"; ws["A1"].font = F(bold=True, size=16, color=NAVY)
    ws["A2"] = f"Período: {_period(r)}"; ws["A2"].font = F(color=SLATE)
    ws["A3"] = f'Generado el {datetime.now().strftime("%d/%m/%Y %H:%M")} con Affari'; ws["A3"].font = F(color=SLATE, size=9)
    t, fi = r["totals"], r["fiados"]
    D = "'Por día'!"
    lines = [("Ventas", f"={D}B{tot}", "Ventas cobradas + fiadas (los cobros de fiados no se cuentan dos veces)", MONEY),
             ("Costo de mercadería", f"={D}C{tot}", "Lo que costó lo que vendiste", MONEY),
             ("Ganancia bruta", "=B5-B6", "Ventas − costo de mercadería", MONEY),
             ("Gastos", f"={D}D{tot}", "Alquiler, sueldos, servicios y otros gastos registrados", MONEY),
             ("Ganancia neta", "=B7-B8", "Ganancia bruta − gastos", MONEY),
             ("Margen neto", "=IFERROR(B9/B5,0)", "Ganancia neta sobre ventas", PCT),
             ("Operaciones de venta", t["count"], "Cantidad de ventas del período", "0"),
             ("Ticket promedio", "=IFERROR(B5/B11,0)", "Ventas ÷ operaciones", MONEY),
             ("Fiado otorgado", t["fiado_new"], "Ventas anotadas en el cuaderno en este período", MONEY),
             ("Cobros de fiados", t["fiado_paid"], "Deuda cobrada en este período", MONEY),
             ("Fiados pendientes hoy", fi["pending"], f'{fi["clients"]} clientes con deuda (saldo actual, no del período)', MONEY)]
    for i, (a, b, note, fmt) in enumerate(lines, 5):
        ws.cell(i, 1, a).font = F(bold=a in ("Ganancia bruta", "Ganancia neta"))
        c = ws.cell(i, 2, b); c.number_format = fmt; c.font = F(bold=a in ("Ganancia bruta", "Ganancia neta"))
        ws.cell(i, 3, note).font = F(color=SLATE, size=9)
        for j in (1, 2, 3): ws.cell(i, j).border = Border(bottom=thin)
    ws["A9"].fill = ws["B9"].fill = PatternFill("solid", fgColor="ECFDF5")
    if r["unassigned"]["count"]:
        ws["A17"] = f'Nota: {r["unassigned"]["count"]} ventas por {r["unassigned"]["amount"]:,.0f} se cargaron sin producto y no aparecen en el ranking.'.replace(",", ".")
        ws["A17"].font = F(color=SLATE, size=9)

    # --- Productos
    wp = wb.create_sheet("Productos"); wp.sheet_view.showGridLines = False
    wp["A1"] = "Productos más vendidos"; wp["A1"].font = F(bold=True, size=14, color=NAVY)
    rows = [[i, p["name"], p["units"], p["revenue"], p["cost"], f"=D{i + 3}-E{i + 3}", f"=IFERROR(F{i + 3}/D{i + 3},0)"] for i, p in enumerate(r["products"], 1)]
    if rows:
        last = table(wp, 3, ["#", "Producto", "Unidades", "Ingresos", "Costo", "Ganancia", "Margen"], rows, money=(4, 5, 6), pct=(7,), widths=[6, 34, 12, 16, 16, 16, 12])
        total_row(wp, last + 1, 4, last, (3, 4, 5, 6)); wp.cell(last + 1, 3).number_format = "0"
        wp.cell(last + 1, 1).value = None; wp.cell(last + 1, 2, "Total")
        wp.freeze_panes = "A4"
    else:
        wp["A3"] = "Todavía no hay ventas con producto en este período."

    # --- Medios de pago
    wm = wb.create_sheet("Medios de pago"); wm.sheet_view.showGridLines = False
    wm["A1"] = "Caja por medio de pago"; wm["A1"].font = F(bold=True, size=14, color=NAVY)
    rows = [[m["method"], m["inflow"], m["outflow"], f"=B{i}-C{i}"] for i, m in enumerate(r["methods"], 4)]
    if rows:
        last = table(wm, 3, ["Medio", "Ingresos", "Egresos", "Saldo"], rows, money=(2, 3, 4), widths=[22, 16, 16, 16])
        total_row(wm, last + 1, 4, last, (2, 3, 4))
    if r["expenses"]:
        base = len(rows) + 8
        wm.cell(base - 1, 1, "Principales gastos").font = F(bold=True, size=12, color=NAVY)
        table(wm, base, ["Concepto", "Cantidad", "Total"], [[e["concept"], e["count"], e["total"]] for e in r["expenses"]], money=(3,))

    # --- Movimientos
    wv = wb.create_sheet("Movimientos")
    rows = [[m["created_at"][:16].replace("-", "/") if False else f'{_date(m["created_at"])} {m["created_at"][11:16]}', _kind(m), m["concept"], m["method"], m["amount"] * (-1 if m["kind"] == "salida" else 1), m["cost"]] for m in r["movements"]]
    last = table(wv, 1, ["Fecha", "Tipo", "Concepto", "Medio", "Monto", "Costo"], rows, money=(5, 6), widths=[17, 16, 46, 16, 16, 14])
    wv.freeze_panes = "A2"; wv.auto_filter.ref = f"A1:F{max(last, 2)}"

    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

# ───────────────────────────── PDF ─────────────────────────────
def _ars(n):
    s = f"{abs(n):,.0f}".replace(",", "."); return f"-$ {s}" if n < 0 else f"$ {s}"

def _safe(s):
    """Helvetica solo cubre Latin-1: se descartan emojis y símbolos fuera de rango."""
    return str(s or "").encode("cp1252", "ignore").decode("cp1252")

def _buckets(daily, max_bars=30):
    step = -(-len(daily) // max_bars)
    out = []
    for i in range(0, len(daily), step):
        ch = daily[i:i + step]
        out.append((_date(ch[0]["date"])[:5] if step == 1 else f'{_date(ch[0]["date"])[:5]}', sum(x["costs"] for x in ch), sum(x["net"] for x in ch)))
    return out, step

def to_pdf(r, store):
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing, String
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, KeepTogether

    navy, em, red, slate = (colors.HexColor("#" + h) for h in (NAVY, EMERALD, RED, SLATE))
    H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=20, textColor=navy, leading=24)
    H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, textColor=navy, spaceBefore=14, spaceAfter=6)
    SM = ParagraphStyle("sm", fontName="Helvetica", fontSize=9, textColor=slate, leading=12)
    t, fi = r["totals"], r["fiados"]

    def tbl(data, widths, align_right=(), bold_last=False):
        x = Table(data, colWidths=widths, repeatRows=1)
        st = [("FONT", (0, 0), (-1, -1), "Helvetica", 9), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9), ("BACKGROUND", (0, 0), (-1, 0), navy),
              ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
              ("LINEBELOW", (0, 0), (-1, -1), .25, colors.HexColor("#E2E8F0")), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
        st += [("ALIGN", (j, 0), (j, -1), "RIGHT") for j in align_right]
        if bold_last: st += [("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 9), ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#ECFDF5"))]
        x.setStyle(TableStyle(st)); return x

    story = [Paragraph("Balance de gestión", H1), Paragraph(_safe(store), ParagraphStyle("st", parent=SM, fontSize=12, textColor=slate, leading=16)),
             Paragraph(f"Período: {_period(r)}", SM), Spacer(1, 10)]

    # KPIs
    net_c = em if t["net"] >= 0 else red
    kp = [("Ventas", _ars(t["sales"]), navy), ("Costos (mercadería + gastos)", _ars(t["costs"]), slate), ("Ganancia neta", _ars(t["net"]), net_c), ("Margen neto", f'{t["margin"]:.1f}%'.replace(".", ","), navy)]
    cells = [[Paragraph(f'<font size=8 color="#64748B">{k}</font><br/><font size=15 color="{c.hexval().replace("0x", "#")}"><b>{v}</b></font>', ParagraphStyle("k", leading=19)) for k, v, c in kp]]
    k = Table(cells, colWidths=[43 * mm] * 4); k.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), .5, colors.HexColor("#E2E8F0")), ("INNERGRID", (0, 0), (-1, -1), .5, colors.HexColor("#E2E8F0")), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story += [k, Spacer(1, 8)]
    story += [tbl([["Concepto", "Monto"], ["Ventas", _ars(t["sales"])], ["(−) Costo de mercadería", _ars(t["cogs"])], ["Ganancia bruta", _ars(t["gross"])],
                   ["(−) Gastos", _ars(t["expenses"])], ["Ganancia neta", _ars(t["net"])]], [120 * mm, 52 * mm], (1,), True)]
    story += [Paragraph(f'{t["count"]} ventas · ticket promedio {_ars(t["avg_ticket"])} · fiado otorgado {_ars(t["fiado_new"])} · cobros de fiados {_ars(t["fiado_paid"])} · fiados pendientes hoy {_ars(fi["pending"])}', ParagraphStyle("n", parent=SM, spaceBefore=6))]

    # Gráfico costos vs ganancia neta
    bars, step = _buckets(r["daily"])
    if len(bars) > 1 and any(b[1] or b[2] for b in bars):
        d = Drawing(172 * mm, 62 * mm); ch = VerticalBarChart(); ch.x, ch.y, ch.width, ch.height = 34, 24, 172 * mm - 44, 62 * mm - 40
        ch.data = [[b[1] for b in bars], [b[2] for b in bars]]; ch.categoryAxis.categoryNames = [b[0] for b in bars]
        ch.bars[0].fillColor, ch.bars[1].fillColor = slate, em; ch.bars.strokeColor = None; ch.barSpacing = 0.5
        ch.categoryAxis.labels.fontSize = 6; ch.categoryAxis.labels.angle = 45 if len(bars) > 12 else 0; ch.categoryAxis.labels.dy = -8 if len(bars) > 12 else -2
        ch.categoryAxis.labels.boxAnchor = "e" if len(bars) > 12 else "n"; ch.valueAxis.labels.fontSize = 7; ch.valueAxis.labelTextFormat = lambda v: _ars(v).replace("$ ", "$")
        ch.categoryAxis.visibleTicks = 0; ch.categoryAxis.joinAxisMode = "low"; ch.valueAxis.gridStrokeColor = colors.HexColor("#E2E8F0"); ch.valueAxis.visibleGrid = 1
        d.add(ch); d.add(String(34, 62 * mm - 10, "Costos" + (" (gris)  vs  Ganancia neta (verde)") + (f" · agrupado cada {step} días" if step > 1 else ""), fontName="Helvetica", fontSize=8, fillColor=slate))
        story += [Paragraph("Costos vs ganancia neta", H2), d]

    # Ranking
    if r["products"]:
        top = r["products"][:10]
        story += [KeepTogether([Paragraph("Productos más vendidos", H2), tbl([["#", "Producto", "Unid.", "Ingresos", "Ganancia"]] + [[i, _safe(p["name"])[:44], p["units"], _ars(p["revenue"]), _ars(p["profit"])] for i, p in enumerate(top, 1)],
                                                                         [10 * mm, 80 * mm, 20 * mm, 32 * mm, 30 * mm], (2, 3, 4))])]
    if r["methods"]:
        story += [KeepTogether([Paragraph("Caja por medio de pago", H2), tbl([["Medio", "Ingresos", "Egresos", "Saldo"]] + [[_safe(m["method"]), _ars(m["inflow"]), _ars(m["outflow"]), _ars(m["balance"])] for m in r["methods"]], [60 * mm, 38 * mm, 38 * mm, 36 * mm], (1, 2, 3))])]
    if r["expenses"]:
        story += [KeepTogether([Paragraph("Principales gastos", H2), tbl([["Concepto", "Cant.", "Total"]] + [[_safe(e["concept"])[:50], e["count"], _ars(e["total"])] for e in r["expenses"]], [110 * mm, 20 * mm, 42 * mm], (1, 2))])]

    def footer(cv, doc):
        cv.saveState(); cv.setFont("Helvetica", 8); cv.setFillColor(slate)
        cv.drawString(19 * mm, 10 * mm, f'Affari · generado el {datetime.now().strftime("%d/%m/%Y %H:%M")}'); cv.drawRightString(A4[0] - 19 * mm, 10 * mm, f"Página {doc.page}")
        cv.setFillColor(em); cv.rect(0, A4[1] - 4 * mm, A4[0], 4 * mm, stroke=0, fill=1); cv.restoreState()

    buf = io.BytesIO(); SimpleDocTemplate(buf, pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm, topMargin=16 * mm, bottomMargin=18 * mm, title="Balance de gestión · Affari").build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
