"""Copia los datos de una base SQLite de Affari (affari.db) a Supabase/PostgreSQL.

Uso (con DATABASE_URL=postgresql://... en .env):
    python migrate_to_supabase.py                    # usa ./affari.db
    python migrate_to_supabase.py ruta/a/affari.db
    python migrate_to_supabase.py --force            # copia aunque Supabase ya tenga datos (los reemplaza)

Crea el esquema si falta, conserva los ids originales y deja las secuencias listas para seguir insertando.
"""
import sqlite3, sys, os
import database as db

TABLES = ["users", "stores", "products", "product_variants", "clients", "suppliers", "invoices", "invoice_items", "sales",
          "supplier_moves", "cash_closures", "ai_keys", "ai_messages"]          # orden por dependencias

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if not db.IS_PG:
        sys.exit("DATABASE_URL no apunta a PostgreSQL. Ponelo en .env (postgresql://...) y volvé a ejecutar.")
    src_path = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), "affari.db")
    if not os.path.exists(src_path):
        sys.exit(f"No encuentro {src_path}. Pasá la ruta de tu affari.db como argumento.")
    src = sqlite3.connect(src_path); src.row_factory = sqlite3.Row
    db.init_db()
    with db.conn() as c:
        have = {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}
        if any(have.values()) and not force:
            sys.exit(f"Supabase ya tiene datos ({ {t: n for t, n in have.items() if n} }). Usá --force para reemplazarlos.")
        if force:
            for t in reversed(TABLES):
                c.execute(f"DELETE FROM {t}")
        for t in TABLES:
            try:
                scols = [r["name"] for r in src.execute(f"PRAGMA table_info({t})")]
            except sqlite3.Error:
                continue
            if not scols:
                continue
            pcols = {r["column_name"] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?", (t,))}
            cols = [x for x in scols if x in pcols]
            rows = src.execute(f"SELECT {','.join(cols)} FROM {t}").fetchall()
            for r in rows:
                c.execute(f"INSERT INTO {t}({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", tuple(r))
            c.execute(f"SELECT setval(pg_get_serial_sequence('{t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM {t}),1), (SELECT MAX(id) IS NOT NULL FROM {t}))")
            print(f"{t:18} {len(rows):6} filas")
        db.backfill_images(c)          # calcula cantidad/versión de fotos de los productos copiados
    print("Listo: los datos están en Supabase.")

if __name__ == "__main__":
    main()
