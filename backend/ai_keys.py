"""Cliente de IA con rotación de claves entre proveedores: Gemini (Google) y Grok (xAI).

Orden de uso:
  1. Claves del servidor, en el orden en que figuran: primero GEMINI_API_KEYS y después GROK_API_KEYS
     (variables de entorno, separadas por coma; en Render: Environment). Si una devuelve error de cuota,
     es inválida o falla, se "enfría" un rato y se pasa a la siguiente (aunque sea de otro proveedor).
  2. Si todas las del servidor están agotadas, las claves propias que el negocio cargó en el Asistente (tabla ai_keys).
  3. Si tampoco hay, se lanza AllKeysExhausted y la app le pide al usuario que agregue la suya.

El proveedor se detecta por el formato de la clave: las de xAI empiezan con "xai-"; el resto se trata como Gemini.
Internamente la conversación viaja en formato Gemini; para Grok (API compatible con OpenAI) se traduce al vuelo.
Solo usa la librería estándar (urllib): no agrega dependencias.
"""
import base64, io, json, logging, os, re, threading, time, urllib.error, urllib.request
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("affari.ai.keys")
API = "https://generativelanguage.googleapis.com/v1beta"
GROK_API = os.getenv("GROK_API_URL", "https://api.x.ai/v1").rstrip("/")
MODELS = [m.strip() for m in os.getenv("GEMINI_MODELS", os.getenv("GEMINI_MODEL", "gemini-2.5-flash,gemini-flash-latest")).split(",") if m.strip()]
# Se prueban en orden: si un modelo ya no existe en xAI, pasa al siguiente. Se cambia desde Render con GROK_MODELS.
GROK_MODELS = [m.strip() for m in os.getenv("GROK_MODELS", "grok-4,grok-3").split(",") if m.strip()]
TIMEOUT = int(os.getenv("GEMINI_TIMEOUT", "45"))
UA = "Affari/1.0"      # algunos proveedores (Cloudflare) rechazan el User-Agent por defecto de urllib
# "Thinking" de los modelos 2.5/3: con herramientas y fotos suma muchos segundos y acá no hace falta razonar largo.
# GEMINI_THINKING_BUDGET=0 lo apaga (por defecto); un número lo limita; "auto" deja el valor del modelo.
THINK = os.getenv("GEMINI_THINKING_BUDGET", "0").strip().lower()

def parse_keys(raw):
    return [k for k in re.split(r"[,\s;]+", raw or "") if k]

def server_keys():
    """Claves del servidor en orden: Gemini primero, después Grok (acepta XAI_API_KEYS como alias). Sin repetidas."""
    out = []
    for k in parse_keys(os.getenv("GEMINI_API_KEYS", "")) + parse_keys(os.getenv("GROK_API_KEYS", "")) + parse_keys(os.getenv("XAI_API_KEYS", "")):
        if k not in out:
            out.append(k)
    return out

def provider_of(key):
    return "grok" if (key or "").lower().startswith("xai-") else "gemini"

def mask(key):
    return key[:5] + "…" + key[-4:] if len(key) > 12 else "…"

class GeminiError(Exception):
    """Error de cualquier proveedor de IA (se llama así por compatibilidad). kind: quota | invalid | model | transient | fatal."""
    def __init__(self, kind, message, retry=0, status=0):
        super().__init__(message); self.kind, self.retry, self.status = kind, retry, status

AIError = GeminiError

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
            "own_available": len([k for k in own_keys if not cooling(k)]), "own_total": len(own_keys), "models": MODELS,
            "grok_server_total": len([k for k in sk if provider_of(k) == "grok"]), "grok_models": GROK_MODELS}

def ordered_keys(own_keys):
    """Claves del servidor primero (en orden) y, solo cuando no queda ninguna disponible, las propias."""
    out = [k for k in server_keys() if not cooling(k)]
    out += [k for k in own_keys if not cooling(k) and k not in out]
    return out

