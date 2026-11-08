/* ==========================================================================
   Affari · Estudio de Diseño — FASE 3 · productos del inventario
   Panel «Productos»:
     · Un producto  → «Agregar a la placa» (foto + nombre + precio + descripción ya acomodados)
                      o «Completar la plantilla» (reemplaza «Nombre del producto» / «$9.999» del diseño actual).
     · Varios       → «Catálogo» (cuadrícula de tarjetas) o «Lista de precios», armados a medida del formato.
   Usa el inventario real: GET /api/products (las fotos vienen como URL, mismo origen → se pueden exportar).
   Requiere studio.js y studio-tools.js (Studio.kit).
   ========================================================================== */
(() => {
  'use strict';
  const Studio = window.Studio; if (!Studio || !Studio.kit.text) return;
  const kit = Studio.kit, F = () => window.fabric;
  const getApi = (path) => window.api(path);                       // `api` global (auth.js); dentro de render() el nombre queda tapado

  Object.assign(ICON_PATHS, {
    search:  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  });

  const ACCENT = '#10B981', MAX_MULTI = 8;
  const FONT = 'Plus Jakarta Sans';

  /* -------------------------------------------------------------- helpers */
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => { n = Number(n) || 0; return '$' + new Intl.NumberFormat('es-AR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n); };
  const unit = (W, H) => Math.min(W, H) / 1080;
  const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1; const n = parseInt(m[1], 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const warm = () => Promise.all([400, 600, 700, 800].map(w => kit.ensureFont(FONT, w)));
  const loadImg = (url) => new Promise((ok, fail) => F().Image.fromURL(url, (img) => (img && img.width ? ok(img) : fail(new Error('img'))), { crossOrigin: 'anonymous' }));

  /* Colores de texto según el fondo actual (claro → oscuro, oscuro → blanco) */
  const ink = () => {
    const b = kit.bg || {}, c = b.type === 'solid' ? b.color : b.type === 'grad' ? b.a : '#FFFFFF';
    return lum(c) > 0.55 ? { main: '#0F172A', soft: '#475569' } : { main: '#FFFFFF', soft: '#CBD5E1' };
  };
  const T = (str, o) => kit.text(str, o);
  /* Pie de las placas: usa el negocio y el teléfono del usuario si los cargó en Configuración */
  const contactLine = () => { try { const u = state.user || {}; return (u.business || u.name || 'Tu negocio') + ' · WhatsApp ' + (u.phone || '000 000-0000'); } catch (_) { return 'Tu negocio · WhatsApp 000 000-0000'; } };

  /* Si el nombre es largo, lo acorta por palabras hasta que entre en `maxH` px */
  function fitLines(t, maxH) {
    const words = String(t.text).split(' ');
    while (words.length > 1 && t.height * (t.scaleY || 1) > maxH) { words.pop(); t.set('text', words.join(' ').replace(/[.,;:\-\s]+$/, '') + '…'); }
    return t;
  }

  const confirmReplace = (fc) => !fc.getObjects().length || window.confirm('Esto reemplaza todo lo que hay en el lienzo. ¿Continuar?');
  function resetCanvas(api, bg) {
    const fc = api.canvas();
    fc.getObjects().slice().forEach(o => fc.remove(o)); fc.discardActiveObject();
    kit.applyBg(api, bg);
  }
  const finish = (api, msg) => { const fc = api.canvas(); fc.discardActiveObject(); fc.requestRenderAll(); if (api.mode() === 'mobile') api.closeSheet(); api.toast(msg); };

  /* ==================================================== UN PRODUCTO → LIENZO */
  async function addToCanvas(api, p, o) {
    const fc = api.canvas(); if (!fc) return;
    await warm();
    const { w: W, h: H } = api.size(), u = unit(W, H), c = ink(), parts = [];
    const url = p.images && p.images[o.photoIdx || 0];
    if (o.photo && url) {
      try {
        const img = await loadImg(url), s = Math.min(W * 0.62 / img.width, H * 0.40 / img.height);
        img.set({ originX: 'center', originY: 'center', scaleX: s, scaleY: s, name: 'Foto' }); parts.push(img);
      } catch (_) { api.toast('No se pudo cargar la foto de ese producto.'); }
    }
    if (o.name)  parts.push(fitLines(T(p.name, { fontSize: 84 * u, width: W * 0.84, fill: c.main, name: 'Nombre' }), H * 0.2));
    if (o.desc && p.description) parts.push(fitLines(T(clip(p.description, 140), { fontSize: 42 * u, fontWeight: 400, width: W * 0.8, fill: c.soft, name: 'Descripción' }), H * 0.16));
    if (o.price) parts.push(T(money(p.price), { fontSize: 200 * u, width: W * 0.9, fill: ACCENT, name: 'Precio' }));
    if (!parts.length) return api.toast('Activá al menos una opción (Foto, Nombre, Precio…).');

    const gap = H * 0.025, avail = H * 0.92;
    const sum = () => parts.reduce((s, x) => s + x.getScaledHeight(), 0) + gap * (parts.length - 1);
    if (sum() > avail) { const k = (avail - gap * (parts.length - 1)) / (sum() - gap * (parts.length - 1)); parts.forEach(x => x.scale(x.scaleX * k)); }
    let y = (H - sum()) / 2;
    parts.forEach(x => { const hh = x.getScaledHeight(); x.set({ left: W / 2, top: y + hh / 2 }); x.setCoords(); fc.add(x); y += hh + gap; });
    finish(api, 'Producto agregado a la placa');
  }

  /* ================================================ COMPLETAR LA PLANTILLA */
  const NAME_RE = /^(nombre del producto|t[ií]tulo de tu placa|producto (uno|dos|tres|cuatro|cinco))$/i;
  const PRICE_PH = /^\$\s*(9\.999|0\.000)$/, PRICE_ANY = /^\$\s*[\d.,]+$/;
  const DESC_RE = /descripci[oó]n/i;

  async function fillTemplate(api, p, o) {
    const fc = api.canvas(); if (!fc) return;
    const items = [];
    fc.getObjects().forEach(ob => {
      if (/text/.test(ob.type)) items.push({ t: ob, host: ob });
      else if (ob.type === 'group') ob.getObjects().forEach(ch => { if (/text/.test(ch.type)) items.push({ t: ch, host: ob }); });
    });
    const size = ({ t, host }) => (t.fontSize || 0) * (t.scaleY || 1) * (host !== t ? (host.scaleY || 1) : 1);
    const top = ({ host }) => host.top || 0;
    const biggest = (arr) => arr.slice().sort((a, b) => size(b) - size(a) || top(a) - top(b))[0];
    const firstDown = (arr) => arr.slice().sort((a, b) => top(a) - top(b))[0];
    const txt = (x) => String(x.t.text || '').trim();

    const set = ({ t, host }, v) => { t.set('text', v); t.dirty = true; host.dirty = true; if (t.initDimensions) t.initDimensions(); host.setCoords && host.setCoords(); };
    let n = 0;
    if (o.name) { const tg = firstDown(items.filter(x => NAME_RE.test(txt(x)))); if (tg) { set(tg, p.name); n++; } }
    if (o.price) {
      const ph = items.filter(x => PRICE_PH.test(txt(x)) && !x.t.linethrough);
      const tg = ph.length ? (ph.length > 1 ? firstDown(ph) : ph[0]) : biggest(items.filter(x => PRICE_ANY.test(txt(x)) && !x.t.linethrough));
      if (tg) { set(tg, money(p.price)); n++; }
    }
    if (o.desc && p.description) { const tg = firstDown(items.filter(x => DESC_RE.test(txt(x)))); if (tg) { set(tg, clip(p.description, 140)); n++; } }

    let photo = false;
    const url = p.images && p.images[o.photoIdx || 0];
    if (o.photo && url) {
      try {
        const { w: W, h: H } = api.size(), img = await loadImg(url), s = Math.min(W * 0.4 / img.width, H * 0.4 / img.height);
        img.set({ originX: 'center', originY: 'center', left: W / 2, top: H / 2, scaleX: s, scaleY: s, name: 'Foto' });
        fc.add(img); fc.setActiveObject(img); photo = true;
      } catch (_) { api.toast('No se pudo cargar la foto de ese producto.'); }
    }
    fc.requestRenderAll(); fc.fire('object:modified', { target: fc.getActiveObject() || items[0] && items[0].host });
    if (!n && !photo) return api.toast('No encontré textos de producto para completar. Probá «Agregar a la placa».');
    if (api.mode() === 'mobile') api.closeSheet();
    api.toast(photo ? 'Listo. Movela y ajustá el tamaño de la foto.' : 'Plantilla completada');
  }

  /* =================================================== VARIOS → CATÁLOGO */
  async function buildCatalog(api, list) {
    const fc = api.canvas(); if (!fc || !list.length) return;
    if (!confirmReplace(fc)) return;
    await warm();
    const { w: W, h: H } = api.size(), u = unit(W, H), n = list.length, land = W > H;
    const cols = land ? (n <= 4 ? n : Math.ceil(n / 2)) : (n === 1 ? 1 : 2), rows = Math.ceil(n / cols);
    const m = W * 0.05, gap = Math.min(W, H) * 0.025, headH = H * (land ? 0.19 : 0.14), footH = H * 0.07;
    const areaW = W - 2 * m, areaH = H - headH - footH - m * 0.4;
    const cw = (areaW - gap * (cols - 1)) / cols, ch = Math.min((areaH - gap * (rows - 1)) / rows, cw * 1.6);
    const gridH = ch * rows + gap * (rows - 1), y0 = headH + (areaH - gridH) / 2;
    const horiz = cw > ch * 1.15;

    const imgs = await Promise.all(list.map(p => (p.images && p.images[0]) ? loadImg(p.images[0]).catch(() => null) : null));
    const objs = [];
    objs.push(kit.rect({ left: W / 2, top: headH * 0.84, width: 140 * u, height: 8 * u, rx: 4, ry: 4, fill: ACCENT, name: 'Línea' }));
    objs.push(T('Catálogo', { left: W / 2, top: headH * 0.46, fontSize: Math.min(110 * u, headH * 0.55), fill: '#0F172A', width: W * 0.86, name: 'Título' }));

    list.forEach((p, i) => {
      const r = Math.floor(i / cols), cInRow = (r === rows - 1) ? (n - r * cols) : cols;       // última fila centrada
      const rowW = cInRow * cw + (cInRow - 1) * gap, x0 = m + (areaW - rowW) / 2 + (i - r * cols) * (cw + gap), y = y0 + r * (ch + gap);
      const pad = Math.min(cw, ch) * 0.06;
      objs.push(kit.rect({ left: x0 + cw / 2, top: y + ch / 2, width: cw, height: ch, rx: 26 * u, ry: 26 * u, fill: '#FFFFFF', stroke: '#E2E8F0', strokeWidth: 3, name: 'Tarjeta' }));

      /* caja de la foto */
      const pb = horiz ? { x: x0 + pad, y: y + pad, w: ch - 2 * pad, h: ch - 2 * pad } : { x: x0 + pad, y: y + pad, w: cw - 2 * pad, h: ch * 0.56 - pad };
      objs.push(kit.rect({ left: pb.x + pb.w / 2, top: pb.y + pb.h / 2, width: pb.w, height: pb.h, rx: 18 * u, ry: 18 * u, fill: '#F1F5F9', name: 'Fondo foto' }));
      const im = imgs[i];
      if (im) { const s = Math.min(pb.w / im.width, pb.h / im.height); im.set({ originX: 'center', originY: 'center', left: pb.x + pb.w / 2, top: pb.y + pb.h / 2, scaleX: s, scaleY: s, name: 'Foto' }); objs.push(im); }
      else objs.push(T((p.name || '?').trim().charAt(0).toUpperCase(), { left: pb.x + pb.w / 2, top: pb.y + pb.h / 2, fontSize: Math.min(pb.w, pb.h) * 0.5, fill: '#CBD5E1', width: pb.w, name: 'Inicial' }));

      /* textos */
      const nameSize = Math.max(22 * u, Math.min(54 * u, ch * (horiz ? 0.13 : 0.085))), priceSize = Math.max(28 * u, Math.min(84 * u, ch * (horiz ? 0.2 : 0.13)));
      if (horiz) {
        const tx = pb.x + pb.w + pad * 1.4, tw = x0 + cw - pad - tx;
        const nm = fitLines(T(p.name, { left: tx, top: y + pad, originX: 'left', originY: 'top', textAlign: 'left', fontSize: nameSize, width: tw, fill: '#0F172A', name: 'Nombre' }), ch * 0.5);
        objs.push(nm);
        objs.push(T(money(p.price), { left: tx, top: y + ch - pad, originX: 'left', originY: 'bottom', textAlign: 'left', fontSize: priceSize, width: tw, fill: ACCENT, name: 'Precio' }));
      } else {
        const tw = cw - 2 * pad, ty = pb.y + pb.h + pad * 0.8;
        const nm = fitLines(T(p.name, { left: x0 + cw / 2, top: ty, originY: 'top', fontSize: nameSize, fontWeight: 700, width: tw, fill: '#0F172A', name: 'Nombre' }), ch * 0.2);
        objs.push(nm);
        objs.push(T(money(p.price), { left: x0 + cw / 2, top: y + ch - pad, originY: 'bottom', fontSize: priceSize, width: tw, fill: ACCENT, name: 'Precio' }));
      }
    });
    objs.push(T(contactLine(), { left: W / 2, top: H - footH * 0.5, fontSize: Math.min(38 * u, footH * 0.5), fontWeight: 600, fill: '#64748B', width: W * 0.88, name: 'Contacto' }));

    resetCanvas(api, { type: 'solid', color: '#F1F5F9' });
    objs.forEach(o => fc.add(o));
    finish(api, `Catálogo con ${n} producto${n === 1 ? '' : 's'} listo`);
  }

  /* ============================================ VARIOS → LISTA DE PRECIOS */
  async function buildPriceList(api, list) {
    const fc = api.canvas(); if (!fc || !list.length) return;
    if (!confirmReplace(fc)) return;
    await warm();
    const { w: W, h: H } = api.size(), u = unit(W, H), n = list.length;
    const headH = H * 0.2, footH = H * 0.07, areaH = H - headH - footH, step = Math.min(H * 0.12, areaH / n), y0 = headH + (areaH - step * n) / 2;
    const fs = Math.max(22 * u, Math.min(62 * u, step * 0.42));
    const objs = [
      T('Lista de precios', { left: W / 2, top: headH * 0.5, fontSize: Math.min(112 * u, headH * 0.55), fill: '#7C2D12', width: W * 0.86, name: 'Título' }),
      kit.rect({ left: W / 2, top: headH * 0.86, width: 160 * u, height: 10 * u, rx: 5, ry: 5, fill: '#F97316', name: 'Línea' }),
    ];
    list.forEach((p, i) => {
      const y = y0 + step * i + step / 2;
      objs.push(fitLines(T(p.name, { left: W * 0.09, top: y, originX: 'left', textAlign: 'left', fontSize: fs, fontWeight: 600, fill: '#431407', width: W * 0.56, name: 'Nombre' }), step * 0.9));
      objs.push(T(money(p.price), { left: W * 0.91, top: y, originX: 'right', textAlign: 'right', fontSize: fs * 1.1, fill: '#EA580C', width: W * 0.3, name: 'Precio' }));
      if (i < n - 1) objs.push(kit.rect({ left: W / 2, top: y + step / 2, width: W * 0.82, height: 3, fill: '#FDBA74', name: 'Divisor' }));
    });
    objs.push(T(contactLine(), { left: W / 2, top: H - footH * 0.5, fontSize: Math.min(36 * u, footH * 0.5), fontWeight: 600, fill: '#9A3412', width: W * 0.88, name: 'Contacto' }));
    resetCanvas(api, { type: 'solid', color: '#FFF7ED' });
    objs.forEach(o => fc.add(o));
    finish(api, `Lista con ${n} producto${n === 1 ? '' : 's'} lista`);
  }

  /* ======================================================================= PANEL */
  Studio.registerPane('productos', {
    render(body, api) {
      const S = { all: null, loading: false, error: '', q: '', multi: false, open: null, pick: new Set(), photoIdx: 0,
        chips: { photo: true, name: true, price: true, desc: false }, busy: false };

      body.replaceChildren(h(`<div class="st-prodpane">
        <div class="st-prodbar">
          <label class="st-search">${icon('search', 16)}<input type="search" class="st-input" data-p="q" placeholder="Buscar producto…" autocomplete="off" aria-label="Buscar producto"></label>
          <button class="st-btn is-outline" type="button" data-p="reload" aria-label="Actualizar lista" title="Actualizar lista">${icon('refresh')}</button>
        </div>
        <button class="st-btn is-outline st-multi-toggle" type="button" data-p="multi" aria-pressed="false">${icon('layers')}<span>Armar catálogo con varios</span></button>
        <div data-p="list"></div>
        <div class="st-multibar" data-p="multibar" hidden></div>
      </div>`));
      const $ = (k) => body.querySelector(`[data-p="${k}"]`);

      const visible = () => {
        const q = S.q.trim().toLowerCase();
        return (S.all || []).filter(p => !q || (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
      };
      const thumb = (p) => p.images && p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" decoding="async">` : `<span>${esc((p.name || '?').charAt(0).toUpperCase())}</span>`;

      function detail(p) {
        const photos = p.images && p.images.length;
        const strip = photos > 1 ? `<div class="st-photos" role="group" aria-label="Elegir foto">${p.images.map((u, i) => `<button type="button" data-p="photo" data-i="${i}" aria-pressed="${i === S.photoIdx}"><img src="${esc(u)}" alt="Foto ${i + 1}" loading="lazy"></button>`).join('')}</div>` : '';
        const chip = (k, label, off) => `<button type="button" class="st-chipbtn" data-p="chip" data-k="${k}" aria-pressed="${!off && S.chips[k]}"${off ? ' disabled' : ''}>${label}</button>`;
        return `<div class="st-prod-detail">${strip}
          <div class="st-chips" role="group" aria-label="Qué incluir">${chip('photo', 'Foto', !photos)}${chip('name', 'Nombre')}${chip('price', 'Precio')}${chip('desc', 'Descripción', !p.description)}</div>
          <button class="st-btn is-primary" type="button" data-p="add"${S.busy ? ' disabled' : ''}>Agregar a la placa</button>
          <button class="st-btn is-outline" type="button" data-p="fill"${S.busy ? ' disabled' : ''}>Completar la plantilla</button>
          <p class="st-help">«Completar» reemplaza el nombre y el precio de ejemplo del diseño actual.</p></div>`;
      }

      function draw() {
        const list = $('list'), bar = $('multibar');
        $('multi').setAttribute('aria-pressed', String(S.multi));
        $('multi').querySelector('span').textContent = S.multi ? 'Salir del modo catálogo' : 'Armar catálogo con varios';
        if (S.loading) { list.innerHTML = '<div class="st-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'; bar.hidden = true; return; }
        if (S.error) { list.innerHTML = `<div class="st-empty">${esc(S.error)}<br><button class="st-btn is-outline" type="button" data-p="reload" style="margin-top:10px">Reintentar</button></div>`; bar.hidden = true; return; }
        const items = visible();
        if (!S.all || !S.all.length) { list.innerHTML = '<div class="st-empty">Todavía no cargaste productos.<small>Cargalos desde Inventario y volvé acá.</small></div>'; bar.hidden = true; return; }
        if (!items.length) { list.innerHTML = '<div class="st-empty">No hay productos con ese nombre.</div>'; }
        else list.innerHTML = `<ul class="st-prods">${items.map(p => {
          const open = !S.multi && S.open === p.id, sel = S.pick.has(p.id);
          return `<li class="st-prod${open ? ' is-open' : ''}${sel ? ' is-picked' : ''}">
            <button class="st-prod-row" type="button" data-p="row" data-id="${p.id}" aria-expanded="${open}"${S.multi ? ` role="checkbox" aria-checked="${sel}"` : ''}>
              ${S.multi ? `<span class="st-check" aria-hidden="true">${sel ? icon('check', 14) : ''}</span>` : ''}
              <span class="st-prod-th">${thumb(p)}</span>
              <span class="st-prod-info"><b>${esc(p.name)}</b><small>${money(p.price)}${p.stock != null ? ' · ' + p.stock + ' en stock' : ''}${p.active === false ? ' · Inactivo' : ''}</small></span>
            </button>${open ? detail(p) : ''}</li>`;
        }).join('')}</ul>`;
        bar.hidden = !S.multi;
        if (S.multi) bar.innerHTML = `<span><b>${S.pick.size}</b> de ${MAX_MULTI} elegidos</span>
          <button class="st-btn is-primary" type="button" data-p="catalog"${S.pick.size && !S.busy ? '' : ' disabled'}>Catálogo</button>
          <button class="st-btn is-outline" type="button" data-p="plist"${S.pick.size && !S.busy ? '' : ' disabled'}>Lista de precios</button>`;
      }

      async function load() {
        S.loading = true; S.error = ''; draw();
        try { S.all = await getApi('/products'); }
        catch (e) { S.error = (e && e.message) || 'No se pudieron cargar los productos.'; }
        S.loading = false; draw();
      }
      const run = async (fn) => {
        if (S.busy) return; S.busy = true; draw();
        try { await fn(); } catch (e) { console.error('[Studio] productos', e); api.toast('No se pudo completar la acción.'); }
        S.busy = false; if (body.isConnected) draw();
      };
      const opts = () => ({ ...S.chips, photoIdx: S.photoIdx });
      const byId = (id) => (S.all || []).find(p => String(p.id) === String(id));
      const chosen = () => (S.all || []).filter(p => S.pick.has(p.id));

      body.addEventListener('input', (e) => { if (e.target.dataset.p === 'q') { S.q = e.target.value; draw(); } });
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]'); if (!b) return;
        const k = b.dataset.p;
        if (k === 'reload') return load();
        if (k === 'multi') { S.multi = !S.multi; S.open = null; if (!S.multi) S.pick.clear(); return draw(); }
        if (k === 'row') {
          const p = byId(b.dataset.id); if (!p) return;
          if (S.multi) { if (S.pick.has(p.id)) S.pick.delete(p.id); else if (S.pick.size >= MAX_MULTI) api.toast(`Podés elegir hasta ${MAX_MULTI} productos.`); else S.pick.add(p.id); }
          else { S.open = S.open === p.id ? null : p.id; S.photoIdx = 0; }
          return draw();
        }
        if (k === 'chip') { S.chips[b.dataset.k] = !S.chips[b.dataset.k]; return draw(); }
        if (k === 'photo') { S.photoIdx = +b.dataset.i; return draw(); }
        const p = byId(S.open);
        if (k === 'add' && p) return run(() => addToCanvas(api, p, opts()));
        if (k === 'fill' && p) return run(() => fillTemplate(api, p, opts()));
        if (k === 'catalog') return run(() => buildCatalog(api, chosen()));
        if (k === 'plist') return run(() => buildPriceList(api, chosen()));
      });

      load();
    },
  });
})();
