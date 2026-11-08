import os
"""Ejecuta el esquema traducido y las consultas "difíciles" de Affari contra un Postgres local (vía psql)."""
import sys, types, subprocess, re
sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)
sys.path.insert(0, ""+os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","backend")+"")
import os; os.environ["DATABASE_URL"] = "postgresql://x"
import database as db

def psql(sql):
    r = subprocess.run(["psql", "-h", "/var/tmp/pgt", "-p", "5433", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t", "-c", sql],
                       capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()

def lit(v): return "NULL" if v is None else (str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")
def run(sql, params=()):
    q = db.translate(sql, with_params=False); parts = q.split("?"); assert len(parts) == len(params) + 1, sql
    q = parts[0] + "".join(lit(p) + s for p, s in zip(params, parts[1:]))
    if sql.lstrip()[:6].upper() == "INSERT" and "RETURNING" not in q.upper(): q += " RETURNING id"
    rc, out = psql(q)
    if rc: print("FALLO:", sql[:90].replace("\n", " "), "\n   ", out[:300]); return None
    return out

psql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
rc, out = psql(db.pg_schema()); print("schema:", "OK" if not rc else out)
for tbl, col, ddl in db.MIGRATIONS:
    rc, out = psql(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} {ddl}")
    if rc: print("migr", tbl, col, out)
rc, out = psql("ALTER TABLE sales ENABLE ROW LEVEL SECURITY"); print("rls:", rc == 0)

run("INSERT INTO users(name,email,phone,password_hash) VALUES (?,?,?,?)", ("Ana", "a@a.com", "1155551234", "x"))
run("INSERT INTO stores(user_id,name,type,slug) VALUES (?,?,?,?)", (1, "Tienda", "Kiosco", "tienda"))
run("INSERT INTO products(store_id,name,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?)", (1, "Remera", 100, 40, 10, 5))
run("INSERT INTO clients(store_id,name,phone,balance) VALUES (?,?,?,?)", (1, "Juan", "1100000000", 50))
run("INSERT INTO sales(store_id,client_id,kind,concept,amount,cost,method,product_id,product_name,qty) VALUES (?,?,?,?,?,?,?,?,?,?)", (1, 1, "fiado", "Fiado: Juan (1 × Remera)", 100, 40, "Fiado", 1, "Remera", 1))
run("INSERT INTO sales(store_id,kind,concept,amount,method) VALUES (?,?,?,?,?)", (1, "salida", "Luz", 20, "Efectivo"))
run("INSERT INTO suppliers(store_id,name) VALUES (?,?)", (1, "Prov"))
for sql, p in [
 ("SELECT 1 FROM stores WHERE slug=? AND id IS NOT ?", ("tienda", None)),
 ("SELECT 1 FROM stores WHERE slug=? AND id IS NOT ?", ("tienda", 1)),
 ("SELECT 1 FROM users WHERE email = ? OR substr(phone, -10) = substr(?, -10)", ("a@a.com", "1155551234")),
 ("SELECT id, password_hash FROM users WHERE email = ? OR substr(phone, -10) = substr(?, -10)", ("x", "1155551234")),
 ("SELECT SUM(amount) FROM sales WHERE store_id=? AND kind IN ('entrada','fiado') AND is_payment=0 AND date(created_at) = date('now','localtime')", (1,)),
 ("SELECT SUM(CASE WHEN kind='entrada' THEN amount WHEN kind='salida' THEN -amount ELSE 0 END) FROM sales WHERE store_id=? AND method=? AND date(created_at) = date('now','localtime')", (1, "Efectivo")),
 ("SELECT * FROM products WHERE store_id=? ORDER BY name COLLATE NOCASE", (1,)),
 ("SELECT cl.id, cl.name, cl.phone, cl.balance, cl.email, (SELECT MAX(created_at) FROM sales s WHERE s.client_id = cl.id) AS last_move FROM clients cl WHERE cl.store_id=? ORDER BY cl.balance DESC, cl.name", (1,)),
 ("UPDATE clients SET balance = MAX(balance - ?, 0) WHERE id=?", (500, 1)),
 ("""SELECT p.id, p.name, p.stock, p.min_stock FROM products p WHERE p.store_id=? AND p.stock<=p.min_stock AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
     UNION ALL SELECT p.id, p.name || ' · ' || v.name, v.stock, v.min_stock FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.store_id=? AND v.stock<=v.min_stock ORDER BY 3 LIMIT ?""", (1, 1, 8)),
 ("""SELECT cl.id, cl.name, cl.phone, cl.balance, MAX(s.created_at) AS last_move FROM clients cl LEFT JOIN sales s ON s.client_id=cl.id WHERE cl.store_id=? AND cl.balance>0 GROUP BY cl.id ORDER BY cl.balance DESC""", (1,)),
 ("""SELECT s.*, (SELECT MAX(created_at) FROM supplier_moves m WHERE m.supplier_id=s.id) AS last_move, (SELECT MIN(due_date) FROM supplier_moves m WHERE m.supplier_id=s.id AND m.kind='compra' AND m.due_date IS NOT NULL) AS next_due FROM suppliers s WHERE s.store_id=? ORDER BY s.balance DESC, s.name COLLATE NOCASE""", (1,)),
 ("SELECT SUM(CASE WHEN kind='entrada' THEN amount WHEN kind='salida' THEN -amount ELSE 0 END) FROM sales WHERE store_id=? AND method=? AND date(created_at) < ?", (1, "Efectivo", "2030-01-01")),
 ("SELECT SUM(CASE WHEN kind='entrada' THEN amount END) i, SUM(CASE WHEN kind='salida' THEN amount END) o FROM sales WHERE store_id=? AND method=? AND date(created_at)=?", (1, "Efectivo", "2026-11-07")),
 ("""INSERT INTO cash_closures(store_id,day,expected,counted,diff,notes) VALUES (?,?,?,?,?,?) ON CONFLICT(store_id,day) DO UPDATE SET expected=excluded.expected, counted=excluded.counted, diff=excluded.diff, notes=excluded.notes, created_at=datetime('now','localtime')""", (1, "2026-11-07", 1, 1, 0, "")),
 ("""INSERT INTO cash_closures(store_id,day,expected,counted,diff,notes) VALUES (?,?,?,?,?,?) ON CONFLICT(store_id,day) DO UPDATE SET expected=excluded.expected, counted=excluded.counted, diff=excluded.diff, notes=excluded.notes, created_at=datetime('now','localtime')""", (1, "2026-11-07", 2, 2, 0, "")),
 ("SELECT id, store_id, concept FROM sales WHERE product_id IS NULL AND product_name IS NULL AND qty=0 AND kind IN ('entrada','fiado') AND is_payment=0 AND concept LIKE '%×%'", ()),
]:
    out = run(sql, p); print("ok  " if out is not None else "ERR ", sql.strip()[:70].replace("\n", " "))
# reports.py
import reports; from datetime import date
IR = reports.IN_RANGE; S = reports.SALE; a = (1, "2026-11-01", "2026-11-30")
for name, sql in [
 ("per_day", f"""SELECT date(created_at) d, SUM(CASE WHEN {S} THEN amount END) sales, SUM(CASE WHEN {S} THEN cost END) cogs, SUM(CASE WHEN kind='salida' AND supplier_id IS NULL THEN amount END) expenses FROM sales WHERE {IR} GROUP BY d"""),
 ("methods", f"""SELECT method, SUM(CASE WHEN kind='entrada' THEN amount END) i, SUM(CASE WHEN kind='salida' THEN amount END) o FROM sales WHERE {IR} AND kind IN ('entrada','salida') GROUP BY method ORDER BY i DESC"""),
 ("products", f"""SELECT MIN(COALESCE(p.name, s.product_name)) name, SUM(s.qty) units, SUM(s.amount) revenue, SUM(s.cost) cost FROM sales s LEFT JOIN products p ON p.id = s.product_id WHERE s.store_id=? AND date(s.created_at) BETWEEN ? AND ? AND {S} AND s.qty > 0 GROUP BY COALESCE(CAST(s.product_id AS TEXT), s.product_name) ORDER BY units DESC, revenue DESC LIMIT 50"""),
 ("expenses", f"""SELECT MIN(concept) concept, COUNT(*) n, SUM(amount) t FROM sales WHERE {IR} AND kind='salida' AND supplier_id IS NULL GROUP BY lower(trim(concept)) ORDER BY t DESC LIMIT 10"""),
 ("moves", f"SELECT created_at, kind, is_payment, concept, method, amount, cost FROM sales WHERE {IR} ORDER BY created_at, id LIMIT 5000"),
]:
    out = run(sql, a); print("ok  " if out is not None else "ERR ", name)

print("--- SQL del asistente")
for sql, p in [
 ("SELECT * FROM products WHERE store_id=? AND (lower(name) LIKE ? OR lower(category) LIKE ? OR lower(description) LIKE ?) AND stock<=min_stock ORDER BY name COLLATE NOCASE LIMIT 40", (1, "%rem%", "%rem%", "%rem%")),
 ("SELECT id, stock FROM products WHERE store_id=? AND lower(name)=?", (1, "remera")),
 ("INSERT INTO products(store_id,name,description,price,cost,stock,min_stock,active,category,images) VALUES (?,?,?,?,?,?,?,?,?,?)", (1, "Buzo", "desc 100% algodón", 10.5, 0, 3, 5, 1, "Ropa", "[]")),
 ("INSERT INTO product_variants(product_id,name,sku,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?,?)", (1, "M", "", 0, 0, 4, 2)),
 ("UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id=?) WHERE id=?", (1, 1)),
 ("INSERT INTO ai_messages(store_id,role,content,actions) VALUES (?,?,?,?)", (1, "model", "hola", "[]")),
 ("DELETE FROM ai_messages WHERE store_id=? AND id NOT IN (SELECT id FROM ai_messages WHERE store_id=? ORDER BY id DESC LIMIT 200)", (1, 1)),
 ("SELECT name, phone, balance FROM clients WHERE store_id=? AND balance>0 ORDER BY balance DESC LIMIT 25", (1,)),
 ("INSERT INTO ai_keys(store_id,label,api_key) VALUES (?,?,?)", (1, "x", "KEY")),
 ("SELECT COUNT(*) FROM ai_keys WHERE store_id=?", (1,)),
]:
    out = run(sql, p); print("ok  " if out is not None else "ERR ", sql[:70])
