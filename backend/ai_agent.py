"""Asistente IA de Affari (Gemini con function calling).

El modelo NO toca la base de datos directamente: solo puede pedir estas herramientas, que se ejecutan acá,
siempre limitadas al negocio (store_id) del usuario autenticado:
  search_products · create_product · update_product · adjust_stock · get_low_stock · sales_summary · list_debtors
Acepta fotos (se las ve el modelo y, si corresponde, se guardan como imágenes del producto).
"""
import base64, io, json, logging, re, threading, time
from collections import defaultdict, deque
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import database as db
import operations as ops
import reports
import ai_keys as gk

log = logging.getLogger("affari.ai")
IMG = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$")
MAX_STEPS, HISTORY_TURNS, MAX_IMAGES = 6, 14, 5
ars = lambda n: "$" + f"{float(n or 0):,.0f}".replace(",", ".")

SYSTEM = """Sos el asistente de gestión de «{business}» ({btype}), un comercio de Argentina que usa la app Affari. Hoy es {today}. Moneda: pesos argentinos (ARS).
Hablás en español rioplatense (voseo), claro, cálido y breve. Sin rodeos ni explicar tu proceso.

Qué podés hacer con tus herramientas: cargar productos, editar productos, ingresar/descontar/fijar stock, ver stock bajo, resumir ventas y ver deudas.
Reglas:
- Para hacer cualquier cambio USÁ las herramientas. Nunca digas que hiciste algo si la herramienta no devolvió ok. Si devuelve error, explicalo simple y proponé la salida.
- Antes de tocar stock o editar un producto existente, buscalo con search_products para obtener su id real. Si hay varias coincidencias posibles, preguntá cuál.
- Para crear un producto necesitás nombre y stock. El precio es opcional: NUNCA inventes precios ni costos. Si no te lo dieron, creá el producto sin precio (queda inactivo en el catálogo hasta que lo cargue) y avisalo en una línea.
- Siempre escribí vos una descripción comercial corta (1 a 3 frases, atractiva, sin inventar datos técnicos que no sepas) para cada producto nuevo. Si hay foto, usala para describir lo que realmente se ve (color, tipo, material visible). Completá la categoría si es obvia.
- Si el usuario adjunta fotos SIN decir qué hacer: describí en una línea qué ves y preguntá si es un producto nuevo (y cuántas unidades hay) o si es de uno que ya existe.
- Si dice «agregale esta foto a X» / «cambiá la foto de X»: buscá X con search_products y usá update_product con add_image_indexes (con replace_images=true si pide cambiarla o reemplazarla). Nunca digas que la foto quedó guardada si la herramienta no devolvió images_saved mayor a 0.
- Si el usuario adjunta fotos: mirá cada una. Si son fotos de un producto que está creando o editando, pasá su número en image_indexes (0 es la primera foto). Si son varios productos distintos, creá cada uno con sus fotos. Si no podés distinguir qué es, preguntá.
- Podés encadenar varias acciones en un mismo mensaje (ej. cargar 5 productos).
- No borrás productos: si piden eliminar, sugerí desactivarlo (update_product active=false) o borrarlo desde Inventario.
- Para preguntas de ventas, deudas o stock consultá las herramientas; no estimes de memoria. Cuando muestres montos usá formato $12.500.
- Si algo no tiene que ver con el negocio, respondé brevemente y volvé al tema.
- Respondé en texto simple; podés usar listas cortas con guiones. No uses tablas ni encabezados."""

def _obj(props, required=()):
    return {"type": "OBJECT", "properties": props, "required": list(required)}
S, N, I, B = ({"type": t} for t in ("STRING", "NUMBER", "INTEGER", "BOOLEAN"))
def _d(desc, base): return {**base, "description": desc}

