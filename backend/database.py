"""Acceso a datos. Dos motores con la MISMA interfaz (consultas con `?`, filas tipo dict, .lastrowid / .rowcount):

  - PostgreSQL / Supabase  -> cuando DATABASE_URL empieza con postgresql://  (producción)
  - SQLite                 -> cuando DATABASE_URL es sqlite:///archivo.db      (desarrollo local)

El resto del backend escribe SQL "estilo SQLite"; para Postgres se traduce solo (ver `translate()`).
Las fechas se guardan como TEXT 'AAAA-MM-DD HH:MM:SS' (hora de Argentina) en ambos motores, igual que antes.
"""
import hashlib, json, os, re, sqlite3, threading, time, unicodedata
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///affari.db").strip()
IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
DB_PATH = "" if IS_PG else DATABASE_URL.replace("sqlite:///", "")
SCHEMA = os.path.join(os.path.dirname(__file__), "schema.sql")
TZ = os.getenv("APP_TZ", "America/Argentina/Buenos_Aires")

# ---------------------------------------------------------------- traducción SQLite -> PostgreSQL
NOW_TS = f"to_char(now() AT TIME ZONE '{TZ}','YYYY-MM-DD HH24:MI:SS')"
NOW_DAY = f"to_char(now() AT TIME ZONE '{TZ}','YYYY-MM-DD')"

def translate(sql, with_params=True):
    """SQL estilo SQLite -> PostgreSQL. Solo cubre las construcciones que usa Affari."""
    sql = sql.replace("datetime('now','localtime')", NOW_TS).replace("date('now','localtime')", NOW_DAY)
    sql = re.sub(r"(?<![\w.])date\(([\w.]+)\)", r"substr(\1,1,10)", sql)          # date(created_at) -> 'AAAA-MM-DD'
    sql = re.sub(r"([\w.]+)\s+COLLATE\s+NOCASE", r"lower(\1)", sql, flags=re.I)
    sql = re.sub(r"\bIS\s+NOT\s+\?", "IS DISTINCT FROM ?", sql, flags=re.I)
    sql = re.sub(r"\bMAX\(([\w.]+ - \?), 0\)", r"GREATEST(\1, 0)", sql)
    if with_params:
        sql = sql.replace("%", "%%").replace("?", "%s")
    return sql

def pg_schema():
    """Reutiliza schema.sql (única fuente de verdad) adaptándolo a Postgres."""
    with open(SCHEMA, encoding="utf-8") as f:
        s = f.read()
    s = re.sub(r"INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY", s)
    s = re.sub(r"\bREAL\b", "DOUBLE PRECISION", s)
    return translate(s, with_params=False)

class Row:
    """Fila que admite row["col"], row[0], dict(row) y desempaquetado, como sqlite3.Row."""
    __slots__ = ("_k", "_v", "_m")
    def __init__(self, keys, values):
        self._k, self._v, self._m = keys, values, dict(zip(keys, values))
    def __getitem__(self, i):
        return self._v[i] if isinstance(i, (int, slice)) else self._m[i]
    def keys(self): return list(self._k)
    def __iter__(self): return iter(self._v)
    def __len__(self): return len(self._v)
    def __repr__(self): return f"Row({self._m})"

class PgCursor:
    def __init__(self, cur, sql):
        self._cur, self.lastrowid, self.rowcount = cur, None, cur.rowcount
        self._keys = [d[0] for d in cur.description] if cur.description else None
        if sql.lstrip()[:6].upper() == "INSERT" and self._keys == ["id"]:
            row = cur.fetchone()
            self.lastrowid = row[0] if row else None
            self._keys = None
    def _wrap(self, r): return Row(self._keys, r) if r is not None else None
    def fetchone(self): return self._wrap(self._cur.fetchone()) if self._keys else None
    def fetchall(self): return [self._wrap(r) for r in self._cur.fetchall()] if self._keys else []
    def __iter__(self): return iter(self.fetchall())

