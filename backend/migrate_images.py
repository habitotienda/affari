"""Migra las imágenes base64 guardadas en PostgreSQL a Supabase Storage (WebP) y libera el espacio de la base.

Qué migra:  products.images (lista JSON) · stores.logo · stores.theme (bgImg, coverImg y promos[])

Orden de ejecución (IMPORTANTE: desplegá primero la app con image_store.py, así acepta URLs en vez de base64):
    python migrate_images.py --dry-run          # simula: convierte en memoria y muestra el ahorro; NO escribe nada
    python migrate_images.py                    # 1) backup_images.json  2) sube y verifica  3) reemplaza base64 por URL
    python migrate_images.py --vacuum           # además ejecuta VACUUM FULL (Postgres no devuelve el espacio solo)
    python migrate_images.py --restore backup_images.json [--dry-run]    # vuelve atrás (reescribe el base64 original)

Otras opciones: --only products|stores · --limit N · --workers 4 · --backup RUTA

Garantías:
  · El backup se completa ANTES de tocar la base y la migración lee desde ese archivo (no vuelve a bajar el base64).
  · Una fila solo se modifica si TODAS sus imágenes se subieron y la URL pública respondió 200 con los mismos bytes.
  · La actualización es condicional (WHERE valor = el del backup): si alguien editó la fila mientras tanto, se omite.
  · Idempotente: lo que ya es URL se ignora; se puede volver a correr tras un corte o un error.
Requiere DATABASE_URL y SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_BUCKET (en .env o en el entorno).
"""
import argparse, json, os, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import database as db
import image_store as store

BACKUP_DEFAULT = "backup_images.json"
lock = threading.Lock()
stats = {"rows": 0, "images": 0, "before": 0, "after": 0, "skipped": 0, "errors": []}


def log(msg):
    with lock:
        print(msg, flush=True)


def has_data(v):
    return isinstance(v, str) and "data:image" in v


# ------------------------------------------------------------------ lectura de la base (una fila por vez: nunca todo en memoria)
def row_ids(table):
    with db.conn() as c:
        return [r[0] for r in c.execute(f"SELECT id FROM {table} ORDER BY id").fetchall()]

def read_product(pid):
    with db.conn() as c:
        r = c.execute("SELECT id, store_id, images FROM products WHERE id=?", (pid,)).fetchone()
    return {"id": r["id"], "store_id": r["store_id"], "images": r["images"]} if r and has_data(r["images"]) else None

def read_store(sid):
    with db.conn() as c:
        r = c.execute("SELECT id, logo, theme FROM stores WHERE id=?", (sid,)).fetchone()
    if not r or not (has_data(r["logo"]) or has_data(r["theme"])):
        return None
    return {"id": r["id"], "logo": r["logo"], "theme": r["theme"]}

def iter_db(only):
    if only in (None, "products"):
        for pid in row_ids("products"):
            rec = read_product(pid)
            if rec: yield "products", rec
    if only in (None, "stores"):
        for sid in row_ids("stores"):
            rec = read_store(sid)
            if rec: yield "stores", rec


# ------------------------------------------------------------------ backup
# Un registro por línea dentro de un JSON válido, para poder releerlo en streaming sin cargar el archivo entero.
def write_backup(path, only):
    """Escribe el backup en un temporal y solo si hay algo que migrar reemplaza al archivo final (sin pisar uno anterior)."""
    tmp = path + ".tmp"
    counts = {"products": 0, "stores": 0}
    with open(tmp, "w", encoding="utf-8") as f:
        f.write('{\n"version": 1,\n"created_at": %s' % json.dumps(datetime.now().isoformat(timespec="seconds")))
        section, first = None, True
        for table, rec in iter_db(only):
            if table != section:
                f.write("\n]" if section else "")
                f.write(',\n"%s": [\n' % table)
                section, first = table, True
            f.write(("" if first else ",\n") + json.dumps(rec, ensure_ascii=False))
            first = False
            counts[table] += 1
        f.write("\n]" if section else "")
        f.write("\n}\n")
        f.flush(); os.fsync(f.fileno())
    if not any(counts.values()):
        os.remove(tmp)
        return counts
    if os.path.exists(path):                                   # nunca se pisa un backup anterior
        keep = f"{path}.{datetime.now():%Y%m%d_%H%M%S}"
        os.rename(path, keep)
        log(f"· Backup anterior conservado como {keep}")
    os.replace(tmp, path)
    log(f"· Backup listo: {path} ({os.path.getsize(path) / 1e6:.1f} MB) — {counts['products']} productos, {counts['stores']} tiendas")
    return counts