TOOLS = [{"functionDeclarations": [
    {"name": "search_products", "description": "Busca productos del negocio por nombre/categoría y devuelve id, precio, stock y variantes. Sin parámetros lista todo (máx. 40).",
     "parameters": _obj({"query": _d("Texto a buscar en nombre, categoría o descripción (ej. 'remera negra')", S),
                         "only_low_stock": _d("true para listar solo los que están en o bajo su stock mínimo", B)})},
    {"name": "create_product", "description": "Crea un producto nuevo (con descripción y, si hay fotos adjuntas, con sus imágenes).",
     "parameters": _obj({"name": _d("Nombre del producto", S), "stock": _d("Unidades iniciales (ignorado si hay variantes)", I),
                         "price": _d("Precio de venta en ARS. Omitir si el usuario no lo dio", N), "cost": _d("Costo en ARS (opcional)", N),
                         "description": _d("Descripción comercial corta redactada por vos", S), "category": _d("Categoría (ej. Remeras, Almacén)", S),
                         "min_stock": _d("Alerta de stock bajo (por defecto 5)", I),
                         "image_indexes": {"type": "ARRAY", "items": I, "description": "Números (desde 0) de las fotos adjuntas que pertenecen a este producto"},
                         "variants": {"type": "ARRAY", "description": "Variantes opcionales (talle/color/sabor), cada una con su stock",
                                      "items": _obj({"name": S, "stock": I, "price": N}, ["name", "stock"])}}, ["name", "stock"])},
    {"name": "update_product", "description": "Modifica datos de un producto existente (solo los campos que se indiquen).",
     "parameters": _obj({"product_id": I, "name": S, "description": S, "price": N, "cost": N, "category": S, "min_stock": I,
                         "active": _d("false oculta el producto del catálogo", B),
                         "add_image_indexes": {"type": "ARRAY", "items": I, "description": "Fotos adjuntas (desde 0) a agregar al producto"},
                         "replace_images": _d("true para reemplazar las fotos actuales por las adjuntas en vez de sumarlas", B)}, ["product_id"])},
    {"name": "adjust_stock", "description": "Ingresa (add), descuenta (remove) o fija (set) el stock de un producto o de una variante.",
     "parameters": _obj({"product_id": I, "quantity": _d("Cantidad de unidades (entero ≥ 0)", I),
                         "mode": _d("add = suma, remove = resta, set = deja exactamente esa cantidad", {"type": "STRING", "enum": ["add", "remove", "set"]}),
                         "variant_id": _d("Obligatorio si el producto tiene variantes", I)}, ["product_id", "quantity", "mode"])},
    {"name": "get_low_stock", "description": "Lista productos y variantes con stock en o por debajo del mínimo.", "parameters": _obj({})},
    {"name": "sales_summary", "description": "Resumen de ventas, costos, ganancia, medios de pago y productos más vendidos de un período (por defecto, el mes en curso).",
     "parameters": _obj({"date_from": _d("AAAA-MM-DD", S), "date_to": _d("AAAA-MM-DD", S)})},
    {"name": "list_debtors", "description": "Clientes que deben plata (fiados) y proveedores a los que se les debe.", "parameters": _obj({})},
]}]

# ---------------------------------------------------------------- herramientas
class ToolError(Exception):
    pass

def _int(v, name, lo=0, hi=10_000_000):
    try:
        if isinstance(v, bool): raise ValueError
        n = int(float(v))
    except (TypeError, ValueError):
        raise ToolError(f"{name} debe ser un número entero.")
    if n < lo or n > hi:
        raise ToolError(f"{name} fuera de rango.")
    return n

def _num(v, name):
    try:
        if isinstance(v, bool): raise ValueError
        n = float(v)
    except (TypeError, ValueError):
        raise ToolError(f"{name} debe ser un número.")
    if n < 0 or n > 1e12:
        raise ToolError(f"{name} fuera de rango.")
    return round(n, 2)

