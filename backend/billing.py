"""Planes, prueba gratis de 7 días, lista VIP y cobros con Mercado Pago (Checkout Pro).

Estado de acceso de un usuario (en orden de prioridad):
  vip   → su email está en ADMIN_VIP_EMAILS: plan Negocio permanente, sin cobros ni vencimiento.
  paid  → plan 'pro'/'negocio' con plan_expires_at en el futuro.
  trial → dentro de los 7 días desde el registro: todo desbloqueado (equivale a Pro).
  free  → Caja, Cuaderno de fiados y hasta 50 productos. Lo demás queda bloqueado.
"""
import hashlib, hmac, os, re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

try:
    TZ = ZoneInfo(os.getenv("APP_TZ", "America/Argentina/Buenos_Aires"))
except Exception:                      # Windows sin el paquete tzdata: Argentina es UTC-3 todo el año (sin horario de verano)
    TZ = timezone(timedelta(hours=-3))
TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "7"))
PLAN_DAYS = int(os.getenv("PLAN_DAYS", "30"))
FREE_PRODUCT_LIMIT = 50
PRICES = {"pro": float(os.getenv("PRO_PRICE", "9900")), "negocio": float(os.getenv("NEGOCIO_PRICE", "19900"))}
TITLES = {"pro": "Affari Pro", "negocio": "Affari Negocio"}

# Funciones avanzadas: se desbloquean con trial / Pro / Negocio. Gratis solo conserva caja, fiados y hasta 50 productos.
FEATURES = ("ai", "catalog", "studio", "reports", "reminders", "advanced")
# Prefijo de ruta de la API → función que lo exige (lo aplica el middleware de app.py). «advanced» = flujo de caja, proveedores, deudas y comprobantes.
GATES = (("/api/ai", "ai"), ("/api/reports", "reports"), ("/api/store/design", "catalog"),
         ("/api/cashflow", "advanced"), ("/api/suppliers", "advanced"), ("/api/debts", "advanced"),
         ("/api/invoices", "advanced"), ("/api/fiscal", "advanced"))
LOCK_MSG = "Esta función es parte de los planes Pro y Negocio. Elegí un plan para desbloquearla."

def vip_emails():
    return {e.strip().lower() for e in os.getenv("ADMIN_VIP_EMAILS", "").split(",") if e.strip()}