class PgConn:
    def __init__(self, raw): self.raw = raw
    def execute(self, sql, params=()):
        params = tuple(params) if params is not None else ()
        is_insert = sql.lstrip()[:6].upper() == "INSERT"
        q = translate(sql, with_params=bool(params))
        if is_insert and "RETURNING" not in q.upper():
            q += " RETURNING id"
        cur = self.raw.cursor()
        cur.execute(q, params or None)
        return PgCursor(cur, sql)
    def executescript(self, script):
        cur = self.raw.cursor(); cur.execute(script); cur.close()

_pool, _pool_lock, _last_used = None, threading.Lock(), {}

def _make_pool():
    global _pool
    with _pool_lock:
        if _pool is None:
            import psycopg2, psycopg2.extensions, psycopg2.pool
            # NUMERIC -> float (SUM de bigint devuelve Decimal, que el JSON no admite)
            psycopg2.extensions.register_type(psycopg2.extensions.new_type(
                psycopg2.extensions.DECIMAL.values, "DEC2FLOAT", lambda v, cur: float(v) if v is not None else None))
            dsn = DATABASE_URL.replace("postgres://", "postgresql://", 1)
            if "sslmode=" not in dsn:
                dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
            try:
                _pool = psycopg2.pool.ThreadedConnectionPool(1, int(os.getenv("DB_POOL_MAX", "10")), dsn,
                                                             connect_timeout=10, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3)
            except psycopg2.OperationalError as e:
                raise RuntimeError(
                    "No se pudo conectar a Supabase/Postgres: %s\n"
                    "Si el error habla de red o 'Network is unreachable', tu red no tiene IPv6: en Supabase > Connect copiá la cadena "
                    "'Session pooler' (host *.pooler.supabase.com, usuario postgres.<ref>) y ponela en DATABASE_URL." % str(e).strip()) from e
    return _pool

def _pg_checkout():
    pool = _make_pool()
    raw = pool.getconn()
    if raw.closed or (time.time() - _last_used.get(id(raw), 0) > 45):      # conexión posiblemente cortada por inactividad
        try:
            cur = raw.cursor(); cur.execute("SELECT 1"); cur.close(); raw.rollback()
        except Exception:
            pool.putconn(raw, close=True)
            raw = pool.getconn()
    return pool, raw

@contextmanager
def conn():
    if IS_PG:
        pool, raw = _pg_checkout()
        try:
            yield PgConn(raw)
            raw.commit()
        except BaseException:
            raw.rollback()
            raise
        finally:
            _last_used[id(raw)] = time.time()
            pool.putconn(raw)
        return
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    try:
        yield c
        c.commit()
    finally:
        c.close()

# Columnas nuevas para bases creadas con versiones anteriores
MIGRATIONS = [
    ("stores", "slug", "TEXT"), ("stores", "reminder_tpl", "TEXT"),
    ("products", "description", "TEXT NOT NULL DEFAULT ''"), ("products", "active", "INTEGER NOT NULL DEFAULT 1"),
    ("stores", "theme", "TEXT"), ("stores", "logo", "TEXT"),
    ("products", "category", "TEXT NOT NULL DEFAULT ''"), ("products", "images", "TEXT NOT NULL DEFAULT '[]'"),
    ("sales", "is_payment", "INTEGER NOT NULL DEFAULT 0"),
    ("sales", "product_id", "INTEGER"), ("sales", "product_name", "TEXT"), ("sales", "qty", "INTEGER NOT NULL DEFAULT 0"),
    # Planes y cobros
    ("users", "plan", "TEXT NOT NULL DEFAULT 'free'"), ("users", "plan_expires_at", "TEXT"), ("users", "trial_ends_at", "TEXT"),
    # Parte 5
    ("clients", "email", "TEXT"), ("clients", "cuit", "TEXT"), ("clients", "address", "TEXT"), ("clients", "notes", "TEXT"),
    ("stores", "fiscal", "TEXT"),
    ("sales", "supplier_id", "INTEGER"), ("sales", "invoice_id", "INTEGER"), ("sales", "variant_name", "TEXT"),
    # Rendimiento: cantidad y versión de las fotos, para listar productos sin arrastrar el base64 de cada imagen
    ("products", "img_n", "INTEGER NOT NULL DEFAULT 0"), ("products", "img_v", "TEXT NOT NULL DEFAULT ''"),
    # Horarios de atención (JSON, ver hours.py) e inicio de sesión con Google (identificador "sub" de la cuenta de Google)
    ("stores", "hours", "TEXT"), ("users", "google_sub", "TEXT"),
]

