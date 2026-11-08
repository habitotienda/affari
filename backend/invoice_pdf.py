"""PDF de comprobante (A4). Incluye CAE y QR de AFIP cuando el comprobante está autorizado."""
import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, Image

INK, GREEN, GREY = colors.HexColor("#0F172A"), colors.HexColor("#10B981"), colors.HexColor("#64748B")

def money(n):
    s = f"{abs(n):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("-" if n < 0 else "") + "$ " + s

def dmy(iso):
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}" if iso else ""

def render(inv, fiscal, business):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Comprobante {inv['type']} {inv['full_number']}", author=business)
    P = lambda t, **k: Paragraph(t, ParagraphStyle("p", fontName=k.pop("font", "Helvetica"), fontSize=k.pop("size", 9), leading=k.pop("lead", 12), textColor=k.pop("color", INK), **k))
    esc = lambda s: str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    fiscal_doc = inv["type"] != "X"
    title = {"X": "COMPROBANTE", "A": "FACTURA", "B": "FACTURA", "C": "FACTURA"}.get(inv["type"], "COMPROBANTE")
    seller = esc(fiscal.get("razon_social") or business)
    left = [P(f"<b>{seller}</b>", size=13, lead=16)]
    if fiscal.get("domicilio"): left.append(P(esc(fiscal["domicilio"]), color=GREY))
    if fiscal.get("cuit"): left.append(P(f"CUIT: {esc(fiscal['cuit'])}"))
    left.append(P(f"Condición IVA: {esc(fiscal.get('cond_iva'))}"))
    if fiscal.get("ingresos_brutos"): left.append(P(f"Ing. Brutos: {esc(fiscal['ingresos_brutos'])}"))
    if fiscal.get("inicio_actividades"): left.append(P(f"Inicio de actividades: {esc(fiscal['inicio_actividades'])}"))
    mid = [P(f"<b>{inv['type']}</b>", size=26, lead=28, alignment=1), P("Cód. " + {"A": "001", "B": "006", "C": "011"}.get(inv["type"], "—"), size=7, color=GREY, alignment=1)]
    right = [P(f"<b>{title}</b>", size=13, lead=16), P(f"N° {inv['full_number']}", font="Helvetica-Bold", size=11, lead=14), P(f"Fecha: {dmy(inv['issue_date'])}")]
    head = Table([[left, mid, right]], colWidths=[88 * mm, 22 * mm, 68 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), .8, INK), ("LINEAFTER", (0, 0), (0, 0), .8, INK),
                              ("LINEAFTER", (1, 0), (1, 0), .8, INK), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story = [head, Spacer(1, 5)]
    if not fiscal_doc:
        story += [P("<b>DOCUMENTO NO VÁLIDO COMO FACTURA</b> — comprobante interno de la operación.", size=8, color=colors.HexColor("#B45309"), alignment=1), Spacer(1, 4)]
    if inv["status"] == "anulado":
        story += [P("<b>COMPROBANTE ANULADO</b>", size=12, color=colors.HexColor("#BE123C"), alignment=1), Spacer(1, 4)]
    doc_label = {80: "CUIT", 86: "CUIL", 96: "DNI", 99: "Doc."}.get(inv["client_doc_type"], "Doc.")
    cli = Table([[P(f"<b>Cliente:</b> {esc(inv['client_name'])}"), P(f"<b>{doc_label}:</b> {esc(inv['client_doc']) if inv['client_doc'] != '0' else '—'}")],
                 [P(f"<b>Condición IVA:</b> {esc(inv['client_iva'])}"), P(f"<b>Medio de pago:</b> {esc(inv['method'])}")]], colWidths=[100 * mm, 78 * mm])
    cli.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), .5, colors.HexColor("#CBD5E1")), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [cli, Spacer(1, 8)]

    show_iva = inv["type"] == "A"
    cols = ["Descripción", "Cant.", "P. unit.", "IVA", "Subtotal"] if show_iva else ["Descripción", "Cant.", "P. unit.", "Subtotal"]
    rows = [[P(f"<b>{c}</b>", color=colors.white, size=8, alignment=0 if i == 0 else 2) for i, c in enumerate(cols)]]
    for it in inv["items"]:
        r = [P(esc(it["description"])), P(str(it["qty"]), alignment=2), P(money(it["unit_price"]), alignment=2)]
        if show_iva: r.append(P(f"{it['iva_rate']:g}%", alignment=2))
        r.append(P(money(it["qty"] * it["unit_price"]), alignment=2))
        rows.append(r)
    widths = [78 * mm, 14 * mm, 28 * mm, 16 * mm, 42 * mm] if show_iva else [92 * mm, 16 * mm, 32 * mm, 38 * mm]
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("LINEBELOW", (0, 1), (-1, -1), .3, colors.HexColor("#E2E8F0")),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [t, Spacer(1, 8)]

    tot = []
    if inv["type"] in ("A", "B"):
        tot += [[P("Importe neto gravado", alignment=2), P(money(inv["net"]), alignment=2)], [P("IVA", alignment=2), P(money(inv["iva"]), alignment=2)]]
    tot.append([P("<b>TOTAL</b>", size=12, lead=15, alignment=2), P(f"<b>{money(inv['total'])}</b>", size=12, lead=15, alignment=2)])
    tt = Table(tot, colWidths=[140 * mm, 38 * mm])
    tt.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 1, GREEN)]))
    story.append(tt)
    if inv.get("notes"):
        story += [Spacer(1, 8), P(f"<b>Observaciones:</b> {esc(inv['notes'])}", color=GREY)]

    story.append(Spacer(1, 14))
    if fiscal_doc and inv.get("cae"):
        footer = [P(f"<b>CAE:</b> {esc(inv['cae'])}"), P(f"<b>Vto. CAE:</b> {dmy(inv['cae_due'])}"), P("Comprobante autorizado", color=GREY, size=8)]
        try:
            import segno
            qr = io.BytesIO(); segno.make(inv["qr_url"], error="m").save(qr, kind="png", scale=3, border=1); qr.seek(0)
            story.append(Table([[Image(qr, 28 * mm, 28 * mm), footer]], colWidths=[34 * mm, 144 * mm]))
        except Exception:
            story += footer
    elif fiscal_doc:
        story.append(P("Comprobante pendiente de autorización de AFIP (sin CAE). No válido como factura hasta su autorización.", size=8, color=colors.HexColor("#B45309")))
    story += [Spacer(1, 10), P("Generado con Affari · affari.app", size=7, color=GREY, alignment=1)]
    doc.build(story)
    return buf.getvalue()
