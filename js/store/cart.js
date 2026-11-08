/* Catálogo · estado del carrito. Sin DOM: solo datos, totales y mensaje de WhatsApp.
   key = clave de localStorage (null en la vista previa del editor para no persistir). */
function sfCart(key, lookup) {
  let items = {};
  const subs = new Set();
  const save = () => { try { if (key) localStorage.setItem(key, JSON.stringify(items)); } catch { /* modo privado */ } };
  const emit = () => { save(); subs.forEach(f => f()); };
  const clamp = (p, n) => Math.max(0, Math.min(Math.floor(Number(n)) || 0, p.stock));
  try { if (key) items = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { items = {}; }

  const api = {
    qty: id => items[id] || 0,
    set(id, n) {
      const p = lookup(+id); if (!p) return;
      n = clamp(p, n); if (n) items[id] = n; else delete items[id]; emit();
    },
    add: (id, d = 1) => api.set(id, api.qty(id) + d),
    remove: id => api.set(id, 0),
    clear() { items = {}; emit(); },
    /* Quita productos que ya no existen / se agotaron y ajusta cantidades al stock actual */
    prune() {
      for (const id of Object.keys(items)) {
        const p = lookup(+id);
        if (!p || p.active === false || p.stock <= 0) delete items[id]; else items[id] = clamp(p, items[id]);
      }
      save();
    },
    totals() {
      const lines = Object.entries(items).map(([id, n]) => { const p = lookup(+id); return p && { p, n, sub: p.price * n }; }).filter(Boolean);
      return { lines, count: lines.reduce((s, l) => s + l.n, 0), total: lines.reduce((s, l) => s + l.sub, 0) };
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
  return api;
}

/* Mensaje automático para WhatsApp. info = { name, delivery: 'retiro'|'envio', note } */
function sfOrderMessage(store, t, info = {}) {
  const who = (info.name || '').trim();
  const rows = t.lines.map(l => `• ${l.n} × ${l.p.name} — ${sfArs(l.sub)}` + (l.n > 1 ? ` (${sfArs(l.p.price)} c/u)` : ''));
  const out = [`Hola ${store.name}! ${who ? `Soy ${who}. ` : ''}Quiero hacer este pedido:`, '', ...rows, '',
    `Total: ${sfArs(t.total)}`, `Entrega: ${info.delivery === 'envio' ? 'Envío (coordinar costo y horario)' : 'Retiro en el local'}`];
  if ((info.note || '').trim()) out.push(`Nota: ${info.note.trim()}`);
  out.push('', '¡Gracias!');
  return out.join('\n');
}
