"""Estructura base para facturación electrónica AFIP (WSFE v1).

QUÉ HACE HOY
  - Valida CUIT/CUIL (módulo 11), arma el payload FECAESolicitar y el enlace del QR oficial.
  - Numera y guarda comprobantes. Los tipo "X" son NO fiscales (presupuesto / comprobante interno).
  - Los tipos A/B/C quedan en estado `pendiente` hasta conectar AFIP.

QUÉ FALTA PARA EMITIR FACTURAS REALES (no incluido a propósito)
  1. Certificado digital (.crt) + clave privada generados desde AFIP ("Administración de Certificados Digitales").
  2. WSAA: pedir token y sign con ese certificado (TRA firmado en CMS).
  3. WSFE: llamar a FECompUltimoAutorizado y FECAESolicitar con `build_fecae_request()`.
  4. Guardar CAE y vencimiento con `apply_cae()`.
  Implementá el paso 2 y 3 dentro de `request_cae()` (usando, por ejemplo, la librería `pyafipws`).
"""
import base64, json
from datetime import date

# Códigos oficiales de AFIP
CBTE_TIPO = {"A": 1, "B": 6, "C": 11}
DOC_TIPO = {"CUIT": 80, "CUIL": 86, "DNI": 96, "CF": 99}
IVA_ID = {0: 3, 10.5: 4, 21: 5, 27: 6, 5: 8, 2.5: 9}      # alícuota (%) -> Id de AFIP
COND_IVA = ("Monotributo", "Responsable Inscripto", "Exento")
CLIENT_IVA = ("Consumidor Final", "Responsable Inscripto", "Monotributo", "Exento")
IVA_RATES = (0, 10.5, 21, 27)

DEFAULT_FISCAL = {"razon_social": "", "cuit": "", "cond_iva": "Monotributo", "pto_vta": 1, "domicilio": "",
                  "inicio_actividades": "", "ingresos_brutos": "", "afip_enabled": False, "afip_env": "homologacion"}

class AfipNotConfigured(Exception):
    pass

def valid_cuit(cuit: str) -> bool:
    """CUIT/CUIL de 11 dígitos con dígito verificador (módulo 11)."""
    d = "".join(ch for ch in str(cuit or "") if ch.isdigit())
    if len(d) != 11:
        return False
    w = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    r = 11 - sum(int(a) * b for a, b in zip(d[:10], w)) % 11
    return int(d[10]) == {11: 0, 10: 9}.get(r, r)

def allowed_types(cond_iva: str):
    """Tipos de comprobante que puede emitir el comercio según su condición frente al IVA."""
    return {"Monotributo": ["X", "C"], "Exento": ["X", "C"], "Responsable Inscripto": ["X", "A", "B"]}.get(cond_iva, ["X"])

def suggest_type(fiscal: dict, client_iva: str) -> str:
    cond = fiscal.get("cond_iva")
    if cond == "Responsable Inscripto":
        return "A" if client_iva in ("Responsable Inscripto", "Monotributo") else "B"
    return "C" if cond in ("Monotributo", "Exento") and fiscal.get("afip_enabled") else "X"

def split_iva(total: float, rate: float):
    """Los precios del catálogo incluyen IVA. Devuelve (neto, iva)."""
    net = round(total / (1 + rate / 100), 2)
    return net, round(total - net, 2)

def fmt_number(pto: int, number: int) -> str:
    return f"{int(pto):04d}-{int(number):08d}"

def build_fecae_request(inv: dict, items: list, fiscal: dict) -> dict:
    """Estructura FECAESolicitar lista para enviar al WSFE. Factura C no discrimina IVA."""
    tipo = CBTE_TIPO[inv["type"]]
    today = date.fromisoformat(inv["issue_date"]).strftime("%Y%m%d")
    req = {"FeCabReq": {"CantReg": 1, "PtoVta": inv["pto_vta"], "CbteTipo": tipo},
           "FeDetReq": {"FECAEDetRequest": {
               "Concepto": 1, "DocTipo": inv["client_doc_type"], "DocNro": int(inv["client_doc"] or 0),
               "CbteDesde": inv["number"], "CbteHasta": inv["number"], "CbteFch": today,
               "ImpTotal": round(inv["total"], 2), "ImpTotConc": 0, "ImpNeto": round(inv["net"], 2), "ImpOpEx": 0,
               "ImpIVA": round(inv["iva"], 2), "ImpTrib": 0, "MonId": "PES", "MonCotiz": 1}}}
    if inv["type"] != "C":
        groups = {}
        for it in items:
            net, iva = split_iva(it["qty"] * it["unit_price"], it["iva_rate"])
            g = groups.setdefault(it["iva_rate"], [0.0, 0.0]); g[0] += net; g[1] += iva
        req["FeDetReq"]["FECAEDetRequest"]["Iva"] = {"AlicIva": [
            {"Id": IVA_ID[r], "BaseImp": round(b, 2), "Importe": round(i, 2)} for r, (b, i) in groups.items()]}
    return req

def request_cae(req: dict, fiscal: dict) -> dict:
    """PUNTO DE INTEGRACIÓN: acá va WSAA + WSFE. Debe devolver {"cae": "...", "cae_due": "AAAA-MM-DD"}."""
    if not fiscal.get("afip_enabled"):
        raise AfipNotConfigured("La conexión con AFIP no está activada. Cargá tus datos fiscales y el certificado.")
    raise AfipNotConfigured("Falta implementar WSAA/WSFE (ver encabezado de afip.py).")

def qr_url(inv: dict, fiscal: dict):
    """Enlace del QR obligatorio (RG 4892). Solo existe cuando el comprobante tiene CAE."""
    if not inv.get("cae"):
        return None
    data = {"ver": 1, "fecha": inv["issue_date"], "cuit": int("".join(c for c in fiscal.get("cuit", "") if c.isdigit()) or 0),
            "ptoVta": inv["pto_vta"], "tipoCmp": CBTE_TIPO.get(inv["type"], 0), "nroCmp": inv["number"],
            "importe": round(inv["total"], 2), "moneda": "PES", "ctz": 1, "tipoDocRec": inv["client_doc_type"],
            "nroDocRec": int(inv["client_doc"] or 0), "tipoCodAut": "E", "codAut": int(inv["cae"])}
    raw = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    return "https://www.afip.gob.ar/fe/qr/?p=" + raw
