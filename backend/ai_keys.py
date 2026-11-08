"""Cliente de Gemini con rotación de claves.

Orden de uso:
  1. Claves del servidor (GEMINI_API_KEYS en .env, separadas por coma), en el orden en que figuran.
     Si una devuelve error de cuota (429), se "enfría" un rato y se pasa a la siguiente.
  2. Si todas las del servidor están agotadas, las claves propias que el negocio cargó en el Asistente (tabla ai_keys).
  3. Si tampoco hay, se lanza AllKeysExhausted y la app le pide al usuario que agregue la suya.

Solo usa la librería estándar (urllib): no agrega dependencias.
"""
import json, os, re, threading, time, urllib.error, urllib.request
from dotenv import load_dotenv

load_dotenv()
API = "https://generativelanguage.googleapis.com/v1beta"
MODELS = [m.strip() for m in os.getenv("GEMINI_MODELS", os.getenv("GEMINI_MODEL", "gemini-2.5-flash,gemini-flash-latest")).split(",") if m.strip()]
TIMEOUT = int(os.getenv("GEMINI_TIMEOUT", "45"))
# "Thinking" de los modelos 2.5/3: con herramientas y fotos suma muchos segundos y acá no hace falta razonar largo.
# GEMINI_THINKING_BUDGET=0 lo apaga (por defecto); un número lo limita; "auto" deja el valor del modelo.
THINK = os.getenv("GEMINI_THINKING_BUDGET", "0").strip().lower()

def parse_keys(raw):
    return [k for k in re.split(r"[,\s;]+", raw or "") if k]

def server_keys():
    return parse_keys(os.getenv("GEMINI_API_KEYS", ""))

def mask(key):
    return key[:5] + "…" + key[-4:] if len(key) > 12 else "…"

class GeminiError(Exception):
    def __init__(self, kind, message, retry=0, status=0):
        super().__init__(message); self.kind, self.retry, self.status = kind, retry, status

class AllKeysExhausted(Exception):
    pass

# ---------------------------------------------------------------- estado de cuotas (en memoria, por proceso)
_cool, _lock = {}, threading.Lock()

def cooling(key):
    with _lock:
        return _cool.get(key, 0) > time.time()

def cool(key, seconds):
    with _lock:
        _cool[key] = time.time() + max(5, seconds)

def reset_cooldowns():
    with _lock:
        _cool.clear()

def available_server_keys():
    return [k for k in server_keys() if not cooling(k)]

def pool_status(own_keys):
    sk = server_keys()
    return {"server_total": len(sk), "server_available": len([k for k in sk if not cooling(k)]),
            "own_available": len([k for k in own_keys if not cooling(k)]), "own_total": len(own_keys), "models": MODELS}

def ordered_keys(own_keys):
    """Claves del servidor primero (en orden) y, solo cuando no queda ninguna disponible, las propias."""
    out = [k for k in server_keys() if not cooling(k)]
    out += [k for k in own_keys if not cooling(k) and k not in out]
    return out

# ---------------------------------------------------------------- HTTP
def _classify(status, body):
    try:
        err = json.loads(body).get("error", {})
    except ValueError:
        err = {}
    msg, st = err.get("message") or body[:200], (err.get("status") or "")
    low = msg.lower()
    if status == 429 or st == "RESOURCE_EXHAUSTED":
        retry = 0
        for d in err.get("details", []):
            m = re.match(r"(\d+(?:\.\d+)?)s$", str(d.get("retryDelay", "")))
            if m: retry = float(m.group(1))
        daily = "perday" in re.sub(r"[^a-z]", "", json.dumps(err).lower())
        return GeminiError("quota", msg, retry or (6 * 3600 if daily else 65), status)
    if status in (400, 401, 403) and ("api key" in low or "api_key" in low or st in ("PERMISSION_DENIED", "UNAUTHENTICATED") or "expired" in low):
        return GeminiError("invalid", msg, 6 * 3600, status)
    if status == 404 or (status == 400 and "model" in low and "not found" in low):
        return GeminiError("model", msg, 0, status)
    if status >= 500 or st in ("UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"):
        return GeminiError("transient", msg, 20, status)
    return GeminiError("fatal", msg, 0, status)

def _request(url, key, payload=None, method="POST"):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", "x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise _classify(e.code, e.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise GeminiError("transient", f"Sin conexión con Gemini: {e}", 10)

def verify_key(key):
    """Comprueba que una clave sea válida sin gastar cuota de generación. Lanza GeminiError si no sirve."""
    _request(f"{API}/models?pageSize=1", key, method="GET")
    return True

def generate(contents, system, tools, own_keys=(), generation=None):
    """Llama a generateContent rotando claves y modelos. Devuelve (respuesta_json, origen_de_clave)."""
    keys = ordered_keys(list(own_keys))
    if not keys:
        raise AllKeysExhausted()
    global THINK
    payload = {"contents": contents, "systemInstruction": {"parts": [{"text": system}]},
               "generationConfig": {"temperature": 0.3, **(generation or {})}}
    if THINK.lstrip("-").isdigit():
        payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": int(THINK)}
    if tools:
        payload["tools"] = tools
        payload["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}
    last = None
    for key in keys:
        for model in MODELS:
            for attempt in (1, 2):
                try:
                    res = _request(f"{API}/models/{model}:generateContent", key, payload)
                    return res, ("server" if key in server_keys() else "own")
                except GeminiError as e:
                    last = e
                    if e.kind == "fatal" and attempt == 1 and "think" in str(e).lower() and payload["generationConfig"].pop("thinkingConfig", None):
                        THINK = "auto"; continue           # ese modelo no admite apagar el thinking: se reintenta sin pedirlo
                    if e.kind == "transient" and attempt == 1:
                        time.sleep(1.5); continue
                    break
            if last.kind == "model":
                continue                       # probar el siguiente modelo con la misma clave
            break
        if last and last.kind in ("quota", "invalid"):
            cool(key, last.retry)              # esta clave descansa; seguimos con la próxima
        elif last and last.kind == "fatal":
            raise last
    if last and last.kind in ("quota", "invalid") or not available_after(own_keys):
        raise AllKeysExhausted()
    raise last or AllKeysExhausted()

def available_after(own_keys):
    return bool(ordered_keys(list(own_keys)))