def _for_model(img):
    """Copia liviana (máx. 768 px) de la foto solo para que la mire el modelo: menos datos a Gemini = respuesta más rápida. Lo que se guarda es la original."""
    try:
        from PIL import Image
        b64 = img.split(";base64,", 1)[1]
        im = Image.open(io.BytesIO(base64.b64decode(b64)))
        if max(im.size) <= 768:
            return img
        im = im.convert("RGB"); im.thumbnail((768, 768))
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=72)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return img

def _pick(imgs, idxs):
    out = []
    for i in idxs or []:
        try:
            i = int(i)
        except (TypeError, ValueError):
            continue
        if 0 <= i < len(imgs) and imgs[i] not in out:
            out.append(imgs[i])
    return out[:MAX_IMAGES]

def _product_view(p, variants):
    return {"id": p["id"], "name": p["name"], "category": p["category"], "price": p["price"], "cost": p["cost"], "stock": p["stock"], "min_stock": p["min_stock"],
            "active": bool(p["active"]), "images_count": p["img_n"],
            "variants": [{"id": v["id"], "name": v["name"], "stock": v["stock"], "price": v["price"] or p["price"]} for v in variants]}

def t_search_products(c, sid, a, imgs):
    sql, args = "SELECT id,name,description,category,price,cost,stock,min_stock,active,img_n FROM products WHERE store_id=?", [sid]
    for w in re.findall(r"\w+", str(a.get("query") or "").lower())[:6]:
        sql += " AND (lower(name) LIKE ? OR lower(category) LIKE ? OR lower(description) LIKE ?)"; args += [f"%{w}%"] * 3
    if a.get("only_low_stock"):
        sql += " AND stock<=min_stock"
    rows = c.execute(sql + " ORDER BY name COLLATE NOCASE LIMIT 40", args).fetchall()
    prods = ops.attach_variants(c, [dict(r) for r in rows])
    return {"count": len(prods), "products": [_product_view(p, p["variants"]) for p in prods]}, None

def t_create_product(c, sid, a, imgs):
    name = str(a.get("name") or "").strip()[:120]
    if not name:
        raise ToolError("Falta el nombre del producto.")
    dup = c.execute("SELECT id, stock FROM products WHERE store_id=? AND lower(name)=?", (sid, name.lower())).fetchone()
    if dup:
        raise ToolError(f"Ya existe «{name}» (id {dup['id']}, stock {dup['stock']}). Usá adjust_stock o update_product en vez de crearlo de nuevo.")
    price = _num(a["price"], "price") if a.get("price") is not None else 0
    cost = _num(a["cost"], "cost") if a.get("cost") is not None else 0
    stock = _int(a.get("stock", 0), "stock")
    min_stock = _int(a["min_stock"], "min_stock") if a.get("min_stock") is not None else 5
    images = _pick(imgs, a.get("image_indexes"))
    active = price > 0                                   # sin precio no se publica en el catálogo
    pid = c.execute("INSERT INTO products(store_id,name,description,price,cost,stock,min_stock,active,category,images) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (sid, name, str(a.get("description") or "").strip()[:600], price, cost, stock, min_stock, int(active),
                     str(a.get("category") or "").strip()[:40], json.dumps(images))).lastrowid
    n_img, v_img = db.img_meta(images)
    c.execute("UPDATE products SET img_n=?, img_v=? WHERE id=?", (n_img, v_img, pid))
    nv = 0
    for v in (a.get("variants") or [])[:30]:
        vname = str(v.get("name") or "").strip()[:60]
        if not vname:
            continue
        c.execute("INSERT INTO product_variants(product_id,name,sku,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?,?)",
                  (pid, vname, "", _num(v["price"], "price") if v.get("price") is not None else 0, 0, _int(v.get("stock", 0), "stock"), 2)); nv += 1
    ops.sync_variant_stock(c, pid)
    total = c.execute("SELECT stock FROM products WHERE id=?", (pid,)).fetchone()[0]
    res = {"ok": True, "id": pid, "name": name, "stock": total, "price": price, "published_in_catalog": active, "images_saved": len(images), "variants_created": nv}
    if not active:
        res["note"] = "Sin precio: quedó inactivo en el catálogo hasta que se le cargue uno."
    return res, {"ok": True, "text": f"Producto creado: {name} · {total} u." + (f" · {ars(price)}" if price else " · sin precio") + (f" · {len(images)} foto(s)" if images else "")}

