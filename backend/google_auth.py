"""Inicio de sesión / registro rápido con Google (Google Identity Services).

Flujo (el navegador nunca ve una contraseña ni habla con Google por su cuenta):
  1. El botón de Google le entrega al navegador un `credential` (ID token firmado por Google).
  2. POST /api/auth/google {credential}
       - cuenta ya existente (por Google o por el mismo email verificado)  → {token, user}      (entra directo)
       - cuenta nueva                                                    → {needs_profile, ticket, name, email}
  3. Solo para cuentas nuevas, una pantalla pide lo mínimo (negocio + teléfono):
     POST /api/auth/google/complete {ticket, business, business_type, phone}  → {token, user}

Configuración: GOOGLE_CLIENT_ID en .env (Google Cloud Console → APIs y servicios → Credenciales → ID de cliente de OAuth, tipo «Aplicación web»;
en «Orígenes de JavaScript autorizados» agregá http://localhost:8000 y tu dominio). Sin esa variable el botón simplemente no aparece.
Dependencia: google-auth (verifica la firma y la audiencia del token con las claves públicas de Google).
"""
import os, re, secrets
import billing
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import database as db
import auth_handler as auth


def client_id():
    return os.getenv("GOOGLE_CLIENT_ID", "").strip()


def verify_google(credential: str) -> dict:
    """Valida el ID token (firma, vencimiento, audiencia = nuestro client id, emisor) y devuelve {sub, email, name}. Lanza ValueError si no sirve."""
    from google.oauth2 import id_token
    from google.auth.transport import requests as greq
    info = id_token.verify_oauth2_token(credential, greq.Request(), client_id(), clock_skew_in_seconds=10)
    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("emisor inválido")
    if not info.get("email_verified"):
        raise ValueError("email sin verificar")
    email = (info.get("email") or "").lower()
    return {"sub": str(info["sub"]), "email": email, "name": (info.get("name") or email.split("@")[0]).strip()}


class GoogleIn(BaseModel):
    credential: str


class GoogleCompleteIn(BaseModel):
    ticket: str
    business: str
    business_type: str = "Otro"
    phone: str


def make_router(load_user, public_user):
    R = APIRouter(prefix="/api")

    @R.get("/config")
    def public_config():
        """Datos públicos que necesita la pantalla de ingreso (el client id de Google no es un secreto)."""
        return {"google_client_id": client_id()}

    @R.post("/auth/google")
    def google_login(d: GoogleIn):
        if not client_id():
            raise HTTPException(503, "El ingreso con Google todavía no está configurado.")
        try:
            g = verify_google(d.credential)
        except Exception:                      # firma inválida, token vencido, otra audiencia, sin red para bajar las claves…
            raise HTTPException(401, "No pudimos verificar tu cuenta de Google. Probá de nuevo.")
        with db.conn() as c:
            row = c.execute("SELECT id FROM users WHERE google_sub = ?", (g["sub"],)).fetchone()
            if not row:
                # Misma persona que ya se registró con email y contraseña: Google verificó ese email, así que se vinculan.
                row = c.execute("SELECT id FROM users WHERE email = ?", (g["email"],)).fetchone()
                if row:
                    c.execute("UPDATE users SET google_sub = ? WHERE id = ?", (g["sub"], row["id"]))
            if row:
                return {"token": auth.create_token(row["id"]), "user": public_user(load_user(c, row["id"], logo=True))}
        ticket = auth.create_ticket("google_signup", {"gsub": g["sub"], "email": g["email"], "name": g["name"]})
        return {"needs_profile": True, "ticket": ticket, "name": g["name"], "email": g["email"]}

    @R.post("/auth/google/complete")
    def google_complete(d: GoogleCompleteIn):
        t = auth.read_ticket(d.ticket, "google_signup")
        if not t:
            raise HTTPException(401, "Se venció el paso de registro. Volvé a tocar «Continuar con Google».")
        business, phone = d.business.strip(), re.sub(r"\D", "", d.phone or "")
        if not business:
            raise HTTPException(400, "Completá el nombre del negocio.")
        if not 8 <= len(phone) <= 15:
            raise HTTPException(400, "El teléfono / WhatsApp es obligatorio. Ingresalo con código de área.")
        with db.conn() as c:
            if c.execute("SELECT 1 FROM users WHERE google_sub = ? OR email = ?", (t["gsub"], t["email"])).fetchone():
                raise HTTPException(409, "Esa cuenta ya existe. Tocá «Continuar con Google» para ingresar.")
            if c.execute("SELECT 1 FROM users WHERE substr(phone, -10) = substr(?, -10)", (phone,)).fetchone():
                raise HTTPException(409, "Ya existe una cuenta con ese teléfono.")
            # La contraseña queda aleatoria (la columna es obligatoria): esta cuenta entra siempre con Google.
            uid = c.execute("INSERT INTO users(name,email,phone,password_hash,google_sub,trial_ends_at) VALUES (?,?,?,?,?,?)",
                            (t["name"], t["email"], phone, auth.hash_password(secrets.token_urlsafe(32)), t["gsub"], billing.trial_end_str())).lastrowid
            c.execute("INSERT INTO stores(user_id,name,type,slug) VALUES (?,?,?,?)", (uid, business, d.business_type.strip()[:40] or "Otro", db.unique_slug(c, business)))
            user = public_user(load_user(c, uid, logo=True))
        return {"token": auth.create_token(uid), "user": user}

    return R