def iter_backup(path):
    section = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s.startswith('"products"'): section = "products"
            elif s.startswith('"stores"'): section = "stores"
            elif s.startswith('{"id"') and section:
                yield section, json.loads(s.rstrip(","))


# ------------------------------------------------------------------ conversión + subida
def make_converter(folder, dry):
    """Devuelve fn(data_url) -> URL pública (o marcador en dry-run), acumulando los bytes antes/después."""
    def convert(data_url):
        raw = store.decode_data_url(data_url)
        webp = store.to_webp(raw)
        path = store.object_path(folder, webp)
        url = "dry-run://" + path if dry else store.upload(webp, path, verify=True)   # sube y exige 200 OK con los mismos bytes
        with lock:                                                                   # solo cuenta lo que realmente quedó subido
            stats["images"] += 1; stats["before"] += len(raw); stats["after"] += len(webp)
        return url
    return convert

def migrate_product(rec, dry):
    imgs = json.loads(rec["images"] or "[]")
    conv = make_converter(f"products/{rec['store_id']}", dry)
    new = [conv(i) if store.is_data_url(i) else i for i in imgs]
    if dry:
        return True
    n, v = db.img_meta(new)
    with db.conn() as c:
        # condicional: si el producto cambió desde el backup, no se pisa
        ok = c.execute("UPDATE products SET images=?, img_n=?, img_v=? WHERE id=? AND images=?",
                       (json.dumps(new), n, v, rec["id"], rec["images"])).rowcount
        if ok:
            c.execute("DELETE FROM product_thumbs WHERE product_id=?", (rec["id"],))   # miniaturas base64 viejas
    return bool(ok)

def migrate_store(rec, dry):
    sets, args, guard, gargs = [], [], [], []
    if store.is_data_url(rec["logo"]):
        sets.append("logo=?"); args.append(make_converter(f"stores/{rec['id']}/logo", dry)(rec["logo"]))
        guard.append("logo=?"); gargs.append(rec["logo"])
    if has_data(rec["theme"]):
        theme = store.map_theme(json.loads(rec["theme"]), make_converter(f"stores/{rec['id']}/theme", dry))
        sets.append("theme=?"); args.append(json.dumps(theme))
        guard.append("theme=?"); gargs.append(rec["theme"])
    if dry or not sets:
        return True
    with db.conn() as c:
        return bool(c.execute(f"UPDATE stores SET {', '.join(sets)} WHERE id=? AND {' AND '.join(guard)}",
                              (*args, rec["id"], *gargs)).rowcount)

def process(item, dry):
    table, rec = item
    tag = f"{table[:-1]} {rec['id']}"
    try:
        done = migrate_product(rec, dry) if table == "products" else migrate_store(rec, dry)
    except Exception as e:                                     # la fila queda intacta (con su base64)
        with lock: stats["errors"].append(f"{tag}: {e}")
        log(f"  ✗ {tag}: {e}")
        return
    with lock:
        if done: stats["rows"] += 1
        else: stats["skipped"] += 1
    log(f"  {'~' if dry else '✓'} {tag}" if done else f"  ! {tag}: cambió durante la migración, se omite (volvé a correr el script)")


# ------------------------------------------------------------------ restore / vacuum / tamaños
def restore(path, dry):
    n = 0
    for table, rec in iter_backup(path):
        n += 1
        if dry:
            continue
        with db.conn() as c:
            if table == "products":
                nn, v = db.img_meta(json.loads(rec["images"] or "[]"))
                c.execute("UPDATE products SET images=?, img_n=?, img_v=? WHERE id=?", (rec["images"], nn, v, rec["id"]))
            else:
                c.execute("UPDATE stores SET logo=?, theme=? WHERE id=?", (rec["logo"], rec["theme"], rec["id"]))
    log(f"{'Simulado' if dry else 'Restaurado'}: {n} registros desde {path}. Las miniaturas se regeneran solas al abrir la app.")

