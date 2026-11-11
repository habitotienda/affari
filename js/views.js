/* Modales y vistas del panel. Usa api(), esc(), icon(), ars(), state, toast(), refresh() */
const fld = (label, inner, id) => `<div class="field"><label${id ? ` for="${id}"` : ''}>${label}</label><div class="input">${inner}</div></div>`;
const when = s => new Date(String(s).replace(' ', 'T')).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const KIND = { entrada: 'Entrada', salida: 'Salida', fiado: 'Fiado' };
const methodSeg = () => `<div class="field"><label>Medio de pago</label><div class="seg seg3"><label><input type="radio" name="sm" value="Efectivo" checked><span>Efectivo</span></label><label><input type="radio" name="sm" value="Transferencia"><span>Transferencia</span></label><label><input type="radio" name="sm" value="Tarjeta"><span>Tarjeta</span></label></div></div>`;
const prodOpts = ps => '<option value="">Sin producto (monto libre)</option>' + ps.filter(p => p.active && p.stock > 0).map(p => `<option value="${p.id}" data-price="${p.price}" data-stock="${p.stock}" data-variants="${esc(JSON.stringify((p.variants || []).map(v => ({ id: v.id, name: v.name, price: v.price || p.price, stock: v.stock }))))}">${esc(p.name)} · ${ars(p.price)} · ${p.stock} u.${(p.variants || []).length ? ' · con variantes' : ''}</option>`).join('');

function openModal({ title, html, submit = 'Guardar', onSubmit, wide, hideSubmit }) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<form class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('close')}</button></div>
    <div class="error hidden" data-err role="alert"></div>${html}${hideSubmit ? '' : `<button class="btn btn-primary btn-block" data-submit>${submit}</button>`}</form>`;
  const form = ov.querySelector('form');
  const onKey = e => e.key === 'Escape' && close();
  const close = () => { document.removeEventListener('keydown', onKey); ov.classList.add('closing'); setTimeout(() => ov.remove(), 180); };
  document.addEventListener('keydown', onKey);
  ov.onclick = e => { if (e.target === ov) close(); };
  form.querySelector('[data-close]').onclick = close;
  form.onsubmit = async e => {
    e.preventDefault(); if (!onSubmit) return;
    const b = form.querySelector('[data-submit]'); if (b) b.disabled = true;
    try { await onSubmit(form, close); }
    catch (err) { const m = form.querySelector('[data-err]'); m.textContent = err.message; m.classList.remove('hidden'); if (b) b.disabled = false; }
  };
  document.body.appendChild(ov);
  const first = form.querySelector('input:not([type=radio]):not([type=checkbox]),select,textarea'); if (first) first.focus();
  return { form, close };
}
const done = async (close, msg) => { close(); toast(msg); await refresh(); };

/* Vincula un <select> de producto con cantidad, monto y concepto */
function bindProduct(form) {
  const $ = s => form.querySelector(s), wrap = $('[data-vwrap]'), mv = $('#mv');
  const variants = () => { try { return JSON.parse($('#mp').selectedOptions[0]?.dataset.variants || '[]'); } catch { return []; } };
  const drawVariants = () => {
    const vs = variants(); wrap.classList.toggle('hidden', !vs.length); mv.required = !!vs.length;
    mv.innerHTML = vs.map(v => `<option value="${v.id}" data-price="${v.price}" data-stock="${v.stock}" ${v.stock < 1 ? 'disabled' : ''}>${esc(v.name)} · ${ars(v.price)} · ${v.stock} u.</option>`).join('');
    const first = [...mv.options].find(o => !o.disabled); if (first) mv.value = first.value;
  };
  const upd = () => {
    const p = $('#mp').selectedOptions[0]; if (!p || !p.value) return;
    const v = variants().length ? mv.selectedOptions[0] : null, src = v || p;
    const q = Math.max(1, Math.min(Number($('#mq').value) || 1, Number(src.dataset.stock) || 1));
    $('#mq').value = q; $('#mq').max = src.dataset.stock;
    $('#ma').value = Number(src.dataset.price) * q;
    $('#mc').value = `${q} × ${p.textContent.split(' · ')[0]}${v ? ' (' + v.textContent.split(' · ')[0] + ')' : ''}`;
  };
  $('#mp').onchange = () => { drawVariants(); upd(); }; mv.onchange = upd; $('#mq').oninput = upd;
}
const variantId = f => { const v = f.querySelector('#mv'); return v && !v.closest('.hidden') && v.value ? Number(v.value) : null; };
const productFields = ps => fld('Producto (opcional)', `<select id="mp">${prodOpts(ps)}</select>`, 'mp') + `<div class="hidden" data-vwrap>${fld('Variante', '<select id="mv"></select>', 'mv')}</div>` + fld('Cantidad', '<input id="mq" type="number" min="1" value="1">', 'mq');

async function openSaleModal(kind = 'entrada') {
  const sale = kind === 'entrada', products = sale ? await api('/products') : [];
  const { form } = openModal({
    title: sale ? 'Nueva venta' : 'Registrar gasto', submit: sale ? 'Registrar venta' : 'Registrar gasto',
    html: (sale ? productFields(products) : '') + fld('Concepto', `<input id="mc" value="${sale ? 'Venta mostrador' : ''}" placeholder="${sale ? '' : 'Ej: Pago proveedor'}" required>`, 'mc') +
      fld('Monto (ARS)', '<input id="ma" type="number" min="1" step="any" inputmode="decimal" placeholder="0" required>', 'ma') + methodSeg(),
    onSubmit: async (f, close) => {
      await api('/sales', { method: 'POST', body: { kind, concept: f.querySelector('#mc').value.trim(), amount: Number(f.querySelector('#ma').value),
        method: f.querySelector('input[name=sm]:checked').value, product_id: sale && f.querySelector('#mp').value ? Number(f.querySelector('#mp').value) : null, variant_id: sale ? variantId(f) : null, qty: sale ? Number(f.querySelector('#mq').value) || 1 : 1 } });
      await done(close, sale ? 'Venta registrada' : 'Gasto registrado');
    }
  });
  if (sale) bindProduct(form);
}

async function openFiadoModal(pre) {
  const [clients, products] = await Promise.all([api('/clients'), api('/products')]);
  const { form } = openModal({
    title: 'Anotar fiado', submit: 'Guardar fiado', wide: true,
    html: `<div class="row2">${fld('Cliente', `<input id="fn" list="fl" autocomplete="off" required placeholder="Nombre" value="${esc(pre?.name || '')}"><datalist id="fl">${clients.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>`, 'fn')}
      ${fld('Teléfono / WhatsApp *', `<input id="fp" type="tel" required placeholder="351 555 0123" value="${esc(pre?.phone || '')}">`, 'fp')}</div>` +
      productFields(products) + fld('Concepto', '<input id="mc" placeholder="Ej: Compras de la semana">', 'mc') + fld('Monto (ARS)', '<input id="ma" type="number" min="1" step="any" inputmode="decimal" required placeholder="0">', 'ma'),
    onSubmit: async (f, close) => {
      const name = f.querySelector('#fn').value.trim(), cl = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
      await api('/fiados', { method: 'POST', body: { client_id: cl?.id ?? null, name, phone: f.querySelector('#fp').value.trim(), amount: Number(f.querySelector('#ma').value),
        concept: f.querySelector('#mc').value.trim(), product_id: f.querySelector('#mp').value ? Number(f.querySelector('#mp').value) : null, variant_id: variantId(f), qty: Number(f.querySelector('#mq').value) || 1 } });
      await done(close, 'Fiado anotado');
    }
  });
  bindProduct(form);
  form.querySelector('#fn').oninput = e => { const c = clients.find(c => c.name.toLowerCase() === e.target.value.trim().toLowerCase()); if (c && c.phone) form.querySelector('#fp').value = c.phone; };
}

function openPayModal(c) {
  openModal({ title: `Cobrar a ${c.name}`, submit: 'Registrar cobro',
    html: `<p class="muted" style="margin-bottom:14px">Deuda actual: <strong>${ars(c.balance)}</strong></p>` + fld('Monto cobrado (ARS)', `<input id="ma" type="number" min="1" max="${c.balance}" step="any" value="${c.balance}" required>`, 'ma') + methodSeg(),
    onSubmit: async (f, close) => { await api(`/clients/${c.id}/pay`, { method: 'POST', body: { amount: Number(f.querySelector('#ma').value), method: f.querySelector('input[name=sm]:checked').value } }); await done(close, 'Cobro registrado'); } });
}

async function openStockModal(pid) {
  const ps = await api('/products');
  if (!ps.length) { toast('Primero creá un producto'); return openProductModal(); }
  openModal({ title: 'Ingresar stock', submit: 'Sumar al inventario',
    html: fld('Producto', `<select id="mp">${ps.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} (hay ${p.stock})</option>`).join('')}</select>`, 'mp') + fld('Unidades que ingresan', '<input id="mq" type="number" min="1" value="1" required>', 'mq'),
    onSubmit: async (f, close) => { await api(`/products/${f.querySelector('#mp').value}/stock`, { method: 'POST', body: { qty: Number(f.querySelector('#mq').value) } }); await done(close, 'Stock actualizado'); } });
}