# ---------- fechas (se guardan como texto «AAAA-MM-DD HH:MM:SS» en hora de APP_TZ, igual que created_at) ----------
def now(): return datetime.now(TZ)
def fmt(dt): return dt.astimezone(TZ).strftime("%Y-%m-%d %H:%M:%S")
def parse(v):
    if not v: return None
    if isinstance(v, datetime): return v if v.tzinfo else v.replace(tzinfo=TZ)
    try: return datetime.strptime(str(v)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
    except ValueError: return None
def trial_end_str(): return fmt(now() + timedelta(days=TRIAL_DAYS))

# ---------- estado de acceso ----------
def access(row):
    """row: email, created_at, plan, plan_expires_at, trial_ends_at → dict que viaja al navegador (campo `billing`)."""
    t = now()
    email = (row["email"] or "").lower()
    trial_end = parse(row["trial_ends_at"]) or ((parse(row["created_at"]) or t) + timedelta(days=TRIAL_DAYS))
    exp = parse(row["plan_expires_at"])
    plan, state, until = "free", "free", None
    if email in vip_emails():
        plan, state = "negocio", "vip"
    elif row["plan"] in PRICES and exp and exp > t:
        plan, state, until = row["plan"], "paid", exp
    elif t < trial_end:
        plan, state, until = "pro", "trial", trial_end
    full = plan != "free"
    return {"plan": plan, "state": state, "features": list(FEATURES) if full else [],
            "product_limit": None if full else FREE_PRODUCT_LIMIT,
            "until": fmt(until) if until else None,
            "days_left": max(0, (until - t).days + (1 if (until - t).seconds else 0)) if until else None,
            "trial_ends_at": fmt(trial_end), "prices": PRICES}

def allows(b, feature): return feature in b["features"]

def gate_for(path):
    return next((f for p, f in GATES if path == p or path.startswith(p + "/") or path.startswith(p + ".")), None)

def owner_access(c, store_id):
    r = c.execute("SELECT u.email, u.created_at, u.plan, u.plan_expires_at, u.trial_ends_at FROM users u JOIN stores s ON s.user_id=u.id WHERE s.id=?", (store_id,)).fetchone()
    return access(r) if r else None

def check_product_limit(c, u):
    lim = u["billing"]["product_limit"]
    if lim is not None and c.execute("SELECT COUNT(*) FROM products WHERE store_id=?", (u["store_id"],)).fetchone()[0] >= lim:
        raise HTTPException(402, f"El plan gratis permite hasta {lim} productos. Pasá a Pro para cargar productos ilimitados.")

def migrate(c):
    """Usuarios que ya existían antes de este cambio reciben 7 días de prueba desde el despliegue (si no, quedarían bloqueados al instante)."""
    c.execute("UPDATE users SET trial_ends_at=? WHERE trial_ends_at IS NULL", (trial_end_str(),))
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_mp ON payments(mp_payment_id)")

# ---------- Mercado Pago ----------
MP = "https://api.mercadopago.com"
def _token():
    t = os.getenv("MP_ACCESS_TOKEN", "").strip()
    if not t: raise HTTPException(503, "Los pagos todavía no están configurados. Escribinos y lo resolvemos.")
    return t
def _mp(method, path, **kw):
    r = requests.request(method, MP + path, headers={"Authorization": f"Bearer {_token()}"}, timeout=15, **kw)
    return r
def base_url(request: Request):
    return (os.getenv("APP_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL") or str(request.base_url)).rstrip("/")   # Render define RENDER_EXTERNAL_URL solo

class CheckoutIn(BaseModel):
    plan: str

def _valid_signature(request: Request, data_id: str):
    """Si definís MP_WEBHOOK_SECRET (Mercado Pago > Tus integraciones > Webhooks), se exige la firma x-signature."""
    secret = os.getenv("MP_WEBHOOK_SECRET", "").strip()
    if not secret: return True
    sig = dict(p.split("=", 1) for p in request.headers.get("x-signature", "").split(",") if "=" in p)
    manifest = f"id:{data_id.lower()};request-id:{request.headers.get('x-request-id', '')};ts:{sig.get('ts', '')};"
    mine = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(mine, sig.get("v1", ""))

def make_router(current_user, forget_user, db):
    R = APIRouter(prefix="/api/billing")

    @R.post("/checkout")
    def checkout(d: CheckoutIn, request: Request, u=Depends(current_user)):
        plan = d.plan.strip().lower()
        if plan not in PRICES: raise HTTPException(400, "Plan inválido.")
        if u["billing"]["state"] == "vip": raise HTTPException(400, "Tu cuenta ya tiene acceso total, no necesitás pagar.")
        base = base_url(request); https = base.startswith("https://")
        pref = {"items": [{"id": plan, "title": f"{TITLES[plan]} · {PLAN_DAYS} días", "quantity": 1, "currency_id": "ARS", "unit_price": PRICES[plan]}],
                "payer": {"email": u["email"]}, "external_reference": f"{u['id']}|{plan}", "statement_descriptor": "AFFARI",
                "back_urls": {k: f"{base}/?pago={v}" for k, v in (("success", "ok"), ("pending", "pendiente"), ("failure", "error"))}}
        if https:                                  # Mercado Pago no acepta URLs locales para auto_return ni webhooks
            pref["auto_return"] = "approved"
            pref["notification_url"] = f"{base}/api/billing/webhook"
        r = _mp("POST", "/checkout/preferences", json=pref)
        if r.status_code >= 300:
            raise HTTPException(502, "Mercado Pago no pudo crear el pago. Probá de nuevo en un momento.")
        j = r.json()
        return {"init_point": j["init_point"]}     # en pruebas con credenciales TEST, usá j["sandbox_init_point"]

    @R.post("/webhook")
    async def webhook(request: Request):
        q = request.query_params
        try: body = await request.json()
        except Exception: body = {}
        kind = body.get("type") or q.get("type") or q.get("topic")
        pid = str((body.get("data") or {}).get("id") or q.get("data.id") or q.get("id") or "")
        if kind != "payment" or not pid.isdigit():
            return {"ok": True}                    # otros avisos (merchant_order, etc.): se ignoran
        if not _valid_signature(request, pid): raise HTTPException(401, "Firma inválida")
        r = _mp("GET", f"/v1/payments/{pid}")      # el estado real se consulta a Mercado Pago: no se confía en lo que llega en el aviso
        if r.status_code != 200: raise HTTPException(502, "No se pudo consultar el pago")   # MP reintenta
        p = r.json()
        m = re.match(r"^(\d+)\|(pro|negocio)$", p.get("external_reference") or "")
        if not m: return {"ok": True}
        uid, plan = int(m.group(1)), m.group(2)
        status = p.get("status")
        with db.conn() as c:
            known = c.execute("SELECT id FROM payments WHERE mp_payment_id=?", (pid,)).fetchone()
            if status == "approved" and not known:
                if float(p.get("transaction_amount") or 0) + 0.01 < PRICES[plan]: return {"ok": True}   # monto menor al del plan
                u = c.execute("SELECT plan, plan_expires_at FROM users WHERE id=?", (uid,)).fetchone()
                if not u: return {"ok": True}
                cur = parse(u["plan_expires_at"])
                start = cur if (cur and cur > now() and u["plan"] == plan) else now()    # renovar el mismo plan suma 30 días al vencimiento
                c.execute("INSERT INTO payments(user_id,plan,mp_payment_id,status,amount) VALUES (?,?,?,?,?)", (uid, plan, pid, status, float(p.get("transaction_amount") or 0)))
                c.execute("UPDATE users SET plan=?, plan_expires_at=? WHERE id=?", (plan, fmt(start + timedelta(days=PLAN_DAYS)), uid))
            elif status in ("refunded", "charged_back") and known:
                c.execute("UPDATE payments SET status=? WHERE mp_payment_id=?", (status, pid))
                c.execute("UPDATE users SET plan='free', plan_expires_at=NULL WHERE id=?", (uid,))
        forget_user(uid)                           # el próximo request ya ve el plan nuevo (la caché de usuario dura 20 s)
        return {"ok": True}

    return R
