/* Catálogo · galería de producto (hasta 5 fotos): slider con scroll-snap, flechas y miniaturas */
const SF_MAX_IMG = 5;

/* Ancho de las miniaturas de la grilla (el servidor solo ofrece 160/320/640): 320 px alcanza en celular de pantalla normal con 2 columnas;
   640 px en compu, en pantallas retina (DPR > 2) y en la vista de 1 columna. La foto COMPLETA nunca se pide desde la grilla. */
const sfGridW = (oneCol) => (!oneCol && innerWidth < 700 && (window.devicePixelRatio || 1) <= 2) ? 320 : 640;
/* Foto completa (la que se guardó): la misma URL sin el ancho. Solo se usa al abrir el detalle o el visor. */
const sfFull = u => /^\/api\/img\//.test(u || '') ? u.replace(/([?&])(w|_r|_g)=\d+&?/g, '$1').replace(/[?&]$/, '') : u;
/* Cambia el ancho de las miniaturas ya dibujadas (p. ej. al pasar a la vista de 1 columna) sin volver a dibujar la lista ni perder la tanda */
function sfRewidth(root, w) {
  root.querySelectorAll('.sf-slides img').forEach(im => ['src', 'data-first', 'data-src'].forEach(a => {
    const v = im.getAttribute(a); if (v && /^\/api\/img\/.*[?&]w=\d+/.test(v) && !v.includes('w=' + w)) { im.setAttribute(a, v.replace(/w=\d+/, 'w=' + w)); if (a === 'src') im.dataset.src0 = im.getAttribute('src'); }
  }));
}

function sfGallery(p, w = 640) {
  const imgs = (p.images || []).slice(0, SF_MAX_IMG);
  if (!imgs.length) return `<div class="sf-noimg">${sfEsc((p.name[0] || '?').toUpperCase())}</div>`;
  const many = imgs.length > 1;
  /* Solo la primera foto se descarga al dibujar la tarjeta. Las demás (y las miniaturas) esperan a que el visitante toque
     o pase el mouse por la galería (sfHydrate). Con 150 productos × 5 fotos, bajarlas todas llenaba la memoria del celular y lo congelaba. */
  return `<div class="sf-slides" data-zoom="${p.id}" tabindex="0" role="group" aria-label="Fotos de ${sfEsc(p.name)}">${imgs.map((s, i) =>
      `<img ${i ? 'data-src' : 'data-first'}="${sfEsc(sfThumb(s, w))}" alt="${sfEsc(p.name)} (foto ${i + 1} de ${imgs.length})" decoding="async">`).join('')}</div>`
    + (many ? `<button type="button" class="sf-arrow l" data-slide="-1" aria-label="Foto anterior">${SF_ICON.prev}</button><button type="button" class="sf-arrow r" data-slide="1" aria-label="Foto siguiente">${SF_ICON.next}</button>
      <div class="sf-thumbs">${imgs.map((s, i) => `<button type="button" data-th="${i}" class="${i ? '' : 'on'}" aria-label="Ver foto ${i + 1}"><img data-src="${sfEsc(sfThumb(s, 160))}" alt="" decoding="async"></button>`).join('')}</div>` : '');
}

/* Foto principal de cada tarjeta: se descarga cuando la tarjeta está a menos de ~600 px de la pantalla (lo de más abajo espera hasta que el visitante se acerca) (no con el loading="lazy" nativo,
   que con scroll rápido y content-visibility llega tarde y deja las fotos en blanco). (Los reintentos por error ya los maneja utils.js). */
function sfFirstLoad(card) {
  card.querySelectorAll('img[data-first]').forEach(im => {
    im.src = im.dataset.first; im.removeAttribute('data-first');
  });
}
function sfLazyCards(cards, root) {
  cards = [...cards];
  if (!('IntersectionObserver' in window)) { cards.forEach(sfFirstLoad); return null; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { sfFirstLoad(e.target); io.unobserve(e.target); } }), { root: root || null, rootMargin: '600px 0px' });
  cards.forEach(c => io.observe(c));
  return io;
}

/* Descarga las fotos pendientes de una galería (una sola vez) */
function sfHydrate(gal) {
  if (!gal || gal.dataset.h) return; gal.dataset.h = '1';
  const c = gal.closest('.sf-card'); if (c) sfFirstLoad(c);
  gal.querySelectorAll('img[data-src]').forEach(im => { im.src = im.dataset.src; im.removeAttribute('data-src'); });
}