/* Reduce una imagen en el navegador (canvas) y la devuelve como data URL */
function imgToData(file, max, type = 'image/jpeg', quality = .78) {
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
      const x = c.getContext('2d'); if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL(type, quality));
    };
    im.onerror = () => { URL.revokeObjectURL(url); bad(new Error('No pudimos leer esa imagen.')); };
    im.src = url;
  });
}

/* Recortador de fotos (capturas, fotos con bordes sobrantes…). Devuelve un data URL JPEG recortado o null si se cancela. */
function openCropper(src, max = 800) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'crop-ov';
    const ratios = [['', 'Libre'], ['1', '1:1'], ['1.3333', '4:3'], ['0.75', '3:4'], ['1.7778', '16:9']];
    ov.innerHTML = `<div class="crop-box" role="dialog" aria-modal="true" aria-label="Recortar foto">
      <div class="crop-head"><h2>Recortar foto</h2><div class="crop-ratios" role="group" aria-label="Proporción">${ratios.map(([r, l], i) => `<button type="button" data-r="${r}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div></div>
      <div class="crop-stage" data-stage><img data-img alt="Foto a recortar" draggable="false">
        <div class="crop-sel" data-sel hidden>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<i data-h="${h}"></i>`).join('')}</div></div>
      <p class="hint crop-hint">Arrastrá el recuadro o sus bordes para elegir qué parte queda.</p>
      <div class="crop-foot"><button type="button" class="btn" data-cancel>Cancelar</button><button type="button" class="btn btn-primary" data-ok disabled>Usar recorte</button></div></div>`;
    const $ = k => ov.querySelector(k), img = $('[data-img]'), sel = $('[data-sel]'), ok = $('[data-ok]');
    const MIN = 40; let W = 0, H = 0, ratio = 0, R = { x: 0, y: 0, w: 0, h: 0 }, drag = null;
    const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
    const paint = () => { sel.style.left = R.x + 'px'; sel.style.top = R.y + 'px'; sel.style.width = R.w + 'px'; sel.style.height = R.h + 'px'; };
    const fitRatio = () => {                         // acomoda el recuadro actual a la proporción elegida, centrado
      if (!ratio) return;
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2; let w = R.w, h = w / ratio;
      if (h > H) { h = H; w = h * ratio; } if (w > W) { w = W; h = w / ratio; }
      R = { w, h, x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h) };
    };
    const start = () => {
      W = img.clientWidth; H = img.clientHeight; if (!W || !H) return;
      const w = W * .86, h = H * .86; R = { x: (W - w) / 2, y: (H - h) / 2, w, h }; fitRatio(); paint(); sel.hidden = false; ok.disabled = false;
    };
    const close = v => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); ov.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); } };
    const onResize = () => { const k = img.clientWidth / (W || 1); if (!W || !img.clientWidth) return; R = { x: R.x * k, y: R.y * k, w: R.w * k, h: R.h * k }; W = img.clientWidth; H = img.clientHeight; paint(); };
    document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize);

    ov.addEventListener('pointerdown', e => {
      const hd = e.target.closest('[data-h]'), inSel = e.target.closest('[data-sel]'); if (!inSel) return;
      e.preventDefault(); drag = { h: hd ? hd.dataset.h : 'move', x0: e.clientX, y0: e.clientY, R0: { ...R } }; sel.setPointerCapture(e.pointerId);
    });
    sel.addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, { R0, h: hd } = drag;
      if (hd === 'move') { R = { ...R0, x: clamp(R0.x + dx, 0, W - R0.w), y: clamp(R0.y + dy, 0, H - R0.h) }; return paint(); }
      let x = R0.x, y = R0.y, x2 = x + R0.w, y2 = y + R0.h;
      if (hd.includes('w')) x = clamp(x + dx, 0, x2 - MIN);
      if (hd.includes('e')) x2 = clamp(x2 + dx, x + MIN, W);
      if (hd.includes('n')) y = clamp(y + dy, 0, y2 - MIN);
      if (hd.includes('s')) y2 = clamp(y2 + dy, y + MIN, H);
      let w = x2 - x, h = y2 - y;
      if (ratio) {
        if (hd === 'n' || hd === 's') w = h * ratio; else h = w / ratio;
        const aw = hd.includes('w') ? R0.x + R0.w : W - R0.x, ah = hd.includes('n') ? R0.y + R0.h : H - R0.y;
        if (w > aw) { w = aw; h = w / ratio; } if (h > ah) { h = ah; w = h * ratio; }
        x = hd.includes('w') ? R0.x + R0.w - w : R0.x; y = hd.includes('n') ? R0.y + R0.h - h : R0.y;
      }
      R = { x, y, w, h }; paint();
    });
    const end = () => { drag = null; }; sel.addEventListener('pointerup', end); sel.addEventListener('pointercancel', end);

    $('.crop-ratios').onclick = e => {
      const b = e.target.closest('[data-r]'); if (!b || sel.hidden) return;
      ratio = Number(b.dataset.r) || 0; ov.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); fitRatio(); paint();
    };
    $('[data-cancel]').onclick = () => close(null);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(null); });
    ok.onclick = () => {
      try {
        const k = img.naturalWidth / W, sw = Math.max(1, Math.round(R.w * k)), sh = Math.max(1, Math.round(R.h * k)), f = Math.min(1, max / Math.max(sw, sh));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * f)); c.height = Math.max(1, Math.round(sh * f));
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, Math.round(R.x * k), Math.round(R.y * k), sw, sh, 0, 0, c.width, c.height);
        let out = ''; for (const q of [.85, .72, .6, .5]) { out = c.toDataURL('image/jpeg', q); if (out.length < 420000) break; }
        close(out);
      } catch (err) { toast('No se pudo recortar esta foto. Probá subirla de nuevo.'); close(null); }
    };
    img.onload = () => requestAnimationFrame(start);
    img.onerror = () => { toast('No se pudo abrir la foto para recortarla.'); close(null); };
    img.src = src;
    document.body.appendChild(ov); ok.focus({ preventScroll: true });
  });
}