def img_meta(images):
    """(cantidad, versión) de una lista de imágenes. La versión va en la URL de cada foto (/api/img/<id>/<n>?v=...): cambia si cambia la foto."""
    images = [i for i in (images or []) if isinstance(i, str) and i]
    return len(images), (hashlib.md5("".join(images).encode()).hexdigest()[:12] if images else "")

def backfill_images(c):
    """Productos cargados antes de img_n/img_v: calcula la cantidad y versión de sus fotos una sola vez."""
    for r in c.execute("SELECT id, images FROM products WHERE img_n=0 AND images NOT IN ('[]','') AND images IS NOT NULL").fetchall():
        try:
            imgs = json.loads(r["images"])
        except ValueError:
            continue
        n, v = img_meta(imgs)
        c.execute("UPDATE products SET img_n=?, img_v=? WHERE id=?", (n, v, r["id"]))

def slugify(text):
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "tienda"

def unique_slug(c, base, exclude_id=None):
    base, n, slug = slugify(base), 1, slugify(base)
    while c.execute("SELECT 1 FROM stores WHERE slug=? AND id IS NOT ?", (slug, exclude_id)).fetchone():
        n += 1; slug = f"{base[:36]}-{n}"
    return slug

_ITEM = re.compile(r"(?:^|\()(\d+) × (.+?)\)?$")

def backfill_sale_items(c):
    """Ventas anteriores a la parte 4: recupera producto y cantidad desde el concepto ("2 × Remera")."""
    prods = {}
    for r in c.execute("SELECT id, store_id, name FROM products"):
        prods.setdefault((r["store_id"], r["name"].strip().lower()), r["id"])
    rows = c.execute("SELECT id, store_id, concept FROM sales WHERE product_id IS NULL AND product_name IS NULL AND qty=0 "
                     "AND kind IN ('entrada','fiado') AND is_payment=0 AND concept LIKE '%×%'").fetchall()
    for r in rows:
        m = _ITEM.search(r["concept"] or "")
        if m:
            name = m.group(2).strip()
            c.execute("UPDATE sales SET product_id=?, product_name=?, qty=? WHERE id=?",
                      (prods.get((r["store_id"], name.lower())), name, int(m.group(1)), r["id"]))

def init_db():
    with conn() as c:
        if IS_PG:
            c.executescript(pg_schema())
            for tbl, col, ddl in MIGRATIONS:
                c.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} {ddl}")
            # Supabase expone el esquema public por su API REST: con RLS activado y sin políticas, la clave anon no ve nada.
            # El backend se conecta como rol postgres, que ignora RLS.
            for (t,) in [(r[0],) for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")]:
                c.execute(f'ALTER TABLE "{t}" ENABLE ROW LEVEL SECURITY')
        else:
            with open(SCHEMA, encoding="utf-8") as f:
                c.executescript(f.read())
            for tbl, col, ddl in MIGRATIONS:
                if col not in {r["name"] for r in c.execute(f"PRAGMA table_info({tbl})")}:
                    c.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {ddl}")
        for r in c.execute("SELECT id, name FROM stores WHERE slug IS NULL").fetchall():
            c.execute("UPDATE stores SET slug=? WHERE id=?", (unique_slug(c, r["name"], r["id"]), r["id"]))
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_store_slug ON stores(slug)")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub)")      # varios NULL permitidos; un Google = una cuenta
        c.execute("CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(store_id, product_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_id)")
        backfill_sale_items(c)
        backfill_images(c)
