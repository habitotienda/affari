"""python tests/hours_test.py  (desde affari-app/) — valida horarios y el cálculo «abierto / cerrado»"""
import os, sys
from datetime import datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
import hours as H

TZ = ZoneInfo("America/Argentina/Buenos_Aires")
at = lambda y, m, d, hh, mm: datetime(y, m, d, hh, mm, tzinfo=TZ)     # 2026-11-09 es lunes
def mk(**days):
    return H.clean_hours({"enabled": True, "days": {k: v for k, v in days.items()}})

# --- validación
assert H.clean_hours({"enabled": True, "days": {"mon": [["16:00", "20:00"], ["09:00", "13:00"]]}})["days"]["mon"] == [["09:00", "13:00"], ["16:00", "20:00"]], "ordena las franjas"
for bad in ({"days": {"mon": [["9:00", "13:00"]]}}, {"days": {"mon": [["09:00", "09:00"]]}}, {"days": {"mon": [["09:00", "13:00"], ["12:00", "14:00"]]}},
            {"days": {"mon": [["01:00", "02:00"]] * 4}}, {"days": {"mon": [["25:00", "26:00"]]}}, "x", {"days": {"mon": "9 a 13"}}):
    try: H.clean_hours(bad); raise SystemExit(f"debió fallar: {bad}")
    except ValueError: pass
assert H.parse_hours(None)["enabled"] is False and H.parse_hours("{no json")["enabled"] is False

# --- estado
h = mk(mon=[["09:00", "13:00"], ["16:00", "20:00"]], tue=[["09:00", "13:00"], ["16:00", "20:00"]], sat=[["10:00", "14:00"]])
st = H.open_status(h, at(2026, 11, 9, 10, 30)); assert st == {"open": True, "closes": "13:00", "opens": None}, st
st = H.open_status(h, at(2026, 11, 9, 14, 0));  assert st["open"] is False and st["opens"] == (0, "16:00"), st          # corte de mediodía: abre hoy
st = H.open_status(h, at(2026, 11, 9, 20, 0));  assert st["opens"] == (1, "09:00"), st                                 # cierra a las 20:00 en punto → ya cerrado
st = H.open_status(h, at(2026, 11, 11, 12, 0)); assert st["opens"] == (3, "10:00"), st                                 # miércoles cerrado → sábado
st = H.open_status(h, at(2026, 11, 14, 15, 0)); assert st["opens"] == (2, "09:00"), st                                 # sábado tarde → lunes (dom. cerrado)
assert H.open_status({"enabled": False, "days": {}}) is None

# franja que cruza la medianoche (bar): vie 20:00 → sáb 02:00
bar = mk(fri=[["20:00", "02:00"]])
assert H.open_status(bar, at(2026, 11, 13, 23, 0)) == {"open": True, "closes": "02:00", "opens": None}
assert H.open_status(bar, at(2026, 11, 14, 1, 0))["open"] is True, "sábado 01:00 sigue abierto por la franja del viernes"
assert H.open_status(bar, at(2026, 11, 14, 2, 0))["open"] is False
# domingo de noche que pasa al lunes
dom = mk(sun=[["22:00", "03:00"]])
assert H.open_status(dom, at(2026, 11, 9, 1, 0))["open"] is True
# franjas pegadas: el cierre es el de la última
pegadas = mk(mon=[["09:00", "13:00"], ["13:00", "18:00"]])
assert H.open_status(pegadas, at(2026, 11, 9, 10, 0))["closes"] == "18:00"
# habilitado pero sin ningún día abierto
vacio = mk(); st = H.open_status(vacio, at(2026, 11, 9, 10, 0)); assert st == {"open": False, "closes": None, "opens": None}
print("hours: OK")
