/* Catálogo · utilidades compartidas (panel + página pública /c/<slug>) */
const sfEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sfArs = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const SF_DEF = { bg: '#F8FAFC', accent: '#10B981', text: '#0F172A', title: '', description: '', banner: '', font: 'modern', radius: 'round', cols: 2, open: true, delivery: false, optPickup: true, optDelivery: null,
  pattern: 'none', patColor: '', patOpacity: 24, patAnimate: true, patSpeed: 2, headColor: '', priceColor: '', cardColor: '',
  cardStyle: 'solid', logoShape: 'rounded', heroAlign: 'left', addLabel: 'Agregar', footer: '',
  /* Imágenes propias (p. ej. hechas en Canva). Vacío = sin imagen. */
  bgImg: '', bgImgMode: 'cover', bgImgDim: 35, coverImg: '', coverDim: 30, promos: [] };
/* Formas de entrega que ofrece el comercio. optDelivery sin definir (catálogos anteriores) hereda el interruptor viejo «delivery».
   Si el dueño apaga las dos, queda «retiro» para que el pedido siempre tenga una forma de entrega. */
function sfModes(t) {
  const pickup = t.optPickup !== false, ship = t.optDelivery == null ? !!t.delivery : !!t.optDelivery;
  const m = []; if (pickup) m.push('retiro'); if (ship) m.push('envio');
  return m.length ? m : ['retiro'];
}
const SF_FONTS = { modern: '"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif', classic: 'Georgia,"Times New Roman",serif', tech: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace' };

const sfSvg = (d, s = 18, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/* Íconos de dos tonos (línea + relleno suave del color de acento) para las formas de entrega */
const sfDuo = (body, s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SF_ICON = {
  search: sfSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  cart: sfSvg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.6 1.6 0 0 0 1.6 1.3h8.2a1.6 1.6 0 0 0 1.6-1.2L21 8H6"/>', 20),
  vGrid: sfSvg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  vOne: sfSvg('<rect x="4" y="3" width="16" height="8" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/>'),
  vList: sfSvg('<rect x="3" y="4" width="6" height="6" rx="1.2"/><rect x="3" y="14" width="6" height="6" rx="1.2"/><path d="M13 6h8M13 8.5h5M13 16h8M13 18.5h5"/>'),
  user: sfSvg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>', 20),
  phone: sfSvg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', 20),
  pin: sfSvg('<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>', 20),
  msg: sfSvg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>', 20),
  bag: sfSvg('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', 28, 1.8),
  home: sfSvg('<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>', 28, 1.8),
  store: sfDuo('<path d="M6.5 12h19l-1.5 13.2a2 2 0 0 1-2 1.8H10a2 2 0 0 1-2-1.8z" fill="currentColor" fill-opacity=".15"/><path d="M11.5 12v-2a4.5 4.5 0 0 1 9 0v2"/><path d="M12.8 17.2c.6 1.8 1.8 2.7 3.2 2.7s2.6-.9 3.2-2.7"/>'),
  scooter: sfDuo('<rect x="2.5" y="9.5" width="9" height="7.5" rx="1.8" fill="currentColor" fill-opacity=".15"/><path d="M5 13.2h4"/><circle cx="8" cy="23.5" r="3.4" fill="currentColor" fill-opacity=".15"/><circle cx="25" cy="23.5" r="3.4" fill="currentColor" fill-opacity=".15"/><path d="M11.4 23.5H18c.9 0 1.6-.5 1.9-1.3l2.6-7.2h3.3"/><path d="M22.5 15l-.9-4.2h-3.2"/><path d="M13 17.5h6"/>'),
  filter: sfSvg('<path d="M3 5h18M6 12h12M10 19h4"/>'),
  pause: sfSvg('<path d="M8 5v14M16 5v14"/>', 16, 2.6),
  play: sfSvg('<path d="M7 4v16l13-8z"/>', 16, 2),
  close: sfSvg('<path d="M18 6 6 18M6 6l12 12"/>'),
  trash: sfSvg('<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>', 16),
  prev: sfSvg('<path d="m15 18-6-6 6-6"/>', 18, 2.5),
  next: sfSvg('<path d="m9 18 6-6-6-6"/>', 18, 2.5),
  wa: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4Z"/></svg>',
};

/* Número para wa.me (Argentina móvil: 549 + área + número, sin 0 ni 15) */
function waNum(phone) {
  let d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  if (d.startsWith('54')) return d;
  if (d.length === 12) for (const a of [3, 2, 4]) if (d.slice(a, a + 2) === '15') { d = d.slice(0, a) + d.slice(a + 2); break; }
  return '549' + d;
}
/* Texto legible (blanco u oscuro) sobre un color de fondo */
function sfOn(hex) {
  const n = parseInt(hex.slice(1), 16), f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const l = .2126 * f(n >> 16 & 255) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255);
  return 1.05 / (l + .05) >= (l + .05) / .059 ? '#ffffff' : '#0F172A';
}

/* Contraste WCAG entre dos colores #rrggbb (4.5 o más = texto cómodo de leer) */
function sfContrast(a, b) {
  const L = hex => { const n = parseInt(hex.slice(1), 16), f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    return .2126 * f(n >> 16 & 255) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
  const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

/* Cargador de fotos con autorreparación (catálogo, panel, ventas, visor).
   Antes solo se reintentaba cuando el navegador avisaba de un error; pero una foto puede quedarse «cargando» para siempre sin avisar nada
   (servidor dormido en Render, conexión cortada a medias, pedidos en cola). Ahora:
   1) error  -> reintenta con espera creciente (hasta 8 veces) y una marca _r para saltar cualquier respuesta rota en caché;
   2) colgada -> si una foto visible no terminó de bajar a los 25 s (más si ya falló antes), se la vuelve a pedir con la MISMA URL
                 (con muchas fotos en cola no hay que repetir pedidos: eso solo satura más al servidor);
   3) rota    -> queda con la clase sf-broken y un toque sobre ella (o volver a la pestaña / recuperar internet) la reintenta;
   4) solo reintenta fotos que están cerca de la pantalla, así no rompe la carga diferida de las demás. */
(() => {
  if (window.__sfImgRetry) return; window.__sfImgRetry = true;
  const MAX = 8, STALL = 25000, ours = u => /^\/api\/img\//.test(u || '');
  const bust = (u, n) => u.replace(/([?&])_r=\d+&?/, '$1').replace(/[?&]$/, '') + (u.includes('?') ? '&' : '?') + '_r=' + n;
  const failed = new Set(), watch = new Map();             // img -> temporizador de «colgada»
  const near = img => { if (!img.isConnected) return false; const r = img.getBoundingClientRect(); return (r.width || r.height) && r.bottom > -1500 && r.top < innerHeight + 1500 && r.right > -1500 && r.left < innerWidth + 1500; };
  const stop = img => { clearTimeout(watch.get(img)); watch.delete(img); };
  const retry = (img, n, fresh = true) => {
    stop(img);
    if (!img.isConnected) return failed.delete(img);
    img.dataset.rt = n; img.loading = 'eager'; img.classList.remove('sf-broken');
    const base = img.dataset.src0 || img.getAttribute('src');
    img.src = fresh ? bust(base, n) : base; arm(img);          // fresh: salta cualquier respuesta rota en caché (solo después de un error real)
  };
  const arm = img => {
    const src = img.getAttribute('src'); if (!ours(src) && !ours(img.dataset.src0)) return;
    stop(img);
    const n = +(img.dataset.rt || 0);
    watch.set(img, setTimeout(() => {
      watch.delete(img);
      if (!img.isConnected || (img.complete && img.naturalWidth)) return;
      if (!near(img) || document.hidden) return arm(img);   // fuera de pantalla o pestaña en segundo plano: se espera
      if (n >= MAX) { img.classList.add('sf-broken'); failed.add(img); return; }
      img.dataset.src0 = img.dataset.src0 || src; retry(img, n + 1, false);
    }, STALL + n * 4000 + Math.random() * 1500));
  };
  const revive = () => failed.forEach(img => retry(img, 1));
  document.addEventListener('error', e => {
    const img = e.target; if (!(img instanceof HTMLImageElement)) return;
    const src = img.dataset.src0 || img.getAttribute('src') || ''; if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
    img.dataset.src0 = src; stop(img);
    const n = +(img.dataset.rt || 0) + 1; img.dataset.rt = n;
    if (n > MAX) { img.classList.add('sf-broken'); failed.add(img); return; }
    setTimeout(() => navigator.onLine === false ? failed.add(img) : retry(img, n), Math.min(500 * 2 ** (n - 1), 6000) + Math.random() * 400);   // con un poco de azar para que no vuelvan todas juntas
  }, true);
  document.addEventListener('load', e => { const img = e.target; if (!(img instanceof HTMLImageElement)) return; stop(img); if (img.dataset.rt) { delete img.dataset.rt; failed.delete(img); } img.classList.remove('sf-broken'); }, true);
  addEventListener('online', revive); addEventListener('pageshow', revive);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revive(); });
  document.addEventListener('click', e => { const img = e.target instanceof HTMLImageElement ? e.target : e.target.querySelector && e.target.querySelector('img.sf-broken'); if (img && failed.has(img)) retry(img, 1); }, true);
  /* Toda foto nuestra que aparezca (o cambie de src) empieza a ser vigilada */
  const seen = n => { if (n.nodeType !== 1) return; (n.tagName === 'IMG' ? [n] : n.querySelectorAll ? [...n.querySelectorAll('img')] : []).forEach(i => { if (i.getAttribute('src') && !i.complete) arm(i); }); };
  new MutationObserver(ms => ms.forEach(m => m.type === 'attributes' ? (m.target.getAttribute('src') && !m.target.complete && arm(m.target)) : m.addedNodes.forEach(seen)))
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
})();

/* Versión reducida de una foto de producto (/api/img/…): el servidor la achica; así el celular no decodifica fotos enormes. Otras URLs quedan igual. */
/* Miniaturas en lote. Pedir 150 fotos una por una es lento aunque cada una sea chica (150 viajes al servidor). Antes de mostrar una lista de productos
   se traen de a 40 en un solo pedido (GET /api/thumbs) y quedan en memoria: sfThumb(url, 160) las devuelve al instante como data URL.
   Si alguna no llegó, sfThumb cae a la URL normal /api/img/…&w=160, que sigue funcionando sola. */
const THUMB_CACHE = new Map();
const thumbKey = u => { const m = /^\/api\/img\/(\d+)\/0\?v=([0-9a-f]*)/.exec(u || ''); return m ? m[1] + ':' + m[2] : null; };
const sfThumb = (u, w) => {
  if (w === 160) { const k = thumbKey(u); if (k && THUMB_CACHE.has(k)) return THUMB_CACHE.get(k); }
  return /^\/api\/img\//.test(u || '') ? u + (u.includes('?') ? '&' : '?') + 'w=' + w : u;
};
async function prefetchThumbs(products, maxWait = 6000) {
  const keys = [...new Set((products || []).map(p => thumbKey(p.images && p.images[0])).filter(k => k && !THUMB_CACHE.has(k)))].sort();
  if (!keys.length) return;
  const one = async ch => { try { const r = await fetch('/api/thumbs?k=' + ch.join(',')); if (r.ok) Object.entries(await r.json()).forEach(([k, v]) => THUMB_CACHE.set(k, v)); } catch (e) { /* sigue con las URLs normales */ } };
  const jobs = []; for (let i = 0; i < keys.length; i += 40) jobs.push(one(keys.slice(i, i + 40)));
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, maxWait))]);     // nunca deja la pantalla esperando más de maxWait
}