/* Fotos con IA (Cloudflare Workers AI): mejora una foto existente o crea una desde el nombre. No guarda nada: devuelve la elegida con onUse */
function openPhotoAI({ src, name, category, onUse }) {
  const styles = [['blanco', 'Fondo blanco'], ['gris', 'Gris de estudio'], ['ambiente', 'Ambiente natural'], ['oscuro', 'Premium oscuro']];
  const ov = document.createElement('div'); ov.className = 'photo-ai-ov';
  ov.innerHTML = `<div class="photo-ai" role="dialog" aria-modal="true" aria-label="Foto con IA">
    <h2>${src ? 'Mejorar foto con IA' : 'Crear foto con IA'}</h2>
    <p class="hint">${src ? 'La IA vuelve a fotografiar el producto con un fondo y una luz de estudio. Revisá que se vea igual al real antes de usarla.' : 'Crea una imagen ilustrativa a partir del nombre. Usala solo si no tenés una foto real del producto.'}</p>
    <div class="pai-styles" role="group" aria-label="Estilo">${styles.map(([k, l], i) => `<button type="button" data-st="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
    <div class="pai-pair"><figure ${src ? '' : 'hidden'}><div class="pai-box"><img data-before alt="Foto original"></div>Original</figure>
      <figure ${src ? '' : 'style="grid-column:1/-1"'}><div class="pai-box" data-after><span class="muted">${src ? 'Acá aparece el resultado' : 'Acá aparece la imagen'}</span></div>Con IA</figure></div>
    <div class="pai-err" data-err hidden role="alert"></div>
    <div class="pai-foot"><button type="button" class="btn" data-cancel>Cerrar</button>
      <button type="button" class="btn btn-ai" data-go>${icon('sparkles', 16)}<span>Generar</span></button>
      <button type="button" class="btn" data-add hidden>Agregar como foto</button>
      <button type="button" class="btn btn-primary" data-use hidden>${src ? 'Reemplazar la original' : 'Usar esta foto'}</button></div></div>`;
  const $ = k => ov.querySelector(k);
  const go = $('[data-go]'), add = $('[data-add]'), use = $('[data-use]'), err = $('[data-err]'), after = $('[data-after]');
  let style = 'blanco', result = '', busy = false;
  if (src) $('[data-before]').src = src;
  const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.onclick = e => { if (e.target === ov) close(); };
  $('[data-cancel]').onclick = close;
  ov.querySelector('.pai-styles').onclick = e => { const b = e.target.closest('[data-st]'); if (!b || busy) return; style = b.dataset.st; ov.querySelectorAll('[data-st]').forEach(x => x.setAttribute('aria-pressed', x === b)); };
  go.onclick = async () => {
    if (busy) return; busy = true; go.disabled = true; err.hidden = true; add.hidden = use.hidden = true;
    after.innerHTML = '<span class="pai-wait">Generando… puede tardar unos segundos</span>';
    try {
      const r = await httpRequest(src ? '/ai/image/enhance' : '/ai/image/create', { method: 'POST', timeout: 110000,
        body: src ? { image: src, name, style, product_id: onUse.productId || null } : { name, category, style } });
      result = r.image; after.innerHTML = ''; const im = new Image(); im.alt = 'Foto generada con IA'; im.src = result; after.appendChild(im);
      use.hidden = false; add.hidden = !src || !onUse.canAdd(); go.querySelector('span').textContent = 'Probar de nuevo';
    } catch (e) {
      after.innerHTML = '<span class="muted">No se pudo generar</span>'; err.textContent = e.message || 'No se pudo generar la foto.'; err.hidden = false;
    } finally { busy = false; go.disabled = false; }
  };
  use.onclick = () => { if (result) { onUse(result, src ? 'replace' : 'add'); close(); } };
  add.onclick = () => { if (result) { onUse(result, 'add'); close(); } };
  document.body.appendChild(ov); go.focus({ preventScroll: true });
}

async function openProductModal(p) {
  const all = await api('/products'), cats = [...new Set(all.map(x => x.category).filter(Boolean))];
  let imgs = [...(p?.images || [])];
  const orig = new Map();   // foto subida (ya reducida) → versión más grande en memoria, para recortar sin perder calidad
  const v = k => esc(p ? p[k] : '');
  const { form } = openModal({ title: p ? 'Editar producto' : 'Nuevo producto', wide: true,
    html: fld('Nombre', `<input id="pn" required value="${v('name')}" placeholder="Ej: Yerba mate 1kg">`, 'pn') +
      fld('Categoría', `<input id="pk" list="pkl" autocomplete="off" maxlength="40" value="${v('category')}" placeholder="Ej: Almacén, Bebidas…"><datalist id="pkl">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`, 'pk') +
      `<div class="field"><div class="label-row"><label for="pd">Descripción</label><button type="button" class="ai-pencil" data-aidesc title="Generar descripción con IA a partir del nombre y la foto" aria-label="Generar descripción con IA">${icon('edit', 16)}</button></div><textarea id="pd" placeholder="Detalle que verá el cliente en el catálogo">${v('description')}</textarea></div>
      <div class="field"><label>Fotos del producto (hasta 5)</label><div class="gal-ed" data-gal></div><input id="pimg" type="file" accept="image/*" multiple hidden><div class="gal-tools"><button type="button" class="btn-ai" data-aigen>${icon('sparkles', 14)}<span>Crear foto con IA</span></button></div><small class="hint">La primera es la principal. Se optimizan automáticamente. Usá ✂ para recortar y ✨ para dejarla con aspecto de estudio.</small></div>
      <div class="row2">${fld('Precio de venta', `<input id="pp" type="number" min="0" step="any" required value="${p ? p.price : ''}">`, 'pp')}${fld('Costo', `<input id="pc" type="number" min="0" step="any" value="${p ? p.cost : 0}">`, 'pc')}
      ${fld('Stock', `<input id="ps" type="number" min="0" required value="${p ? p.stock : 0}" ${p && (p.variants || []).length ? 'disabled title="Se calcula con las variantes"' : ''}>`, 'ps')}${fld('Alerta de stock bajo', `<input id="pm" type="number" min="0" value="${p ? p.min_stock : 5}">`, 'pm')}</div>
      <label class="check"><input id="pa" type="checkbox" ${!p || p.active ? 'checked' : ''}>Activo (visible en el catálogo público)</label>`,
    onSubmit: async (f, close) => {
      const body = { name: f.querySelector('#pn').value.trim(), category: f.querySelector('#pk').value.trim(), description: f.querySelector('#pd').value, price: Number(f.querySelector('#pp').value), cost: Number(f.querySelector('#pc').value) || 0,
        stock: Math.round(Number(f.querySelector('#ps').value)), min_stock: Math.round(Number(f.querySelector('#pm').value)) || 0, active: f.querySelector('#pa').checked, images: imgs };
      await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body }); await done(close, p ? 'Producto actualizado' : 'Producto creado');
    } });
  const pd = form.querySelector('#pd'), pen = form.querySelector('[data-aidesc]');
  pen.onclick = async () => {
    const name = form.querySelector('#pn').value.trim();
    if (!name) { toast('Escribí primero el nombre del producto'); form.querySelector('#pn').focus(); return; }
    if (pd.value.trim() && !confirm('Ya hay una descripción. ¿Reemplazarla por una generada con IA?')) return;
    pen.disabled = true; pen.classList.add('busy');
    try {
      const r = await api('/ai/describe', { method: 'POST', body: { name, category: form.querySelector('#pk').value.trim(), image: imgs[0] || '', product_id: p ? p.id : null } });
      pd.value = r.description; pd.focus(); toast('Descripción generada. Revisala antes de guardar.');
    } catch (err) { toast(err.message); }
    finally { pen.disabled = false; pen.classList.remove('busy'); }
  };
  const gal = form.querySelector('[data-gal]'), input = form.querySelector('#pimg');
  const drawGal = () => { gal.innerHTML = imgs.map((s, i) => `<div class="gal-it"><img src="${s}" alt="Foto ${i + 1}"><button type="button" data-rm="${i}" aria-label="Quitar foto">×</button><button type="button" class="gal-crop" data-crop="${i}" aria-label="Recortar foto ${i + 1}" title="Recortar">${icon('crop', 12)}</button><button type="button" class="gal-ai" data-enh="${i}" aria-label="Mejorar foto ${i + 1} con IA" title="Mejorar con IA">${icon('sparkles', 12)}</button>${i ? `<button type="button" class="mk" data-main="${i}">Principal</button>` : '<em>Principal</em>'}</div>`).join('') + (imgs.length < 5 ? '<label class="gal-add" for="pimg" title="Agregar foto">+</label>' : ''); };
  gal.onclick = e => {
    const rm = e.target.closest('[data-rm]'), mk = e.target.closest('[data-main]'), cr = e.target.closest('[data-crop]');
    const en = e.target.closest('[data-enh]');
    if (en) {
      const i = +en.dataset.enh, pname = form.querySelector('#pn').value.trim();
      openPhotoAI({ src: imgs[i], name: pname, category: form.querySelector('#pk').value.trim(),
        onUse: Object.assign((img, mode) => { if (mode === 'replace') imgs[i] = img; else if (imgs.length < 5) imgs.push(img); drawGal(); toast('Foto lista. Se guarda cuando guardes el producto.'); }, { productId: p ? p.id : null, canAdd: () => imgs.length < 5 }) });
      return;
    }
    if (cr) { const i = +cr.dataset.crop; openCropper(orig.get(imgs[i]) || imgs[i]).then(out => { if (out) { imgs[i] = out; drawGal(); toast('Foto recortada'); } }); return; }
    if (rm) imgs.splice(+rm.dataset.rm, 1); else if (mk) imgs.unshift(...imgs.splice(+mk.dataset.main, 1)); else return; drawGal();
  };
  input.onchange = async () => {
    const files = [...input.files].slice(0, 5 - imgs.length); input.value = '';
    for (const f of files) { try { const small = await imgToData(f, 800); imgs.push(small); orig.set(small, await imgToData(f, 1600, 'image/jpeg', .9)); } catch (err) { toast(err.message); } }
    drawGal();
  };
  form.querySelector('[data-aigen]').onclick = () => {
    const pname = form.querySelector('#pn').value.trim();
    if (!pname) { toast('Escribí primero el nombre del producto'); form.querySelector('#pn').focus(); return; }
    if (imgs.length >= 5) { toast('Ya tenés 5 fotos: quitá una para crear otra'); return; }
    openPhotoAI({ src: '', name: pname, category: form.querySelector('#pk').value.trim(),
      onUse: Object.assign((img) => { if (imgs.length < 5) imgs.push(img); drawGal(); toast('Foto lista. Se guarda cuando guardes el producto.'); }, { productId: null, canAdd: () => false }) });
  };
  drawGal();
}

/* Lápiz del Inventario: genera con IA la descripción de todos los productos que no tienen (uno por uno, con progreso) */
async function fillMissingDescriptions(ps, btn) {
  const todo = ps.filter(p => !String(p.description || '').trim());
  if (!todo.length) return toast('Todos tus productos ya tienen descripción');
  if (!confirm(`Se generarán con IA las descripciones de ${todo.length} producto${todo.length === 1 ? '' : 's'} que no tienen. Las que ya escribiste no se tocan. ¿Continuar?`)) return;
  const label = btn.innerHTML; btn.disabled = true; btn.classList.add('busy');
  let ok = 0, fail = 0, stop = '';
  for (const [i, p] of todo.entries()) {
    btn.innerHTML = `${icon('edit', 16)}<span>${i + 1} de ${todo.length}…</span>`;
    try { await httpRequest('/ai/describe', { method: 'POST', body: { product_id: p.id, save_if_empty: true }, timeout: 60000 }); ok++; }
    catch (err) { fail++; if (err.status === 429 || err.status === 402) { stop = err.message; break; } }
  }
  btn.innerHTML = label; btn.disabled = false; btn.classList.remove('busy');
  DataStore.invalidate();
  toast(`${ok} descripcion${ok === 1 ? '' : 'es'} generada${ok === 1 ? '' : 's'}${fail ? ` · ${fail} sin resolver` : ''}${stop ? '. ' + stop : ''}`);
  await refresh();
}

/* Recordatorio de cobro: enlace wa.me con el mensaje exacto y el saldo del cliente */
const waLink = c => {
  const msg = state.user.reminder_tpl.split('{cliente}').join(c.name).split('{saldo}').join(ars(c.balance)).split('{negocio}').join(state.user.business);
  return `https://wa.me/${waNum(c.phone)}?text=${encodeURIComponent(msg)}`;
};
async function openReminderModal() {
  const debtors = (await api('/clients')).filter(c => c.balance > 0);
  openModal({ title: 'Recordatorio por WhatsApp', hideSubmit: true,
    html: debtors.length ? debtors.map(c => `<div class="wa-row"><div><strong>${esc(c.name)}</strong><small>Debe ${ars(c.balance)}</small></div><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(c)}">${icon('whatsapp', 16)}Enviar</a></div>`).join('') : '<div class="empty">No hay clientes con deuda pendiente.</div>' });
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); } catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast('Enlace copiado');
}
const catalogUrl = () => `${location.origin}/c/${state.user.slug}`;

