"""Horarios de atención del negocio.

Formato guardado en stores.hours (JSON):
  {"enabled": true, "tz": "America/Argentina/Buenos_Aires",
   "days": {"mon": [["09:00","13:00"], ["16:00","20:00"]], "tue": [...], ..., "sun": []}}

  - Un día sin franjas = cerrado. Hasta MAX_RANGES franjas por día (corte de mediodía, por ejemplo).
  - Una franja que cierra "antes" de abrir cruza la medianoche (20:00 → 02:00 termina al día siguiente).
  - `enabled` = false: la tienda no muestra horario (queda el comportamiento anterior: badge «Abierto» manual del diseño).

Módulo puro (sin FastAPI ni base de datos): `clean_hours` valida lo que llega del navegador y `open_status`
calcula el estado en un instante dado; la tienda pública hace el mismo cálculo en el navegador (js/store/hours.js).
"""
import json, os, re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MAX_RANGES = 3
TZ = os.getenv("APP_TZ", "America/Argentina/Buenos_Aires")
_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

def default_hours():
    return {"enabled": False, "tz": TZ, "days": {d: [] for d in DAYS}}

def _min(t):
    return int(t[:2]) * 60 + int(t[3:])

def clean_hours(raw):
    """Valida y normaliza. Lanza ValueError con un mensaje listo para mostrar al comerciante."""
    if not isinstance(raw, dict):
        raise ValueError("Horarios inválidos.")
    days_in = raw.get("days") if isinstance(raw.get("days"), dict) else {}
    out = {"enabled": bool(raw.get("enabled")), "tz": TZ, "days": {}}
    names = {"mon": "lunes", "tue": "martes", "wed": "miércoles", "thu": "jueves", "fri": "viernes", "sat": "sábado", "sun": "domingo"}
    for d in DAYS:
        ranges = days_in.get(d) or []
        if not isinstance(ranges, list) or len(ranges) > MAX_RANGES:
            raise ValueError(f"El {names[d]} admite hasta {MAX_RANGES} franjas horarias.")
        clean = []
        for r in ranges:
            if not (isinstance(r, (list, tuple)) and len(r) == 2 and all(isinstance(x, str) and _TIME.match(x) for x in r)):
                raise ValueError(f"Revisá las horas del {names[d]}: usá el formato HH:MM.")
            if r[0] == r[1]:
                raise ValueError(f"El {names[d]} tiene una franja donde abre y cierra a la misma hora.")
            clean.append([r[0], r[1]])
        clean.sort(key=lambda r: _min(r[0]))
        for a, b in zip(clean, clean[1:]):
            a_end = _min(a[1]) if _min(a[1]) > _min(a[0]) else 24 * 60      # si cruza la medianoche, ocupa hasta el fin del día
            if _min(b[0]) < a_end:
                raise ValueError(f"Las franjas del {names[d]} se superponen.")
        out["days"][d] = clean
    return out

def parse_hours(raw):
    """Lo que hay en la base (texto JSON o None) → dict válido; ante cualquier problema, horario desactivado."""
    try:
        return clean_hours(json.loads(raw)) if raw else default_hours()
    except (ValueError, TypeError):
        return default_hours()

def _intervals(h):
    """Franjas como (inicio, fin) en minutos desde el lunes 00:00; el fin puede pasar de 10080 (cruza al lunes)."""
    out = []
    for i, d in enumerate(DAYS):
        for o, c in h["days"].get(d, []):
            s, e = i * 1440 + _min(o), i * 1440 + _min(c)
            out.append((s, e if e > s else e + 1440))
    return out

def _extend(iv, end, W):
    """Si otra franja empieza justo cuando esta termina (13:00→13:00, o pasada la medianoche), el cierre real es el de la última."""
    for _ in range(21):
        nxt = max((e2 + k * W for s2, e2 in iv for k in (0, 1) if s2 + k * W == end), default=None)
        if nxt is None or nxt <= end:
            break
        end = nxt
    return end

def open_status(h, now=None):
    """{"open": bool, "closes": "HH:MM"|None, "opens": (días_hasta, "HH:MM")|None} o None si el horario no está activado."""
    if not h or not h.get("enabled"):
        return None
    W = 7 * 1440
    now = now or datetime.now(ZoneInfo(h.get("tz") or TZ))
    n = now.weekday() * 1440 + now.hour * 60 + now.minute
    iv = _intervals(h)
    for off in (0, W):                                               # off = W cubre el domingo de noche que sigue abierto el lunes
        for s, e in iv:
            if s <= n + off < e:
                end = _extend(iv, e, W) % 1440
                return {"open": True, "closes": f"{end // 60:02d}:{end % 60:02d}", "opens": None}
    best = min((s + off for s, _ in iv for off in (0, W) if s + off > n), default=None)
    if best is None:
        return {"open": False, "closes": None, "opens": None}
    return {"open": False, "closes": None, "opens": ((best // 1440) - (n // 1440), f"{(best % 1440) // 60:02d}:{best % 60:02d}")}