def _own(c, sid, pid):
    p = c.execute("SELECT * FROM products WHERE id=? AND store_id=?", (_int(pid, "product_id", 1), sid)).fetchone()
    if not p:
        raise ToolError("No existe un producto con ese id en tu negocio. Buscalo primero con search_products.")
    return p

def t_update_product(c, sid, a, imgs):
    p = _own(c, sid, a.get("product_id"))
    sets, args, changed = [], [], []
    for key, conv in (("name", lambda v: str(v).strip()[:120]), ("description", lambda v: str(v).strip()[:600]), ("category", lambda v: str(v).strip()[:40]),
                      ("price", lambda v: _num(v, "price")), ("cost", lambda v: _num(v, "cost")), ("min_stock", lambda v: _int(v, "min_stock"))):
        if a.get(key) is not None:
            val = conv(a[key])
            if key == "name" and not val:
                raise ToolError("El nombre no puede quedar vacío.")
            sets.append(f"{key}=?"); args.append(val); changed.append(key)
    if a.get("active") is not None:
        sets.append("active=?"); args.append(int(bool(a["active"]))); changed.append("active")
    new_imgs = _pick(imgs, a.get("add_image_indexes"))
    saved = 0
    if new_imgs:
        try:
            cur = json.loads(p["images"] or "[]")
        except ValueError:
            cur = []
        final = new_imgs if a.get("replace_images") else (cur + [i for i in new_imgs if i not in cur])[:MAX_IMAGES]
        n_img, v_img = db.img_meta(final); saved = len(final)
        sets += ["images=?", "img_n=?", "img_v=?"]; args += [json.dumps(final), n_img, v_img]; changed.append("images")
    if not sets:
        raise ToolError("No indicaste qué cambiar.")
    c.execute(f"UPDATE products SET {', '.join(sets)} WHERE id=? AND store_id=?", (*args, p["id"], sid))
    return {"ok": True, "id": p["id"], "changed": changed, "images_saved": saved}, {"ok": True, "text": f"Producto actualizado: {p['name']} ({', '.join(changed)})"}

def t_adjust_stock(c, sid, a, imgs):
    p = _own(c, sid, a.get("product_id"))
    mode, qty = str(a.get("mode") or "add"), _int(a.get("quantity"), "quantity")
    if mode not in ("add", "remove", "set"):
        raise ToolError("mode debe ser add, remove o set.")
    if mode in ("add", "remove") and qty < 1:
        raise ToolError("La cantidad debe ser al menos 1.")
    def new_value(cur, label):
        n = cur + qty if mode == "add" else cur - qty if mode == "remove" else qty
        if n < 0:
            raise ToolError(f"No alcanza: {label} tiene {cur} u. y querés descontar {qty}.")
        return n
    if ops.has_variants(c, p["id"]):
        v = c.execute("SELECT * FROM product_variants WHERE id=? AND product_id=?", (a["variant_id"], p["id"])).fetchone() if a.get("variant_id") else None
        if not v:
            names = [f"{x['name']} (id {x['id']})" for x in c.execute("SELECT id, name FROM product_variants WHERE product_id=?", (p["id"],))]
            raise ToolError(f"«{p['name']}» tiene variantes: indicá variant_id. Opciones: {', '.join(names)}.")
        label, before = f"{p['name']} ({v['name']})", v["stock"]
        after = new_value(before, label)
        c.execute("UPDATE product_variants SET stock=? WHERE id=?", (after, v["id"]))
        ops.sync_variant_stock(c, p["id"])
    else:
        label, before = p["name"], p["stock"]
        after = new_value(before, label)
        c.execute("UPDATE products SET stock=? WHERE id=?", (after, p["id"]))
    low = after <= (v["min_stock"] if ops.has_variants(c, p["id"]) else p["min_stock"])
    return ({"ok": True, "item": label, "before": before, "after": after, "low_stock_alert": low},
            {"ok": True, "text": f"Stock de {label}: {before} → {after} u."})

