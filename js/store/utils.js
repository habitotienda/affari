/* Catálogo · utilidades compartidas (panel + página pública /c/<slug>) */
const sfEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sfArs = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const SF_DEF = { bg: '#F8FAFC', accent: '#10B981', text: '#0F172A', title: '', description: '', banner: '', font: 'modern', radius: 'round', cols: 2, open: true, delivery: false,
  pattern: 'none', patColor: '', patOpacity: 24, patAnimate: true, patSpeed: 2, headColor: '', priceColor: '', cardColor: '',
  cardStyle: 'solid', logoShape: 'rounded', heroAlign: 'left', addLabel: 'Agregar', footer: '',
  /* Imágenes propias (p. ej. hechas en Canva). Vacío = sin imagen. */
  bgImg: '', bgImgMode: 'cover', bgImgDim: 35, coverImg: '', coverDim: 30, promos: [] };
const SF_FONTS = { modern: '"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif', classic: 'Georgia,"Times New Roman",serif', tech: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace' };

const sfSvg = (d, s = 18, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
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
