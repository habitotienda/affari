-- Planes y cobros · ejecutar en Supabase > SQL Editor (opcional: Affari también lo crea solo al iniciar)
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan            TEXT NOT NULL DEFAULT 'free';   -- 'free' | 'pro' | 'negocio'
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TEXT;                           -- 'AAAA-MM-DD HH:MM:SS' (hora de Argentina)
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at   TEXT;                           -- fin de la prueba de 7 días

CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL,
  mp_payment_id TEXT NOT NULL,
  status        TEXT NOT NULL,
  amount        DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM-DD HH24:MI:SS')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_mp ON payments(mp_payment_id);   -- evita acreditar dos veces el mismo pago
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;                                  -- solo el backend (rol postgres) accede

-- Los usuarios que ya existían reciben 7 días de prueba desde hoy (si no, quedarían bloqueados de golpe)
UPDATE users SET trial_ends_at = to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '7 days','YYYY-MM-DD HH24:MI:SS')
WHERE trial_ends_at IS NULL;

-- Dar o quitar un plan a mano (por ejemplo a un cliente que te paga por transferencia):
-- UPDATE users SET plan='pro', plan_expires_at = to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires' + interval '30 days','YYYY-MM-DD HH24:MI:SS') WHERE email='cliente@correo.com';