def sizes():
    if not db.IS_PG:
        return None
    with db.conn() as c:
        total = c.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
        tabs = {t: c.execute("SELECT pg_size_pretty(pg_total_relation_size(?::regclass))", (t,)).fetchone()[0]
                for t in ("products", "stores", "product_thumbs")}
    return total, tabs

def vacuum():
    """VACUUM FULL reescribe las tablas y devuelve el espacio al disco. No corre dentro de una transacción -> conexión propia en autocommit.
    Bloquea esas tablas mientras dura: hacelo en un horario tranquilo."""
    import psycopg2
    dsn = db.DATABASE_URL.replace("postgres://", "postgresql://", 1)
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
    raw = psycopg2.connect(dsn, connect_timeout=15)
    raw.autocommit = True
    try:
        cur = raw.cursor()
        cur.execute("SET statement_timeout = 0")
        for t in ("product_thumbs", "products", "stores"):
            log(f"· VACUUM FULL {t} …")
            cur.execute(f"VACUUM FULL {t}")
    finally:
        raw.close()


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="simula sin subir, sin escribir backup y sin tocar la base")
    ap.add_argument("--vacuum", action="store_true", help="VACUUM FULL al terminar (solo Postgres)")
    ap.add_argument("--only", choices=("products", "stores"))
    ap.add_argument("--limit", type=int, help="procesar como máximo N registros (para probar)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--backup", default=BACKUP_DEFAULT)
    ap.add_argument("--restore", metavar="ARCHIVO")
    a = ap.parse_args()

    if a.restore:
        return restore(a.restore, a.dry_run)
    if not a.dry_run and not store.enabled():
        sys.exit("Faltan SUPABASE_URL, SUPABASE_SERVICE_KEY o SUPABASE_BUCKET.")

    before = sizes()
    t0 = time.time()
    if a.dry_run:
        log("DRY-RUN: no se sube nada, no se escribe backup, no se modifica la base.")
        items = iter_db(a.only)
    else:
        if not any(write_backup(a.backup, a.only).values()):   # 1) backup completo ANTES de modificar nada
            return print("No hay imágenes base64 para migrar: la base ya está limpia.")
        items = iter_backup(a.backup)                          # 2) la migración lee del backup, no vuelve a bajar el base64
    if a.limit:
        from itertools import islice
        items = islice(items, a.limit)

    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        batch = []
        for it in items:
            batch.append(it)
            if len(batch) >= a.workers * 2:
                list(ex.map(lambda x: process(x, a.dry_run), batch)); batch = []
        list(ex.map(lambda x: process(x, a.dry_run), batch))

    s = stats
    saved = 100 * (1 - s["after"] / s["before"]) if s["before"] else 0
    print(f"\n{'Simulación' if a.dry_run else 'Migración'} en {time.time() - t0:.0f} s: {s['rows']} registros, {s['images']} imágenes")
    print(f"  Peso de las imágenes: {s['before'] / 1e6:.1f} MB -> {s['after'] / 1e6:.1f} MB WebP  (-{saved:.0f}%)")
    if s["skipped"]: print(f"  Omitidos por cambios concurrentes: {s['skipped']}")
    if s["errors"]:
        print(f"  Errores ({len(s['errors'])}) — esas filas conservan su base64:")
        for e in s["errors"][:20]: print("   -", e)
    if not a.dry_run and a.vacuum and db.IS_PG:
        vacuum()
    if not a.dry_run and before:
        after = sizes()
        print(f"  Base de datos: {before[0]} -> {after[0]}   (tablas: {before[1]} -> {after[1]})")
        if not a.vacuum:
            print("  Nota: Postgres no libera el disco hasta un VACUUM FULL; corré de nuevo con --vacuum (o `VACUUM FULL products, stores, product_thumbs;`).")
    sys.exit(1 if s["errors"] else 0)


if __name__ == "__main__":
    main()
