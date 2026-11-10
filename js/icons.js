/* Catálogo de íconos SVG inline (stroke 1.75, viewBox 24). Uso: icon('cash', 18) */
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 19.5V4.5M9 7h7"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a17 17 0 0 1 4.1-4.9M9.9 5.2A9 9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M1 1l22 22"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shop: '<path d="M4 9h16l-1 11H5z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  whatsapp: '<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'
};
function icon(name, size = 18) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}
const LOGO_SVG = `<svg class="logo-mark" viewBox="0 0 40 40" fill="none" role="img" aria-label="Affari"><defs><mask id="affari-m" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40"><rect width="40" height="40" fill="#fff"/><path d="M20.00 28.60L29.40 18.40" stroke="#000" stroke-width="5" stroke-linecap="butt"/><path d="M32.52 15.02L31.83 20.64L26.97 16.16Z" fill="#000" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/></mask></defs><path d="M9.50 30.80L15.80 24.60L20.00 28.60L29.40 18.40" stroke="#10B981" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 36 20 4.5 36 36H30.6L20 15.1 9.4 36Z" fill="#0F172A" stroke="#0F172A" stroke-width="0.8" stroke-linejoin="round" mask="url(#affari-m)"/><path d="M20.00 28.60L29.40 18.40" stroke="#10B981" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M32.52 15.02L31.83 20.64L26.97 16.16Z" fill="#10B981" stroke="#10B981" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
Object.assign(ICON_PATHS, {
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trend: '<path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l4 3v4h-8"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  scale: '<path d="M12 3v18M6 21h12M5 7h14"/><path d="m5 7-3 7a3.2 3.2 0 0 0 6 0zM19 7l-3 7a3.2 3.2 0 0 0 6 0z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>'
});
Object.assign(ICON_PATHS, {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  clip: '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
});

Object.assign(ICON_PATHS, {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 9"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
});

Object.assign(ICON_PATHS, {
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'
});