/* Clicks dentro de una galería. Devuelve true si lo manejó. */
function sfGalleryClick(e) {
  const gal = e.target.closest('.sf-gal'); if (!gal) return false; sfHydrate(gal);
  const sl = gal.querySelector('.sf-slides'); if (!sl) return false;
  const th = e.target.closest('[data-th]'), ar = e.target.closest('[data-slide]');
  if (!th && !ar) return false;
  const n = sl.children.length, cur = Math.round(sl.scrollLeft / sl.clientWidth);
  const to = th ? +th.dataset.th : (cur + +ar.dataset.slide + n) % n;
  sl.scrollTo({ left: to * sl.clientWidth, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
  return true;
}
/* Mantiene la miniatura activa sincronizada con el scroll */
function sfGalleryScroll(e) {
  if (!e.target.classList || !e.target.classList.contains('sf-slides')) return;
  const i = Math.round(e.target.scrollLeft / e.target.clientWidth);
  e.target.closest('.sf-gal').querySelectorAll('[data-th]').forEach((b, k) => b.classList.toggle('on', k === i));
}

/* Visor ampliado: devuelve { el, key(e) } para que la tienda lo monte en su capa */
function sfLightbox(p, start = 0) {
  const imgs = (p.images || []).slice(0, SF_MAX_IMG); let i = Math.min(start, imgs.length - 1);
  const el = document.createElement('div'); el.className = 'sf-lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', p.name);
  const draw = () => {
    el.innerHTML = `<button type="button" class="sf-x" data-close aria-label="Cerrar">${SF_ICON.close}</button>
      <div class="sf-lb-main">${imgs.length > 1 ? `<button type="button" class="sf-arrow l" data-lb="-1" aria-label="Anterior">${SF_ICON.prev}</button>` : ''}
      <div class="sf-lb-stage"><img src="${sfEsc(imgs[i])}" alt="${sfEsc(p.name)} (foto ${i + 1} de ${imgs.length})" decoding="async"></div>
      ${imgs.length > 1 ? `<button type="button" class="sf-arrow r" data-lb="1" aria-label="Siguiente">${SF_ICON.next}</button>` : ''}</div>
      <div class="sf-lb-cap"><strong>${sfEsc(p.name)}</strong><span>${sfArs(p.price)}</span></div>`;
  };
  const go = d => { i = (i + d + imgs.length) % imgs.length; draw(); };
  el.addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (b) go(+b.dataset.lb); });
  /* Deslizar con el dedo para pasar de foto */
  let sx = null, sy = 0;
  el.addEventListener('touchstart', e => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sx == null || imgs.length < 2) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });
  draw();
  return { el, key: e => { if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); } };
}

/* Banners promocionales (imágenes del comercio, p. ej. hechas en Canva): carrusel horizontal con puntos y avance automático.
   Devuelve el HTML; sfPromosInit(box) lo activa. Con una sola imagen se muestra fija. */
const SF_MAX_PROMOS = 5;
function sfPromos(list) {
  const imgs = (list || []).filter(Boolean).slice(0, SF_MAX_PROMOS); if (!imgs.length) return '';
  return `<section class="sf-promos" aria-label="Promociones" data-promos><div class="sf-ptrack" tabindex="0">${imgs.map((s, i) =>
      `<img src="${sfEsc(s)}" alt="Promoción ${i + 1} de ${imgs.length}" decoding="async" ${i ? 'loading="lazy"' : ''}>`).join('')}</div>`
    + (imgs.length > 1 ? `<div class="sf-pdots">${imgs.map((_, i) => `<button type="button" data-pd="${i}" class="${i ? '' : 'on'}" aria-label="Ver promoción ${i + 1}"></button>`).join('')}</div>` : '') + '</section>';
}
function sfPromosInit(box) {
  const tr = box.querySelector('.sf-ptrack'), dots = [...box.querySelectorAll('[data-pd]')];
  if (!tr || dots.length < 2) return () => {};
  const still = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
  const go = i => tr.scrollTo({ left: i * tr.clientWidth, behavior: still() ? 'auto' : 'smooth' });
  const cur = () => Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth));
  let hold = false;
  tr.addEventListener('scroll', () => dots.forEach((d, k) => d.classList.toggle('on', k === cur())), { passive: true });
  box.addEventListener('click', e => { const d = e.target.closest('[data-pd]'); if (d) go(+d.dataset.pd); });
  ['pointerenter', 'focusin', 'touchstart'].forEach(ev => box.addEventListener(ev, () => { hold = true; }, { passive: true }));
  ['pointerleave', 'focusout', 'touchend'].forEach(ev => box.addEventListener(ev, () => { hold = false; }, { passive: true }));
  const t = setInterval(() => { if (!box.isConnected) return clearInterval(t); if (!hold && !still() && !document.hidden) go((cur() + 1) % dots.length); }, 5000);
  return () => clearInterval(t);
}