# ---------------------------------------------------------------- HTTP
def _classify(status, body):
    """Convierte la respuesta de error de Gemini o de xAI en un GeminiError con su tipo."""
    try:
        j = json.loads(body)
    except ValueError:
        j = {}
    if isinstance(j, list):                                   # Gemini a veces responde [{"error": {...}}]
        j = next((x for x in j if isinstance(x, dict)), {})
    j = j if isinstance(j, dict) else {}
    err = j.get("error", {})
    if isinstance(err, str):                                  # xAI: {"code": "...", "error": "mensaje"}
        err = {"message": err, "status": str(j.get("code") or "")}
    elif not isinstance(err, dict):
        err = {}
    msg, st = str(err.get("message") or body[:200]), str(err.get("status") or err.get("code") or "")
    low = (msg + " " + st + " " + body[:300]).lower()
    flat = re.sub(r"[^a-z]", "", json.dumps(err).lower())
    billing = any(w in low for w in ("credit", "spending limit", "billing", "exceeded your current quota", "out of quota"))
    if status == 429 or st == "RESOURCE_EXHAUSTED" or (status in (402, 403) and billing):
        retry = 0
        for d in err.get("details", []) if isinstance(err.get("details"), list) else []:
            m = re.match(r"(\d+(?:\.\d+)?)s$", str(d.get("retryDelay", ""))) if isinstance(d, dict) else None
            if m: retry = float(m.group(1))
        daily = "perday" in flat or billing
        return GeminiError("quota", msg, retry or (6 * 3600 if daily else 65), status)
    if status == 401 or (status in (400, 403) and ("api key" in low or "api_key" in low or "incorrect api" in low or "invalid api" in low
                                                  or st in ("PERMISSION_DENIED", "UNAUTHENTICATED") or "expired" in low)):
        return GeminiError("invalid", msg, 6 * 3600, status)
    if status == 404 or (status in (400, 403) and "model" in low and ("not found" in low or "does not exist" in low or "not have access" in low)):
        return GeminiError("model", msg, 0, status)
    if status >= 500 or st in ("UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"):
        return GeminiError("transient", msg, 20, status)
    return GeminiError("fatal", msg, 0, status)

def _request(url, key, payload=None, method="POST"):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    headers.update({"Authorization": f"Bearer {key}"} if provider_of(key) == "grok" else {"x-goog-api-key": key})
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise _classify(e.code, e.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise GeminiError("transient", f"Sin conexión con el servicio de IA: {e}", 10)

def verify_key(key):
    """Comprueba que una clave sea válida sin gastar cuota de generación. Lanza GeminiError si no sirve."""
    if provider_of(key) == "grok":
        _request(f"{GROK_API}/models", key, method="GET")
    else:
        _request(f"{API}/models?pageSize=1", key, method="GET")
    return True

# ---------------------------------------------------------------- Grok (xAI): traducción de formato Gemini <-> OpenAI
def _schema(node):
    """Esquema de herramientas de Gemini (tipos en MAYÚSCULA) -> JSON Schema estándar."""
    if isinstance(node, list):
        return [_schema(x) for x in node]
    if not isinstance(node, dict):
        return node
    return {k: (str(v).lower() if k == "type" and isinstance(v, str) else _schema(v)) for k, v in node.items()}

def _grok_tools(tools):
    out = []
    for t in tools or []:
        for f in t.get("functionDeclarations", []):
            out.append({"type": "function", "function": {"name": f["name"], "description": f.get("description", ""),
                                                           "parameters": _schema(f.get("parameters") or {"type": "object", "properties": {}})}})
    return out

def _grok_image(mime, b64):
    """xAI acepta solo JPG/PNG: WebP/GIF se convierten. Devuelve data URL o None si no se pudo leer la foto."""
    if mime in ("image/jpeg", "image/png"):
        return f"data:{mime};base64,{b64}"
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None

def _grok_messages(contents, system):
    """Conversación en formato Gemini -> mensajes de chat de OpenAI/xAI (con llamadas a herramientas)."""
    msgs, n, pending = [{"role": "system", "content": system}], 0, []        # pending: (nombre, id) de las llamadas sin respuesta
    for c in contents:
        parts = c.get("parts") or []
        if c.get("role") == "model":
            text = "".join(p.get("text", "") for p in parts if "text" in p and not p.get("thought"))
            calls = [p["functionCall"] for p in parts if "functionCall" in p]
            m = {"role": "assistant", "content": text or None}
            if calls:
                pending, m["tool_calls"] = [], []
                for fc in calls:
                    n += 1; cid = f"call_{n}"; pending.append((fc.get("name"), cid))
                    m["tool_calls"].append({"id": cid, "type": "function", "function": {"name": fc.get("name"), "arguments": json.dumps(fc.get("args") or {}, ensure_ascii=False)}})
            elif not text:
                continue
            msgs.append(m)
        else:
            content = []
            for p in parts:
                if "functionResponse" in p:
                    fr = p["functionResponse"]
                    idx = next((i for i, (nm, _) in enumerate(pending) if nm == fr.get("name")), None)
                    cid = pending.pop(idx)[1] if idx is not None else f"call_{n}"
                    msgs.append({"role": "tool", "tool_call_id": cid, "content": json.dumps(fr.get("response"), ensure_ascii=False, default=str)})
                elif "text" in p:
                    content.append({"type": "text", "text": p["text"]})
                elif "inlineData" in p:
                    url = _grok_image(p["inlineData"].get("mimeType", ""), p["inlineData"].get("data", ""))
                    if url: content.append({"type": "image_url", "image_url": {"url": url}})
            if content:
                msgs.append({"role": "user", "content": content[0]["text"] if len(content) == 1 and content[0]["type"] == "text" else content})
    return msgs

def _grok_to_gemini(res):
    """Respuesta de chat/completions -> formato de candidatos de Gemini, que es el que entiende el resto de la app."""
    ch = (res.get("choices") or [{}])[0]
    m, parts = ch.get("message") or {}, []
    if m.get("content"):
        parts.append({"text": m["content"]})
    for tc in m.get("tool_calls") or []:
        f = tc.get("function") or {}
        try: args = json.loads(f.get("arguments") or "{}")
        except ValueError: args = {}
        parts.append({"functionCall": {"name": f.get("name"), "args": args if isinstance(args, dict) else {}}})
    fin = {"stop": "STOP", "tool_calls": "STOP", "length": "MAX_TOKENS", "content_filter": "SAFETY"}.get(ch.get("finish_reason"), ch.get("finish_reason"))
    return {"candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": fin}]}