/* ===== Vistas ===== */
const head = (h, p, actions = '') => `<header class="page-head"><div><h1>${h}</h1><p>${p}</p></div><div class="toolbar">${actions}</div></header>`;
const VIEWS = {
  async caja(el) {
    const [d, list] = await Promise.all([api('/dashboard'), api('/sales')]), k = d.kpis;
    el.innerHTML = head('Caja y Ventas', 'Todos los movimientos de tu negocio.', `<button class="btn" data-exp>${icon('plus')}Registrar gasto</button><button class="btn btn-primary" data-sale>${icon('plus')}Nueva venta</button>`) + `
      <section class="kpis"><div class="card kpi pos"><span>Ventas del día</span><strong>${ars(k.sales_today)}</strong><small>${k.sales_count} operaciones</small></div>
      <div class="card kpi"><span>Efectivo en caja hoy</span><strong>${ars(k.cash)}</strong><small>Entradas menos salidas</small></div>
      <div class="card kpi"><span>Transferencias hoy</span><strong>${ars(k.transfer)}</strong><small>Entradas menos salidas</small></div>
      <div class="card kpi"><span>Tarjeta hoy</span><strong>${ars(k.card)}</strong><small>Débito y crédito</small></div></section>
      <div class="card tbl-wrap">${list.length ? `<table><thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Medio</th><th class="num">Monto</th></tr></thead><tbody>${list.map(m => `<tr><td class="muted">${when(m.created_at)}</td><td>${esc(m.concept)}</td><td><span class="badge b-${m.kind}">${m.is_payment ? 'Cobro' : KIND[m.kind]}</span></td><td>${esc(m.method)}</td><td class="num ${m.kind === 'salida' ? 'neg' : ''}">${m.kind === 'salida' ? '−' : ''}${ars(m.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Todavía no hay movimientos. Registrá tu primera venta.</div>'}</div>`;
    el.querySelector('[data-sale]').onclick = () => openSaleModal(); el.querySelector('[data-exp]').onclick = () => openSaleModal('salida');
  },
  async fiados(el) {
    const cs = await api('/clients'), total = cs.reduce((s, c) => s + c.balance, 0);
    el.innerHTML = head('Cuaderno de Fiados', `${ars(total)} por cobrar · ${cs.filter(c => c.balance > 0).length} clientes con deuda`, `<button class="btn btn-primary" data-fiado>${icon('plus')}Anotar fiado</button>`) + `
      <div class="card tbl-wrap">${cs.length ? `<table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Último movimiento</th><th class="num">Debe</th><th></th></tr></thead><tbody>${cs.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td class="muted">${esc(c.phone || '—')}</td><td class="muted">${c.last_move ? when(c.last_move) : '—'}</td><td class="num ${c.balance > 0 ? 'neg' : ''}">${ars(c.balance)}</td>
        <td><div class="act">${c.balance > 0 ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(c)}">${icon('whatsapp', 16)}Recordar</a><button class="btn btn-sm" data-pay="${c.id}">Cobrar</button>` : ''}<button class="btn btn-sm" data-add="${c.id}">+ Fiado</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Tu cuaderno está vacío. Anotá el primer fiado con el nombre y teléfono del cliente.</div>'}</div>`;
    el.querySelector('[data-fiado]').onclick = () => openFiadoModal();
    el.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => openPayModal(cs.find(c => c.id == b.dataset.pay)));
    el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => openFiadoModal(cs.find(c => c.id == b.dataset.add)));
  },
  async inventario(el) {
    const ps = await api('/products'), low = ps.filter(p => p.stock <= p.min_stock).length;
    el.innerHTML = head('Inventario & Stock', `${ps.length} productos · ${low} con stock bajo`, `<button class="btn ai-pencil-btn" data-aiall title="Generar con IA la descripción de los productos que no tienen">${icon('edit', 16)}<span>Descripciones IA</span></button><button class="btn" data-stock>${icon('box')}Ingresar stock</button><button class="btn btn-primary" data-new>${icon('plus')}Nuevo producto</button>`) + `
      <div class="card tbl-wrap">${ps.length ? `<table><thead><tr><th>Producto</th><th class="num">Costo</th><th class="num">Precio</th><th>Stock</th><th></th></tr></thead><tbody>${ps.map(p => `<tr><td><div class="inv-prod">${p.images && p.images[0] ? `<img class="prod-th" src="${esc(p.images[0])}" alt="" loading="lazy" decoding="async">` : `<span class="prod-th">${esc((p.name[0] || '?').toUpperCase())}</span>`}<div><strong>${esc(p.name)}</strong>${p.active ? '' : ' <span class="pill-stock pill-off">Inactivo</span>'}</div></div></td><td class="num">${ars(p.cost)}</td><td class="num">${ars(p.price)}</td>
        <td><span class="pill-stock ${p.stock <= p.min_stock ? 'low' : ''}">${p.stock} u.</span></td><td><div class="act"><button class="btn btn-sm" data-in="${p.id}">+ Stock</button><button class="btn btn-sm" data-edit="${p.id}">Editar</button></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Todavía no cargaste productos.</div>'}</div>`;
    el.querySelector('[data-stock]').onclick = () => openStockModal(); el.querySelector('[data-new]').onclick = () => openProductModal();
    el.querySelector('[data-aiall]').onclick = e => fillMissingDescriptions(ps, e.currentTarget);
    el.querySelectorAll('[data-in]').forEach(b => b.onclick = () => openStockModal(+b.dataset.in));
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openProductModal(ps.find(p => p.id == b.dataset.edit)));
  },
  async catalogo(el) {
    const ps = await api('/products'), u = state.user, url = catalogUrl();
    const dr = state.draft ||= { theme: { ...SF_DEF, ...(u.theme || {}) }, logo: u.logo || null, logoDirty: false, dirty: false };
    const t = dr.theme, tab = state.cbTab ||= 'design', sec = state.cbSec ||= 'marca';
    const SECS = [['marca', 'Marca', 'store'], ['imagenes', 'Imágenes', 'image'], ['fondo', 'Fondo', 'spark'], ['estilo', 'Estilo', 'sliders']];
    const preview = () => ({ name: u.business, type: u.business_type, phone: u.phone, logo: dr.logo, theme: dr.theme, hours: state.user.hours });
    const seg = (name, opts, val, cls = '') => `<div class="seg ${cls}">${opts.map(([o, l]) => `<label><input type="radio" name="${name}" value="${o}" ${String(o) === String(val) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
    const B = BD.cards(t);
    const card = (title, body) => `<div class="card"><div class="section-title">${title}</div><div class="cfg-body">${body}</div></div>`;
    el.innerHTML = head('Catálogo Digital', 'Armá tu tienda online a tu medida y compartila por WhatsApp.', `<button class="btn btn-primary" data-new>${icon('plus')}Nuevo producto</button>`) + `
      <div class="card share"><code>${esc(url)}</code><button class="btn" data-copy>Copiar Enlace del Catálogo</button><button class="btn" data-qr>Generar Código QR</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Abrir tienda</a></div>
      <div class="cb${state.cbWide ? ' wide' : ''}" data-tab="${tab}">
        <div class="cb-tabs" role="tablist"><button data-t="design" class="${tab === 'design' ? 'active' : ''}">Editar Diseño</button><button data-t="products" class="${tab === 'products' ? 'active' : ''}">Productos (${ps.length})</button><button data-t="preview" class="tab-prev-btn ${tab === 'preview' ? 'active' : ''}">Vista Previa en Vivo</button></div>
        <div class="cb-left">
          <div class="pane pane-design" data-design data-s="${sec}">
            <div class="sec-nav" role="tablist" aria-label="Secciones del diseño">${SECS.map(([k, l, ic]) => `<button type="button" role="tab" data-sec-btn="${k}" class="${k === sec ? 'on' : ''}" aria-selected="${k === sec}">${icon(ic, 16)}<span>${l}</span></button>`).join('')}</div>
            <div class="sec" data-sec="marca">
              ${card('Logo del comercio', `<div class="logo-row"><div class="logo-prev" data-logoprev></div><div><label class="btn btn-sm" for="logoIn" style="cursor:pointer">Subir logo</label><input id="logoIn" type="file" accept="image/*" hidden><button type="button" class="btn btn-sm btn-danger" data-nologo>Quitar</button><p class="hint" style="margin-top:6px">PNG o JPG. Se ajusta solo y aparece en la cabecera.</p></div></div>`)}
              ${card('Textos', `${fld('Título principal', `<input name="title" maxlength="80" value="${esc(t.title)}" placeholder="${esc(u.business)}">`)}
                <div class="field"><label>Descripción del comercio</label><textarea name="description" maxlength="300" placeholder="Contá en una frase qué vendés">${esc(t.description)}</textarea></div>
                ${fld('Banner o aviso', `<input name="banner" maxlength="140" value="${esc(t.banner)}" placeholder="¡Envíos gratis a partir de $15.000!">`)}
                ${B.textos}
                <div class="field"><label>Tipografía</label>${seg('font', [['modern', 'Moderna'], ['classic', 'Clásica'], ['tech', 'Técnica']], t.font, 'seg3')}</div>
                <label class="check"><input type="checkbox" name="open" ${t.open ? 'checked' : ''}>Mostrar badge "Abierto"</label><label class="check" style="margin-bottom:0"><input type="checkbox" name="delivery" ${t.delivery ? 'checked' : ''}>Mostrar badge "Envíos en el día"</label>`)}
              ${card('Entrega del pedido', `<p class="hint" style="margin:0 0 10px">Es lo que el cliente elige antes de enviar el pedido. Podés desactivar una de las dos formas.</p>
                <label class="check"><input type="checkbox" name="optPickup" ${sfModes(t).includes('retiro') && t.optPickup !== false ? 'checked' : ''}>Retiro en el local <small class="hint">· "Lo paso a buscar"</small></label>
                <label class="check" style="margin-bottom:0"><input type="checkbox" name="optDelivery" ${sfModes(t).includes('envio') ? 'checked' : ''}>Envío a domicilio <small class="hint">· pide la dirección</small></label>
                <p class="hint" style="margin:8px 0 0">Siempre queda activa al menos una: si apagás las dos, se mantiene el retiro.</p>`)}
            </div>
            <div class="sec" data-sec="imagenes">${B.media}</div>
            <div class="sec" data-sec="fondo">${B.fondo}</div>
            <div class="sec" data-sec="estilo">
              ${B.colores}
              ${B.forma}
              ${card('Formas y estilos', `<div class="field"><label>Tarjetas de producto</label>${seg('radius', [['sharp', 'Cuadradas 4px'], ['round', 'Redondeadas'], ['industrial', 'Industrial']], t.radius, 'seg3')}</div>
                <div class="field" style="margin-bottom:0"><label>Grilla en el celular</label>${seg('cols', [[1, '1 columna'], [2, '2 columnas']], t.cols)}</div>`)}
            </div>
            <div class="save-row"><span class="hint" data-dirty>${dr.dirty ? 'Cambios sin guardar' : ''}</span><button class="btn" data-discard ${dr.dirty ? '' : 'hidden'}>Descartar</button><button class="btn btn-primary" data-save>Guardar diseño</button></div>
          </div>
          <div class="pane pane-products"><div class="card">${ps.length ? ps.map(p => `<div class="prod-row"><div>${p.images[0] ? `<img class="prod-th" src="${p.images[0]}" alt="">` : `<span class="prod-th">${esc(p.name[0].toUpperCase())}</span>`}<div style="min-width:0"><strong>${esc(p.name)}</strong> <span class="pill-stock ${p.active ? '' : 'pill-off'}">${p.active ? 'Activo' : 'Inactivo'}</span><p>${ars(p.price)} · ${p.stock} en stock${p.category ? ' · ' + esc(p.category) : ''} · ${p.images.length} foto${p.images.length === 1 ? '' : 's'}</p></div></div>
            <div class="act"><button class="btn btn-sm" data-edit="${p.id}">Editar</button><button class="btn btn-sm" data-tog="${p.id}">${p.active ? 'Desactivar' : 'Activar'}</button><button class="btn btn-sm btn-danger" data-del="${p.id}" aria-label="Eliminar">${icon('close', 16)}</button></div></div>`).join('') : '<div class="empty">Creá tu primer producto para armar el catálogo.</div>'}</div></div>
        </div>
        <div class="cb-prev"><div class="prev-bar"><strong>Vista Previa en Vivo</strong><div class="seg"><label><input type="radio" name="vp" value="m" ${state.cbWide ? '' : 'checked'}><span>Móvil</span></label><label><input type="radio" name="vp" value="d" ${state.cbWide ? 'checked' : ''}><span>Escritorio</span></label></div></div>
          <div class="phone" data-frame><div class="dbar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(url.replace(/^https?:\/\//, ''))}</span></div><div class="stage" data-stage><div class="vp" data-preview></div></div></div></div>
      </div>`;
    const ctl = mountStore(el.querySelector('[data-preview]'), { store: preview(), products: ps });
    const cb = el.querySelector('.cb'), design = el.querySelector('[data-design]'), lp = el.querySelector('[data-logoprev]'), dirty = el.querySelector('[data-dirty]');
    const drawLogo = () => { lp.innerHTML = dr.logo ? `<img src="${dr.logo}" alt="Logo">` : icon('store', 26); };
    const discard = design.querySelector('[data-discard]');
    const sync = () => {
      BD.collect(design, dr.theme); bd.hint(); BD.paint(design, dr.theme);
      dr.dirty = true; dirty.textContent = 'Cambios sin guardar'; discard.hidden = false; ctl.update({ store: preview() });
    };
    discard.onclick = () => { state.draft = null; refresh(); };
    // Secciones del editor
    design.querySelectorAll('[data-sec-btn]').forEach(b => b.onclick = () => {
      state.cbSec = design.dataset.s = b.dataset.secBtn;
      design.querySelectorAll('[data-sec-btn]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    });
    // Vista de escritorio real: el sitio se dibuja a 1280 px de ancho y se achica para que entre en el marco
    const stage = el.querySelector('[data-stage]'), vp = el.querySelector('[data-preview]');
    const fitPreview = () => {
      if (!state.cbWide) { vp.style.cssText = ''; return; }
      const w = stage.clientWidth, h = stage.clientHeight; if (!w) return;
      const k = Math.min(1, w / 1280); vp.style.cssText = `width:1280px;height:${h / k}px;transform:scale(${k})`;
    };
    if (window.ResizeObserver) new ResizeObserver(fitPreview).observe(stage);
    design.addEventListener('input', e => { if (e.target.id !== 'logoIn' && !e.target.dataset.up) sync(); }); design.addEventListener('change', e => { if (e.target.type === 'radio') sync(); });
    const bd = BD.bind(design, dr.theme, sync); bd.hint(); BD.paint(design, dr.theme); BD.mediaBind(design, dr.theme, sync, toast);
    design.querySelector('#logoIn').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { dr.logo = await imgToData(f, 256, 'image/png'); dr.logoDirty = true; drawLogo(); sync(); } catch (err) { toast(err.message); }
    };
    design.querySelector('[data-nologo]').onclick = () => { dr.logo = null; dr.logoDirty = true; drawLogo(); sync(); };
    design.querySelector('[data-save]').onclick = async e => {
      e.currentTarget.disabled = true;
      try { state.user = await api('/store/design', { method: 'PUT', body: { theme: dr.theme, logo: dr.logoDirty ? (dr.logo || '') : null } }); state.draft = null; toast('Diseño guardado'); refresh(); }
      catch (err) { toast(err.message); e.currentTarget.disabled = false; }
    };
    cb.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { state.cbTab = cb.dataset.tab = b.dataset.t; cb.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('active', x === b)); });
    el.querySelectorAll('[name=vp]').forEach(r => r.onchange = () => { state.cbWide = r.value === 'd'; cb.classList.toggle('wide', state.cbWide); fitPreview(); });
    fitPreview();
    drawLogo();
    el.querySelector('[data-new]').onclick = () => openProductModal(); el.querySelector('[data-copy]').onclick = () => copyText(url);
    el.querySelector('[data-qr]').onclick = () => openModal({ title: 'Código QR del catálogo', hideSubmit: true, html: `<div class="qr"><img src="/api/public/${u.slug}/qr.svg" alt="Código QR del catálogo"><code>${esc(url)}</code>
      <div class="qr-actions"><a class="btn" download="affari-catalogo-qr.svg" href="/api/public/${u.slug}/qr.svg">Descargar QR</a><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Mirá el catálogo de ${u.business}: ${url}`)}">${icon('whatsapp', 16)}Compartir por WhatsApp</a></div></div>` });
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openProductModal(ps.find(p => p.id == b.dataset.edit)));
    el.querySelectorAll('[data-tog]').forEach(b => b.onclick = async () => { const p = ps.find(p => p.id == b.dataset.tog); await api(`/products/${p.id}`, { method: 'PUT', body: { ...p, active: !p.active } }); toast(p.active ? 'Producto desactivado' : 'Producto activado'); refresh(); });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const p = ps.find(p => p.id == b.dataset.del); if (!confirm(`¿Eliminar "${p.name}"?`)) return; await api(`/products/${p.id}`, { method: 'DELETE' }); toast('Producto eliminado'); refresh(); });
  },
  async config(el) {
    const u = state.user;
    el.innerHTML = head('Configuración', 'Datos del negocio, enlace del catálogo y mensaje de cobro.') + `<div class="card cfg"><div class="section-title">Mi negocio</div><form id="cfg">
      <div class="error hidden" data-err role="alert"></div>${fld('Nombre del negocio', `<input id="cn" required value="${esc(u.business)}">`, 'cn')}
      ${fld('Tipo de negocio', `<select id="ct">${BUSINESS_TYPES.map(t => `<option ${t === u.business_type ? 'selected' : ''}>${t}</option>`).join('')}</select>`, 'ct')}
      ${fld('Enlace del catálogo', `<div class="slug-in"><span>${esc(location.host)}/c/</span><input id="cs" required pattern="[a-z0-9\\-]{3,40}" value="${esc(u.slug)}"></div>`, 'cs')}
      <div class="field"><label for="ctpl">Mensaje de recordatorio de cobro</label><textarea id="ctpl">${esc(u.reminder_tpl)}</textarea><small class="hint">Variables: {cliente}, {saldo}, {negocio}</small></div>
      <p class="muted" style="margin-bottom:14px">Cuenta: ${esc(u.name)} · ${esc(u.email)} · ${esc(u.phone)}</p><button class="btn btn-primary">Guardar cambios</button></form></div>`;
    el.querySelector('#cfg').onsubmit = async e => {
      e.preventDefault();
      try {
        state.user = await api('/store', { method: 'PUT', body: { name: el.querySelector('#cn').value, type: el.querySelector('#ct').value, slug: el.querySelector('#cs').value, reminder_tpl: el.querySelector('#ctpl').value } });
        toast('Cambios guardados'); renderShell(); renderView(true);
      } catch (err) { const m = el.querySelector('[data-err]'); m.textContent = err.message; m.classList.remove('hidden'); }
    };
  }
};