def t_get_low_stock(c, sid, a, imgs):
    items = ops.low_stock(c, sid, 30)
    return {"count": len(items), "items": items}, None

def t_sales_summary(c, sid, a, imgs):
    try:
        d1, d2 = reports.parse_range(a.get("date_from"), a.get("date_to"))
    except ValueError as e:
        raise ToolError(str(e))
    r = reports.build(c, sid, d1, d2)
    return {"period": r["period"], "totals": r["totals"], "previous_period_totals": r["prev"], "top_products": r["products"][:8],
            "by_payment_method": r["methods"], "top_expenses": r["expenses"][:5], "fiados": r["fiados"]}, None

def t_list_debtors(c, sid, a, imgs):
    cl = [dict(r) for r in c.execute("SELECT name, phone, balance FROM clients WHERE store_id=? AND balance>0 ORDER BY balance DESC LIMIT 25", (sid,))]
    sp = [dict(r) for r in c.execute("SELECT name, balance FROM suppliers WHERE store_id=? AND balance>0 ORDER BY balance DESC LIMIT 25", (sid,))]
    return {"clients_owe_you": cl, "clients_total": round(sum(x["balance"] for x in cl), 2),
            "you_owe_suppliers": sp, "suppliers_total": round(sum(x["balance"] for x in sp), 2)}, None

HANDLERS = {"search_products": t_search_products, "create_product": t_create_product, "update_product": t_update_product, "adjust_stock": t_adjust_stock,
            "get_low_stock": t_get_low_stock, "sales_summary": t_sales_summary, "list_debtors": t_list_debtors}

def run_tool(sid, name, args, imgs):
    """Ejecuta una herramienta en su propia transacción. Devuelve (resultado_para_el_modelo, chip_para_la_UI)."""
    fn = HANDLERS.get(name)
    if not fn:
        return {"error": f"Herramienta desconocida: {name}"}, None
    try:
        with db.conn() as c:
            return fn(c, sid, args if isinstance(args, dict) else {}, imgs)
    except ToolError as e:
        return {"error": str(e)}, {"ok": False, "text": str(e)} if name in ("create_product", "update_product", "adjust_stock") else None
    except HTTPException as e:
        return {"error": str(e.detail)}, None
    except Exception:
        log.exception("Falló la herramienta %s", name)
        return {"error": "Error interno al ejecutar la acción."}, {"ok": False, "text": "No pude completar una acción."}

# ---------------------------------------------------------------- conversación
def own_keys(c, sid):
    return [r["api_key"] for r in c.execute("SELECT api_key FROM ai_keys WHERE store_id=? ORDER BY id", (sid,))]

