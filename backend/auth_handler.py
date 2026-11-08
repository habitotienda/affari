import os, time
import bcrypt, jwt
from dotenv import load_dotenv

load_dotenv()
JWT_SECRET = os.getenv("JWT_SECRET", "cambiar-en-produccion")
TOKEN_TTL = 60 * 60 * 24 * 7  # 7 días

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False

def create_token(user_id: int) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + TOKEN_TTL}, JWT_SECRET, algorithm="HS256")

def decode_token(token: str):
    """Solo acepta tokens de sesión (sin 'purpose'). Los tickets de otros flujos, como el alta con Google, no sirven acá."""
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return None if data.get("purpose") else int(data["sub"])
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        return None

def create_ticket(purpose: str, data: dict, ttl: int = 600) -> str:
    """Token de corta vida para un paso intermedio (no es una sesión)."""
    now = int(time.time())
    return jwt.encode({**data, "purpose": purpose, "iat": now, "exp": now + ttl}, JWT_SECRET, algorithm="HS256")

def read_ticket(token: str, purpose: str):
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return data if data.get("purpose") == purpose else None