def _grok_payload(contents, system, tools, generation):
    p = {"messages": _grok_messages(contents, system), "temperature": (generation or {}).get("temperature", 0.3)}
    mx = (generation or {}).get("maxOutputTokens")
    if mx:
        p["max_completion_tokens"] = max(int(mx), 1500)     # los modelos de razonamiento gastan parte del cupo pensando
    gt = _grok_tools(tools)
    if gt:
        p["tools"], p["tool_choice"] = gt, "auto"
    return p

# ---------------------------------------------------------------- generación con rotación
def _gemini_try(key, payload):
    """Prueba una clave de Gemini con cada modelo. Devuelve la respuesta o lanza GeminiError (el último)."""
    global THINK
    last = None
    for model in MODELS:
        for attempt in (1, 2):
            try:
                return _request(f"{API}/models/{model}:generateContent", key, payload)
            except GeminiError as e:
                last = e
                if e.kind == "fatal" and attempt == 1 and "think" in str(e).lower() and payload["generationConfig"].pop("thinkingConfig", None):
                    THINK = "auto"; continue           # ese modelo no admite apagar el thinking: se reintenta sin pedirlo
                if e.kind == "transient" and attempt == 1:
                    time.sleep(1.5); continue
                break
        if last.kind == "model":
            continue                                   # ese modelo no existe: se prueba el siguiente con la misma clave
        break
    raise last

def _grok_try(key, payload):
    last = None
    for model in GROK_MODELS:
        for attempt in (1, 2):
            try:
                return _grok_to_gemini(_request(f"{GROK_API}/chat/completions", key, {**payload, "model": model}))
            except GeminiError as e:
                last = e
                if e.kind == "transient" and attempt == 1:
                    time.sleep(1.5); continue
                break
        if last.kind == "model":
            continue
        break
    raise last

def generate(contents, system, tools, own_keys=(), generation=None):
    """Genera la respuesta rotando claves (y proveedores). Devuelve (respuesta_en_formato_Gemini, origen_de_clave).
    Si una clave falla (cuota, inválida, caída o error raro) se pasa a la siguiente; solo se corta cuando no queda ninguna."""
    keys = ordered_keys(list(own_keys))
    if not keys:
        raise AllKeysExhausted()
    gem = {"contents": contents, "systemInstruction": {"parts": [{"text": system}]},
           "generationConfig": {"temperature": 0.3, **(generation or {})}}
    if THINK.lstrip("-").isdigit():
        gem["generationConfig"]["thinkingConfig"] = {"thinkingBudget": int(THINK)}
    if tools:
        gem["tools"] = tools
        gem["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}
    grok = None                                         # se arma solo si hace falta
    last, mine = None, set(server_keys())
    for key in keys:
        try:
            if provider_of(key) == "grok":
                grok = grok or _grok_payload(contents, system, tools, generation)
                res = _grok_try(key, grok)
            else:
                res = _gemini_try(key, gem)
            return res, ("server" if key in mine else "own")
        except GeminiError as e:
            last = e
            log.warning("IA: la clave %s (%s) falló: %s %s", mask(key), provider_of(key), e.kind, str(e)[:160])
            if e.kind in ("quota", "invalid"):
                cool(key, e.retry)                      # esta clave descansa; seguimos con la próxima
    if last and last.kind in ("quota", "invalid") or not available_after(own_keys):
        raise AllKeysExhausted()
    raise last or AllKeysExhausted()

def available_after(own_keys):
    return bool(ordered_keys(list(own_keys)))