def converse(u, text, images):
    sid = u["store_id"]
    with db.conn() as c:
        hist = c.execute("SELECT role, content FROM ai_messages WHERE store_id=? ORDER BY id DESC LIMIT ?", (sid, HISTORY_TURNS)).fetchall()[::-1]
        keys = own_keys(c, sid)
    while hist and hist[0]["role"] != "user":          # Gemini exige que la charla empiece con un turno del usuario
        hist = hist[1:]
    contents = [{"role": h["role"], "parts": [{"text": h["content"]}]} for h in hist]
    parts = [{"text": text or "(adjunté fotos)"}]
    for i, img in enumerate(_for_model(x) for x in images):
        mime, b64 = img[5:].split(";base64,", 1)
        parts += [{"text": f"[Foto {i}]"}, {"inlineData": {"mimeType": mime, "data": b64}}]
    first = {"role": "user", "parts": parts}
    contents.append(first)
    system = SYSTEM.format(business=u["business"], btype=u["business_type"], today=date.today().isoformat())

    actions, reply = [], ""
    for _ in range(MAX_STEPS):
        res, _src = gk.generate(contents, system, TOOLS, keys)
        cand = (res.get("candidates") or [{}])[0]
        mparts = (cand.get("content") or {}).get("parts") or []
        calls = [p["functionCall"] for p in mparts if "functionCall" in p]
        if not calls:
            reply = "".join(p.get("text", "") for p in mparts if not p.get("thought")).strip()
            if not reply:
                fb = (res.get("promptFeedback") or {}).get("blockReason") or cand.get("finishReason")
                reply = "No pude responder a eso. ¿Podés reformularlo?" if fb in (None, "STOP") else f"No pude procesar ese mensaje ({fb}). Probá con otras palabras o otra foto."
            break
        contents.append({"role": "model", "parts": mparts})           # se devuelve tal cual (incluye firmas de pensamiento)
        results = []
        if images and any((fc.get("args") or {}).get(k) for fc in calls for k in ("image_indexes", "add_image_indexes")):
            first["parts"] = [{"text": (text or "(adjunté fotos)") + f"\n[{len(images)} foto(s) adjunta(s): ya las viste y las asignaste; se guardan al ejecutar la acción]"}]   # no se reenvían en los pasos siguientes
        for fc in calls:
            out, ui = run_tool(sid, fc.get("name"), fc.get("args") or {}, images)
            if ui: actions.append(ui)
            results.append({"functionResponse": {"name": fc.get("name"), "response": out}})
        contents.append({"role": "user", "parts": results})
    else:
        reply = "Hice varias acciones pero necesito que me confirmes cómo seguir. Revisá Inventario y decime qué falta."
    note = f"\n[📷 {len(images)} foto(s) adjunta(s)]" if images else ""
    with db.conn() as c:
        c.execute("INSERT INTO ai_messages(store_id,role,content) VALUES (?,?,?)", (sid, "user", (text or "") + note))
        c.execute("INSERT INTO ai_messages(store_id,role,content,actions) VALUES (?,?,?,?)", (sid, "model", reply, json.dumps(actions)))
        c.execute("DELETE FROM ai_messages WHERE store_id=? AND id NOT IN (SELECT id FROM ai_messages WHERE store_id=? ORDER BY id DESC LIMIT 200)", (sid, sid))
    return reply, actions


# ---------------------------------------------------------------- descripciones automáticas (lápiz celeste)
DESC_SYSTEM = """Sos redactor de fichas de producto para el catálogo online de «{business}» ({btype}), un comercio de Argentina.
Escribís en español rioplatense, con tono cálido y comercial.
Tarea: con el nombre del producto (y la foto, si hay) escribí una descripción de 1 a 3 frases, de 280 caracteres como máximo.
Reglas: describí solo lo que se ve en la foto o se deduce del nombre (tipo de producto, color, material visible, uso). NUNCA inventes medidas, marcas, ingredientes, composición, precios ni promesas.
Sin emojis, sin comillas, sin títulos ni listas. Respondé únicamente con el texto de la descripción."""
IMG_LOCAL = re.compile(r"^/api/img/(\d+)/(\d+)\?v=[0-9a-f]{0,12}$")

def _clean_desc(text):
    t = re.sub(r"\s+", " ", text or "").strip().strip("\"'«»“”").strip()
    if len(t) > 300:
        cut = t[:300]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        t = cut[:end + 1] if end > 120 else cut.rstrip() + "…"
    return t

