CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  slug TEXT,
  reminder_tpl TEXT,
  theme TEXT,
  logo TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  balance REAL NOT NULL DEFAULT 0
);
-- Movimientos de caja: entrada (venta cobrada), salida (gasto/pago), fiado (venta a cuenta).
-- is_payment=1 marca el cobro de un fiado (entra a caja pero no cuenta como venta nueva).
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id),
  kind TEXT NOT NULL CHECK (kind IN ('entrada','salida','fiado')),
  concept TEXT NOT NULL,
  amount REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'Efectivo',
  is_payment INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER,          -- producto vendido (sin FK: el historial sobrevive si se borra el producto)
  product_name TEXT,           -- nombre al momento de la venta
  qty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales(store_id, created_at);

-- ===== Parte 5: gestión operativa =====
-- Variantes de producto (talle, color, sabor…). Si un producto tiene variantes, products.stock = suma de sus variantes.
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,      -- 0 = usa el precio del producto
  cost REAL NOT NULL DEFAULT 0,       -- 0 = usa el costo del producto
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 2
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

-- Proveedores y su cuenta corriente (balance > 0 = les debemos).
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, cuit TEXT, address TEXT, notes TEXT,
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS supplier_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('compra','pago')),
  concept TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  method TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_supmoves ON supplier_moves(supplier_id, created_at);

-- Cierre de caja diario (efectivo esperado vs. contado).
CREATE TABLE IF NOT EXISTS cash_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  expected REAL NOT NULL, counted REAL NOT NULL, diff REAL NOT NULL, notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(store_id, day)
);

-- Comprobantes. type: X (no fiscal), A, B, C, NCX (anulación). afip_status: no_fiscal | pendiente | aprobado | rechazado.
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id),
  type TEXT NOT NULL, pto_vta INTEGER NOT NULL DEFAULT 1, number INTEGER NOT NULL,
  issue_date TEXT NOT NULL DEFAULT (date('now','localtime')),
  client_name TEXT NOT NULL DEFAULT 'Consumidor Final', client_doc_type INTEGER NOT NULL DEFAULT 99,
  client_doc TEXT NOT NULL DEFAULT '0', client_iva TEXT NOT NULL DEFAULT 'Consumidor Final',
  net REAL NOT NULL DEFAULT 0, iva REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'Efectivo', notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'emitido' CHECK (status IN ('emitido','anulado')),
  afip_status TEXT NOT NULL DEFAULT 'no_fiscal', cae TEXT, cae_due TEXT, afip_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(store_id, type, pto_vta, number)
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER, variant_id INTEGER,
  description TEXT NOT NULL, qty INTEGER NOT NULL, unit_price REAL NOT NULL, iva_rate REAL NOT NULL DEFAULT 0
);

-- ===== Asistente IA (Gemini) =====
-- Claves de Gemini propias de cada negocio: se usan solo cuando se agotan las del servidor (GEMINI_API_KEYS en .env).
CREATE TABLE IF NOT EXISTS ai_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(store_id, api_key)
);
-- Historial de la conversación con el asistente (solo texto; las imágenes no se guardan aquí).
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','model')),
  content TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_messages ON ai_messages(store_id, id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  mp_payment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Miniaturas de fotos de producto ya reducidas (base64). Evita leer y reescalar fotos enormes en cada pedido, también después de que Render se duerme.
CREATE TABLE IF NOT EXISTS product_thumbs (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  v TEXT NOT NULL,
  w INTEGER NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (product_id, idx, w)
);
