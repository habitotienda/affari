"""Mantiene despierto el servidor de Render haciendo un GET a /ping cada 10 minutos.

Uso:   python keep_alive.py https://tu-app.onrender.com
   o:  RENDER_URL=https://tu-app.onrender.com python keep_alive.py
Solo sirve si este script queda corriendo 24/7 (tu PC encendida). Si no, usá UptimeRobot o GitHub Actions (ver README).
"""
import os, sys, time
from datetime import datetime
import requests

INTERVAL = 10 * 60          # Render duerme el servicio a los 15 min sin tráfico: cada 10 min sobra
TIMEOUT = 90                # si estaba dormido, tarda ~1 min en despertar

def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("RENDER_URL", "")).strip().rstrip("/")
    if not base.startswith("http"):
        sys.exit("Indicá la URL: python keep_alive.py https://tu-app.onrender.com")
    url = f"{base}/ping"
    while True:
        t0 = time.time()
        try:
            r = requests.get(url, timeout=TIMEOUT)
            print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {r.status_code} en {time.time() - t0:.1f}s", flush=True)
        except requests.RequestException as e:
            print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] error: {e}", flush=True)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
