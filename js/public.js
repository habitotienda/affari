/* Página pública del catálogo: /c/<slug> */
(async () => {
  const root = document.getElementById('root'), slug = location.pathname.split('/')[2] || '';
  try {
    const res = await fetch('/api/public/' + encodeURIComponent(slug));
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'No pudimos cargar el catálogo.');
    document.title = data.store.name + ' · Catálogo';
    document.body.style.background = (data.store.theme || {}).bg || '';
    mountStore(root, { ...data, slug, serverNow: data.server_now });
  } catch (e) { root.innerHTML = `<div class="empty">${sfEsc(e.message)}</div>`; }
})();
