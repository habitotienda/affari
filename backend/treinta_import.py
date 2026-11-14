"""Importación de catálogo desde Treinta.

  POST /api/import/treinta        {url}        → vista previa de productos (NO guarda nada)
  POST /api/import/treinta/save   {products[]} → guarda en lote en el negocio del usuario autenticado

Registro (igual que ai_agent):  app.include_router(treinta_import.make_router(current_user))
El precio de costo se guarda en 0: es un dato privado que no figura en la tienda pública.
"""
import re, json, logging
from concurrent.futures import ThreadPoolExecutor
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import database as db
from ai_agent import rate_ok                      # mismo limitador que usa el asistente
from treinta_scraper import (ScrapeError, fetch_image_as_data_uri, parse_price, scrape_store,
                             NAME_MAX, DESC_MAX, CAT_MAX, MAX_IMGS_PER_PRODUCT)

log = logging.getLogger("affari.treinta")
MAX_SAVE = 60                                      # por request; el front manda lotes más chicos
DEFAULT_MIN_STOCK = 5


class UrlIn(BaseModel):
    url: str


class ItemIn(BaseModel):
    name: str
    price: float = 0
    description: str = ""
    category: str = ""
    stock: int = 0
    image: str = ""
    images: List[str] = []


class SaveIn(BaseModel):
    products: List[ItemIn]


def _clean(t):
    """Los marcadores internos de Next.js ("$undefined", "$null"…) que se colaron al importar no son texto del producto."""
    return "" if re.fullmatch(r"\$(undefined|null|nan)", (t or "").strip(), re.I) else t

def _fail(e: ScrapeError):
    raise HTTPException(e.status, e.message)


def _clean(it: ItemIn):
    """Revalida todo lo que viene del navegador: nunca se confía en el cliente."""
    name = " ".join(it.name.split())[:NAME_MAX]
    price = parse_price(it.price)
    if not name or price is None:
        return None
    urls = [u for u in ([it.image] if it.image else []) + it.images if isinstance(u, str) and u.startswith(("http://", "https://"))]
    return {"name": name, "price": price, "description": _clean(" ".join(it.description.split())[:DESC_MAX]),
            "category": _clean(" ".join(it.category.split())[:CAT_MAX]), "stock": max(0, min(int(it.stock), 10_000_000)),
            "urls": list(dict.fromkeys(urls))[:MAX_IMGS_PER_PRODUCT]}


def _download(urls):
    """Fotos de un producto → data URIs. Una foto rota no frena la importación."""
    imgs, failed = [], 0
    for u in urls:
        try:
            imgs.append(fetch_image_as_data_uri(u))
        except ScrapeError as e:
            failed += 1; log.info("treinta: foto omitida (%s): %s", e.code, u[:120])
        except Exception:
            failed += 1; log.exception("treinta: error inesperado con foto")
    return imgs, failed


def make_router(current_user):
    R = APIRouter(prefix="/api/import")

    @R.post("/treinta")
    def preview(d: UrlIn, u=Depends(current_user)):
        if not rate_ok(("treinta-scan", u["store_id"]), limit=10, window=600):
            raise HTTPException(429, "Hiciste muchas importaciones seguidas. Esperá unos minutos.")
        try:
            r = scrape_store(d.url)
        except ScrapeError as e:
            _fail(e)
        # marca cuáles ya existen en el negocio para que la vista previa los avise
        with db.conn() as c:
            have = {row[0] for row in c.execute("SELECT lower(name) FROM products WHERE store_id=?", (u["store_id"],))}
        for p in r["products"]:
            p["exists"] = p["name"].lower() in have
        return {"store": r["store"], "source_url": r["source_url"], "count": len(r["products"]), "products": r["products"]}

    @R.post("/treinta/save")
    def save(d: SaveIn, u=Depends(current_user)):
        sid = u["store_id"]
        if not d.products:
            raise HTTPException(400, "No hay productos para guardar.")
        if len(d.products) > MAX_SAVE:
            raise HTTPException(400, f"Máximo {MAX_SAVE} productos por lote.")
        if not rate_ok(("treinta-save", sid), limit=60, window=600):
            raise HTTPException(429, "Demasiados guardados seguidos. Esperá unos minutos.")

        items = [x for x in (_clean(i) for i in d.products) if x]
        # fotos en paralelo y fuera de la transacción: no se retiene la base mientras se descarga
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda x: _download(x["urls"]), items))

        created = skipped = img_failed = 0
        with db.conn() as c:
            have = {row[0] for row in c.execute("SELECT lower(name) FROM products WHERE store_id=?", (sid,))}
            for it, (imgs, bad) in zip(items, results):
                key = it["name"].lower()
                if key in have:                      # mismo criterio que el asistente: no duplicar por nombre
                    skipped += 1; continue
                have.add(key); img_failed += bad
                active = it["price"] > 0             # sin precio no se publica en el catálogo
                pid = c.execute("INSERT INTO products(store_id,name,description,price,cost,stock,min_stock,active,category,images) VALUES (?,?,?,?,?,?,?,?,?,?)",
                                (sid, it["name"], it["description"], it["price"], 0.0, it["stock"], DEFAULT_MIN_STOCK,
                                 int(active), it["category"], json.dumps(imgs))).lastrowid
                n_img, v_img = db.img_meta(imgs)
                c.execute("UPDATE products SET img_n=?, img_v=? WHERE id=?", (n_img, v_img, pid))
                created += 1
        return {"created": created, "skipped_duplicates": skipped, "images_failed": img_failed,
                "invalid": len(d.products) - len(items)}

    return R