def describe_product(u, name, category, image, keys):
    """Pide a Gemini una descripción comercial a partir del nombre y (opcional) una foto data URL."""
    system = DESC_SYSTEM.format(business=u["business"], btype=u["business_type"])
    parts = [{"text": f"Producto: {name}" + (f"\nCategoría: {category}" if category else "")}]
    if image:
        mime, b64 = _for_model(image)[5:].split(";base64,", 1)
        parts.append({"inlineData": {"mimeType": mime, "data": b64}})
    res, _src = gk.generate([{"role": "user", "parts": parts}], system, None, keys, {"maxOutputTokens": 600})
    cand = (res.get("candidates") or [{}])[0]
    text = _clean_desc("".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts") or [] if not p.get("thought")))
    if not text:
        raise HTTPException(502, "La IA no pudo describir este producto. Probá de nuevo o escribila a mano.")
    return text

# ---------------------------------------------------------------- API
class ChatIn(BaseModel):
    message: str = ""
    images: list[str] = []

class DescribeIn(BaseModel):
    name: str = ""; category: str = ""; image: str = ""
    product_id: Optional[int] = None
    save_if_empty: bool = False      # guarda la descripción en el producto, solo si todavía no tiene una

class KeyIn(BaseModel):
    key: str; label: str = ""

_hits, _hits_lock = defaultdict(deque), threading.Lock()
def rate_ok(sid, limit=30, window=600):
    now = time.time()
    with _hits_lock:
        q = _hits[sid]
        while q and q[0] < now - window: q.popleft()
        if len(q) >= limit: return False
        q.append(now); return True

def make_router(current_user):
    R = APIRouter(prefix="/api/ai")

    @R.post("/chat")
    def chat(d: ChatIn, u=Depends(current_user)):
        text = d.message.strip()[:4000]
        if not text and not d.images:
            raise HTTPException(400, "Escribí un mensaje o adjuntá una foto.")
        if len(d.images) > MAX_IMAGES:
            raise HTTPException(400, f"Podés adjuntar hasta {MAX_IMAGES} fotos por mensaje.")
        if any(len(i) > 450_000 or not IMG.match(i) for i in d.images):
            raise HTTPException(400, "Las fotos deben ser PNG, JPG o WebP de menos de 450 KB cada una.")
        if not rate_ok(u["store_id"]):
            return {"code": "busy", "reply": "Vas muy rápido: esperá unos minutos antes de seguir con el asistente.", "actions": []}
        try:
            reply, actions = converse(u, text, d.images)
        except gk.AllKeysExhausted:
            return {"code": "no_keys", "actions": [], "reply": "Se agotó la cuota de IA de todas las claves del sistema. "
                    "Podés seguir ahora agregando tu propia clave gratuita de Gemini (Google AI Studio) en «Claves de IA»."}
        except gk.GeminiError as e:
            log.warning("Gemini: %s %s", e.kind, e)
            raise HTTPException(502, "El servicio de IA no respondió. Probá de nuevo en un momento.")
        return {"reply": reply, "actions": actions}

    @R.post("/describe")
    def describe(d: DescribeIn, u=Depends(current_user)):
        sid, name, cat, image = u["store_id"], d.name.strip()[:120], d.category.strip()[:40], d.image.strip()
        stored = []
        if d.product_id is not None:
            with db.conn() as c:
                r = c.execute("SELECT name,category,images FROM products WHERE id=? AND store_id=?", (d.product_id, sid)).fetchone()
            if not r:
                raise HTTPException(404, "Producto inexistente.")
            name, cat = name or r["name"], cat or r["category"] or ""
            try: stored = json.loads(r["images"] or "[]")
            except ValueError: stored = []
            if not image and stored:
                image = stored[0]
        m = IMG_LOCAL.match(image)                       # foto que el formulario ya tenía guardada: se toma de la base
        if m:
            image = stored[int(m.group(2))] if d.product_id is not None and int(m.group(1)) == d.product_id and int(m.group(2)) < len(stored) else ""
        if image and (len(image) > 600_000 or not IMG.match(image)):
            image = ""                                   # foto inválida o muy pesada: se describe solo por el nombre
        if not name:
            raise HTTPException(400, "Escribí primero el nombre del producto.")
        if not rate_ok(("describe", sid), limit=80, window=600):
            raise HTTPException(429, "Vas muy rápido: esperá unos minutos antes de generar más descripciones.")
        with db.conn() as c:
            keys = own_keys(c, sid)
        try:
            text = describe_product(u, name, cat, image, keys)
        except gk.AllKeysExhausted:
            raise HTTPException(429, "Se agotó la cuota de IA. Agregá tu propia clave gratuita de Gemini en Asistente IA → Claves de IA.")
        except gk.GeminiError as e:
            log.warning("Gemini (describe): %s %s", e.kind, e)
            if e.kind == "quota":
                raise HTTPException(429, "Se agotó la cuota de IA por ahora. Probá en unos minutos o agregá tu clave en Asistente IA.")
            raise HTTPException(502, "El servicio de IA no respondió. Probá de nuevo en un momento.")
        saved = False
        if d.save_if_empty and d.product_id is not None:
            with db.conn() as c:
                saved = c.execute("UPDATE products SET description=? WHERE id=? AND store_id=? AND trim(coalesce(description,''))=''",
                                  (text, d.product_id, sid)).rowcount > 0
        return {"description": text, "saved": saved}

    @R.get("/history")
    def history(u=Depends(current_user)):
        with db.conn() as c:
            rows = c.execute("SELECT id, role, content, actions, created_at FROM ai_messages WHERE store_id=? ORDER BY id DESC LIMIT 60", (u["store_id"],)).fetchall()
        out = []
        for r in rows[::-1]:
            try: acts = json.loads(r["actions"] or "[]")
            except ValueError: acts = []
            out.append({"id": r["id"], "role": r["role"], "content": r["content"], "actions": acts, "created_at": r["created_at"]})
        return out

    @R.delete("/history")
    def clear_history(u=Depends(current_user)):
        with db.conn() as c:
            c.execute("DELETE FROM ai_messages WHERE store_id=?", (u["store_id"],))
        return {"ok": True}

    @R.get("/status")
    def status(u=Depends(current_user)):
        with db.conn() as c:
            rows = c.execute("SELECT id, label, api_key, created_at FROM ai_keys WHERE store_id=? ORDER BY id", (u["store_id"],)).fetchall()
        st = gk.pool_status([r["api_key"] for r in rows])
        return {**st, "ready": st["server_available"] + st["own_available"] > 0,
                "own_keys": [{"id": r["id"], "label": r["label"], "masked": gk.mask(r["api_key"]), "cooling": gk.cooling(r["api_key"])} for r in rows]}

    @R.post("/keys")
    def add_key(d: KeyIn, u=Depends(current_user)):
        key = d.key.strip()
        if not re.fullmatch(r"[A-Za-z0-9._\-]{20,200}", key):
            raise HTTPException(400, "Esa clave no tiene el formato de una clave de Gemini.")
        try:
            gk.verify_key(key)
        except gk.GeminiError as e:
            if e.kind in ("invalid", "fatal", "model"):
                raise HTTPException(400, "Google rechazó esa clave. Revisá que esté bien copiada y activa.")
            if e.kind != "quota":
                raise HTTPException(502, "No pudimos verificar la clave ahora. Probá de nuevo en un momento.")
        with db.conn() as c:
            if c.execute("SELECT 1 FROM ai_keys WHERE store_id=? AND api_key=?", (u["store_id"], key)).fetchone():
                raise HTTPException(409, "Esa clave ya está cargada.")
            if c.execute("SELECT COUNT(*) FROM ai_keys WHERE store_id=?", (u["store_id"],)).fetchone()[0] >= 5:
                raise HTTPException(400, "Podés cargar hasta 5 claves propias.")
            c.execute("INSERT INTO ai_keys(store_id,label,api_key) VALUES (?,?,?)", (u["store_id"], d.label.strip()[:40], key))
        return {"ok": True}

    @R.delete("/keys/{kid}")
    def del_key(kid: int, u=Depends(current_user)):
        with db.conn() as c:
            c.execute("DELETE FROM ai_keys WHERE id=? AND store_id=?", (kid, u["store_id"]))
        return {"ok": True}

    return R
