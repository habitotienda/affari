/* Página pública del catálogo: /c/<slug>
   - Si el servidor está despertando (Render gratis se duerme) reintenta solo, con aviso, en vez de mostrar un error.
   - Guarda la última versión del catálogo en el navegador: al volver se ve al instante y se actualiza de fondo. */
(async () => {
  const root = document.getElementById('root'), slug = location.pathname.split('/')[2] || '', KEY = 'affari:pub:' + slug;
  let mounted = null;
  const show = data => {
    document.title = data.store.name + ' · Catálogo';
    document.body.style.background = (data.store.theme || {}).bg || '';
    if (mounted) mounted.update({ store: data.store, products: data.products });
    else mounted = mountStore(root, { ...data, slug, serverNow: data.server_now });
  };
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.store && c.products) show(c); } catch {}

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const notice = msg => { if (mounted) return; let n = root.querySelector('.sf-wake'); if (!n) { n = document.createElement('p'); n.className = 'sf-wake'; root.appendChild(n); } n.textContent = msg; };
  let lastErr = 'No pudimos cargar el catálogo.';
  for (let i = 0; i < 7; i++) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
    try {
      const res = await fetch('/api/public/' + encodeURIComponent(slug), { signal: ctl.signal }); clearTimeout(to);
      let data = null; try { data = await res.json(); } catch {}
      if (res.ok && data) { show(data); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} return; }
      if (res.status === 404 || res.status === 403) {            // el catálogo no existe o está apagado: no tiene sentido reintentar
        try { localStorage.removeItem(KEY); } catch {}
        if (mounted) root.innerHTML = '';
        root.innerHTML = `<div class="empty">${sfEsc((data && data.detail) || 'Este catálogo no está disponible.')}</div>`; return;
      }
      lastErr = (data && data.detail) || lastErr;
    } catch { clearTimeout(to); }
    if (mounted) return;                                          // ya se ve la copia guardada: se actualizará la próxima vez
    notice(i < 1 ? 'Cargando el catálogo…' : 'El servidor se está despertando, esto puede tardar unos segundos…');
    await wait(Math.min(1500 * 2 ** i, 10000));
  }
  if (!mounted) root.innerHTML = `<div class="empty">${sfEsc(lastErr)}<br><br><button class="btn btn-primary" onclick="location.reload()">Reintentar</button></div>`;
})();
