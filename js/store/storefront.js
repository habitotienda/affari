/* Catálogo · tienda pública y vista previa del editor.
   mountStore(el, { store, products, slug }) -> { update({ store, products }) } */
function mountStore(el, init) {
  let stopPromos = () => {}, paused = false;
  let store = init.store, products = init.products || [], cat = '', flt = { sort: '', min: '', max: '', stock: false }, lb = null, opener = null, drawer = false;
  const info = { name: '', delivery: 'retiro', note: '' };
  const byId = id => products.find(p => p.id === id);
  const cart = sfCart(init.slug ? 'affari:cart:' + init.slug : null, byId);
  const embedded = !!el.closest('.phone');          // en el editor el panel vive dentro del "celular"
  const theme = () => ({ ...SF_DEF, ...(store.theme || {}) });
  const live = () => products.filter(p => p.active !== false);
  const skew = init.serverNow ? init.serverNow - Date.now() : 0, now = () => Date.now() + skew;   // el reloj del visitante puede estar mal: se corrige con el del servidor
  let hoursOpen = false, hoursTimer = 0;

  el.innerHTML = `<div class="sf-shell" data-root><div class="sf-bgfx" data-fx aria-hidden="true"></div>
    <div class="sf"><div data-hero></div>
      <div class="sf-tools"><div class="sf-toprow"><label class="sf-search">${SF_ICON.search}<input data-q type="search" placeholder="Buscar productos…" aria-label="Buscar productos"></label>
        <button type="button" class="sf-filterbtn" data-open-filters aria-expanded="false" aria-controls="sfFilters">${SF_ICON.filter}<span>Filtros</span><b data-fcount hidden>0</b></button>
        <button type="button" class="sf-cartbtn" data-open-cart aria-label="Abrir carrito">${SF_ICON.cart}<span class="sf-badge-n" data-count hidden>0</span></button></div>
        <div class="sf-fpanel" id="sfFilters" data-fpanel hidden>
          <label>Ordenar por<select data-fl="sort"><option value="">Destacados</option><option value="asc">Menor precio</option><option value="desc">Mayor precio</option><option value="az">Nombre (A–Z)</option></select></label>
          <label>Precio mínimo<input data-fl="min" type="number" inputmode="numeric" min="0" placeholder="$ 0"></label>
          <label>Precio máximo<input data-fl="max" type="number" inputmode="numeric" min="0" placeholder="Sin límite"></label>
          <label class="sf-fck"><input data-fl="stock" type="checkbox"><span>Solo disponibles</span></label>
          <button type="button" class="sf-link" data-fclear>Limpiar filtros</button></div>
        <div class="sf-chips" data-chips></div><div class="sf-meta" data-meta aria-live="polite"></div></div>
      <div class="sf-grid" data-list></div><footer class="sf-foot" data-foot></footer><div class="sf-bar" data-bar></div></div>
    <button type="button" class="sf-pausebtn" data-pause hidden></button><div class="sf-layer" data-layer></div></div>`;
  const root = el.querySelector('[data-root]'), layer = el.querySelector('[data-layer]'), q = el.querySelector('[data-q]');
  const $ = s => el.querySelector(s);
  if (embedded) root.dataset.emb = '';

  /* ---------- Piezas de UI ---------- */
  const stepper = (p, n, cls = '') => `<div class="sf-step ${cls}"><button type="button" data-act="dec" data-id="${p.id}" aria-label="Quitar uno de ${sfEsc(p.name)}">−</button><span aria-live="polite">${n}</span><button type="button" data-act="inc" data-id="${p.id}" aria-label="Agregar uno de ${sfEsc(p.name)}" ${n >= p.stock ? 'disabled' : ''}>+</button></div>`;
  const stepHTML = p => p.stock <= 0 ? '' : cart.qty(p.id) ? stepper(p, cart.qty(p.id)) : `<button type="button" class="sf-add" data-act="inc" data-id="${p.id}">${SF_ICON.cart}${sfEsc(theme().addLabel || 'Agregar')}</button>`;
  const card = p => {
    const out = p.stock <= 0;
    return `<article class="sf-card${out ? ' out' : ''}"><div class="sf-gal">${sfGallery(p)}
      ${out ? '<span class="sf-flag out">Agotado</span>' : p.stock <= 3 ? '<span class="sf-flag">Últimas unidades</span>' : ''}</div>
      <div class="sf-info"><h3>${sfEsc(p.name)}</h3>${p.description ? `<p>${sfEsc(p.description)}</p>` : ''}
      <div class="sf-row"><span class="sf-price">${sfArs(p.price)}</span>${out ? '' : `<span class="sf-stock">Stock ${p.stock}</span>`}</div><div data-step="${p.id}">${stepHTML(p)}</div></div></article>`;
  };

  /* Badges de la cabecera. Con horarios activados: «Abierto ahora / Cierra pronto / Cerrado» calculado al momento + horario semanal desplegable.
     Sin horarios: el badge «Abierto» manual del diseño, como antes. */
  const badgesHTML = t => {
    const st = sfOpenStatus(store.hours, now()), open = st ? sfHoursBadge(st) : t.open ? '<span class="sf-badge ok"><i></i>Abierto</span>' : '';
    if (!open && !t.delivery) return '';
    return `<div class="sf-badges">${open}${t.delivery ? '<span class="sf-badge">🛵 Envíos en el día</span>' : ''}</div>`
      + (st ? `<div class="sf-hours" id="sfHours" data-hours-panel${hoursOpen ? '' : ' hidden'}>${sfHoursTable(store.hours, now())}</div>` : '');
  };
  /* Cada 30 s se recalcula solo el badge (sin redibujar la cabecera ni reiniciar los banners) */
  const tickHours = () => {
    if (!el.isConnected) return clearInterval(hoursTimer);
    const st = sfOpenStatus(store.hours, now()), b = $('[data-hours-toggle]'); if (!st || !b) return;
    const box = document.createElement('div'); box.innerHTML = sfHoursBadge(st); const nb = box.firstElementChild;
    if (nb.className !== b.className || nb.textContent !== b.textContent) { nb.setAttribute('aria-expanded', String(hoursOpen)); b.replaceWith(nb); }
    const pn = $('[data-hours-panel]'); if (pn) pn.innerHTML = sfHoursTable(store.hours, now());
  };
  const drawHero = () => {
    const t = theme(), name = t.title || store.name;
    root.style.cssText = `--bg:${t.bg};--ac:${t.accent};--tx:${t.text};--on:${sfOn(t.accent)};--font:${SF_FONTS[t.font] || SF_FONTS.modern}`
      + (t.headColor ? `;--hd:${t.headColor}` : '') + (t.priceColor ? `;--pr:${t.priceColor}` : '') + (t.cardColor ? `;--card:${t.cardColor}` : '');
    Object.assign(root.dataset, { radius: t.radius, cols: t.cols, cardstyle: t.cardStyle, logo: t.logoShape, align: t.heroAlign });
    sfFx($('[data-fx]'), t);
    const pz = $('[data-pause]'), anim = !!t.patAnimate && t.pattern !== 'none' && t.pattern !== 'grain';
    pz.hidden = !anim; pz.innerHTML = paused ? `${SF_ICON.play}Reanudar fondo` : `${SF_ICON.pause}Pausar fondo`; $('[data-fx]').classList.toggle('paused', paused);
    $('[data-foot]').textContent = t.footer || '';
    root.classList.toggle('has-cover', !!t.coverImg);
    $('[data-hero]').innerHTML = `<header class="sf-hero${t.coverImg ? ' cover' : ''}"${t.coverImg ? ` style="--cdim:${(t.coverDim ?? 30) / 100}"` : ''}>${t.coverImg ? '<img class="sf-cover" alt="" decoding="async">' : ''}<div class="sf-hin"><div class="sf-brand">${store.logo ? `<img class="sf-logo" src="${sfEsc(store.logo)}" alt="Logo de ${sfEsc(store.name)}">` : `<div class="sf-logo ph">${sfEsc((name[0] || 'A').toUpperCase())}</div>`}
      <div class="sf-id"><h1>${sfEsc(name)}</h1><p class="sf-cat">${sfEsc(store.type || '')}</p></div></div>
      ${t.description ? `<p class="sf-desc">${sfEsc(t.description)}</p>` : ''}
      ${badgesHTML(t)}</div></header>
      ${t.banner ? `<div class="sf-banner">${sfEsc(t.banner)}</div>` : ''}${sfPromos(t.promos)}`;
    if (t.coverImg) $('.sf-cover').src = t.coverImg;
    const hb = $('[data-hours-toggle]'); if (hb) hb.setAttribute('aria-expanded', String(hoursOpen));
    stopPromos(); const pb = $('[data-promos]'); if (pb) stopPromos = sfPromosInit(pb);
  };
  const drawChips = () => {
    const cats = [...new Set(live().map(p => p.category).filter(Boolean))];
    if (cat && !cats.includes(cat)) cat = '';
    $('[data-chips]').innerHTML = cats.length ? ['', ...cats].map(c => `<button type="button" class="sf-chip${c === cat ? ' on' : ''}" data-chip="${sfEsc(c)}">${c ? sfEsc(c) : 'Todos'}</button>`).join('') : '';
  };
  const nf = () => (flt.sort ? 1 : 0) + (flt.min !== '' ? 1 : 0) + (flt.max !== '' ? 1 : 0) + (flt.stock ? 1 : 0);
  const drawList = () => {
    const term = q.value.trim().toLowerCase(), mn = flt.min === '' ? 0 : +flt.min, mx = flt.max === '' ? Infinity : +flt.max;
    let items = live().filter(p => (!cat || p.category === cat) && (p.name + ' ' + (p.description || '') + ' ' + (p.category || '')).toLowerCase().includes(term)
      && p.price >= mn && p.price <= mx && (!flt.stock || p.stock > 0));
    if (flt.sort === 'asc') items = [...items].sort((a, b) => a.price - b.price); else if (flt.sort === 'desc') items = [...items].sort((a, b) => b.price - a.price);
    else if (flt.sort === 'az') items = [...items].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const n = nf(), fc = $('[data-fcount]'); fc.hidden = !n; fc.textContent = n;
    $('[data-meta]').textContent = items.length ? `${items.length} ${items.length === 1 ? 'producto' : 'productos'}${cat ? ' en ' + cat : ''}` : '';
    $('[data-list]').innerHTML = items.length ? items.map(card).join('') : `<div class="sf-empty">No hay productos para mostrar.${n || term || cat ? '<br><button type="button" class="sf-link" data-reset>Quitar filtros y búsqueda</button>' : ''}</div>`;
  };

  /* Barra flotante + insignia del botón del carrito */
  const drawBar = () => {
    const t = cart.totals(), b = $('[data-count]');
    b.hidden = !t.count; b.textContent = t.count;
    $('[data-bar]').innerHTML = t.count ? `<button type="button" class="sf-cart" data-open-cart><span class="sf-cart-l">${SF_ICON.cart}<span><small>${t.count} ${t.count === 1 ? 'producto' : 'productos'}</small><strong>${sfArs(t.total)}</strong></span></span><span class="sf-cart-go">Ver pedido</span></button>` : '';
  };

  /* ---------- Panel lateral del carrito ---------- */
  const line = ({ p, n, sub }) => `<div class="sf-line"><div class="sf-lth">${p.images && p.images[0] ? `<img src="${sfEsc(p.images[0])}" alt="">` : sfEsc((p.name[0] || '?').toUpperCase())}</div>
    <div class="sf-lbody"><strong>${sfEsc(p.name)}</strong><small>${sfArs(p.price)} c/u${n >= p.stock ? ' · máximo disponible' : ''}</small>${stepper(p, n, 'sm')}</div>
    <div class="sf-lside"><b>${sfArs(sub)}</b><button type="button" class="sf-rm" data-rm="${p.id}" aria-label="Quitar ${sfEsc(p.name)} del pedido">${SF_ICON.trash}</button></div></div>`;
  const drawLines = () => {
    if (!drawer) return;
    const t = cart.totals(), ph = waNum(store.phone), has = t.count > 0;
    layer.querySelector('[data-lines]').innerHTML = has ? t.lines.map(line).join('') : `<div class="sf-nolines">${SF_ICON.cart}<p>Tu pedido está vacío.<br>Sumá productos desde el catálogo.</p></div>`;
    layer.querySelector('[data-sum]').innerHTML = has ? `<div><span>Productos (${t.count})</span><span>${sfArs(t.total)}</span></div>
      ${info.delivery === 'envio' ? '<div><span>Envío</span><span>A coordinar</span></div>' : ''}<div class="tot"><span>Total</span><strong>${sfArs(t.total)}</strong></div>` : '';
    const send = layer.querySelector('[data-send]'); send.disabled = !has || !ph;
    layer.querySelector('[data-hint]').textContent = !ph ? 'Este comercio todavía no cargó su número de WhatsApp.' : '';
    layer.querySelector('[data-clear]').hidden = !has;
  };
  const openDrawer = () => {
    if (drawer) return; drawer = true; opener = document.activeElement; const t = theme();
    layer.insertAdjacentHTML('afterbegin', `<div class="sf-scrim" data-close-drawer></div>
      <aside class="sf-drawer" role="dialog" aria-modal="true" aria-label="Tu pedido">
        <header class="sf-dh"><h2>Tu pedido</h2><button type="button" class="sf-link" data-clear hidden>Vaciar</button><button type="button" class="sf-x" data-close-drawer aria-label="Cerrar carrito">${SF_ICON.close}</button></header>
        <div class="sf-lines" data-lines></div>
        <footer class="sf-df"><div class="sf-form"><input data-f="name" maxlength="60" placeholder="Tu nombre (opcional)" value="${sfEsc(info.name)}" aria-label="Tu nombre" autocomplete="name">
          ${t.delivery ? `<div class="sf-deliv" role="radiogroup" aria-label="Entrega"><label><input type="radio" name="sfdel" value="retiro" ${info.delivery === 'retiro' ? 'checked' : ''}><span>Retiro</span></label><label><input type="radio" name="sfdel" value="envio" ${info.delivery === 'envio' ? 'checked' : ''}><span>Envío</span></label></div>` : ''}
          <textarea data-f="note" rows="2" maxlength="200" placeholder="Aclaraciones (talle, horario, dirección…)" aria-label="Aclaraciones">${sfEsc(info.note)}</textarea></div>
          <div class="sf-sum" data-sum></div>
          <button type="button" class="sf-wa big" data-send>${SF_ICON.wa}Enviar pedido por WhatsApp</button><p class="sf-hint" data-hint></p></footer></aside>`);
    if (!t.delivery) info.delivery = 'retiro';
    if (!embedded) document.body.style.overflow = 'hidden';
    drawLines(); layer.querySelector('.sf-drawer .sf-x').focus();
  };
  const closeDrawer = () => {
    if (!drawer) return; drawer = false;
    layer.querySelector('.sf-scrim')?.remove(); layer.querySelector('.sf-drawer')?.remove();
    if (!lb && !embedded) document.body.style.overflow = '';
    if (opener && opener.focus && opener.isConnected) opener.focus();
  };
  const openLightbox = (p, i) => {
    if (lb || !(p.images || []).length) return; opener = opener || document.activeElement;
    lb = sfLightbox(p, i); layer.appendChild(lb.el); if (!embedded) document.body.style.overflow = 'hidden'; lb.el.querySelector('[data-close]').focus();
  };
  const closeLightbox = () => { if (!lb) return; lb.el.remove(); lb = null; if (!drawer && !embedded) document.body.style.overflow = ''; };

  const send = () => {
    const t = cart.totals(), ph = waNum(store.phone); if (!t.count || !ph) return;
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(sfOrderMessage(store, t, info))}`, '_blank', 'noopener');
  };

  /* ---------- Reactividad: cualquier cambio del carrito actualiza todo en tiempo real ---------- */
  cart.subscribe(() => {
    el.querySelectorAll('[data-step]').forEach(s => { const p = byId(+s.dataset.step); if (p) s.innerHTML = stepHTML(p); });
    drawBar(); drawLines();
  });
  const drawAll = () => { cart.prune(); drawHero(); drawChips(); drawList(); drawBar(); drawLines(); };

  /* ---------- Eventos ---------- */
  el.addEventListener('click', e => {
    const T = e.target, a = T.closest('[data-act]'), rm = T.closest('[data-rm]'), ch = T.closest('[data-chip]');
    if (a) return cart.add(+a.dataset.id, a.dataset.act === 'inc' ? 1 : -1);
    if (rm) return cart.remove(+rm.dataset.rm);
    const hb = T.closest('[data-hours-toggle]');
    if (hb) { hoursOpen = !hoursOpen; const pn = $('[data-hours-panel]'); if (pn) pn.hidden = !hoursOpen; return hb.setAttribute('aria-expanded', String(hoursOpen)); }
    if (T.closest('[data-pause]')) { paused = !paused; return drawHero(); }
    if (T.closest('[data-clear]')) return cart.clear();
    const fb = T.closest('[data-open-filters]');
    if (fb) { const pn = $('[data-fpanel]'); pn.hidden = !pn.hidden; return fb.setAttribute('aria-expanded', String(!pn.hidden)); }
    if (T.closest('[data-fclear],[data-reset]')) { flt = { sort: '', min: '', max: '', stock: false }; cat = ''; q.value = ''; el.querySelectorAll('[data-fl]').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; }); drawChips(); return drawList(); }
    if (T.closest('[data-open-cart]')) return openDrawer();
    if (T.closest('[data-send]')) return send();
    if (T.closest('.sf-lb')) { if (T.closest('[data-close]') || T.classList.contains('sf-lb')) closeLightbox(); return; }
    if (T.closest('[data-close-drawer]')) return closeDrawer();
    if (sfGalleryClick(e)) return;
    const z = T.closest('[data-zoom]');
    if (z) { const p = byId(+z.dataset.zoom); if (p) openLightbox(p, Math.round(z.scrollLeft / z.clientWidth)); return; }
    if (ch) { cat = ch.dataset.chip; drawChips(); drawList(); }
  });
  el.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.f; if (f) info[f] = e.target.value;
    const fl = e.target.dataset && e.target.dataset.fl; if (fl) { flt[fl] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; drawList(); }
  });
  el.addEventListener('change', e => { if (e.target.name === 'sfdel') { info.delivery = e.target.value; drawLines(); } });
  el.addEventListener('scroll', sfGalleryScroll, true);
  document.addEventListener('keydown', e => {
    if (!el.isConnected || (!drawer && !lb)) return;
    if (e.key === 'Escape') return lb ? closeLightbox() : closeDrawer();
    if (lb) lb.key(e);
    if (e.key === 'Tab') {   // el foco no se escapa del diálogo abierto
      const box = lb ? lb.el : layer.querySelector('.sf-drawer'), f = [...box.querySelectorAll('button:not([disabled]),input,textarea,[href]')].filter(x => !x.hidden && x.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  q.oninput = drawList; drawAll(); hoursTimer = setInterval(tickHours, 30000);

  return { update(next) { if (next.store) store = next.store; if (next.products) products = next.products; drawAll(); } };
}
