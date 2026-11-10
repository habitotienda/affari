/* Importador de catálogo de Treinta. Usa openModal, fld, api, esc, icon, ars, toast y done (views.js).
   Cargalo DESPUÉS de views.js. Se abre con openTreintaImport(). */
const TZ_BATCH = 25;   // productos por request al guardar (evita timeouts al descargar fotos)

function openTreintaImport() {
  let items = null;    // null = paso 1 (pedir URL) · array = paso 2 (vista previa)
  const { form, close } = openModal({
    title: 'Importar desde Treinta', wide: true, submit: 'Importar catálogo',
    html: `<div data-step1>${fld('Link público de tu tienda en Treinta', '<input id="tzu" type="url" inputmode="url" autocomplete="off" placeholder="https://treinta.co/..." required>', 'tzu')}
        <small class="hint">Se leen nombre, precio, foto, descripción y categoría. El costo queda en $0: no figura en la tienda pública y lo completás vos después.</small></div>
      <div class="tz-load hidden" data-load role="status" aria-live="polite"><span class="tz-spin" aria-hidden="true"></span><span data-load-txt>Leyendo el catálogo…</span></div>
      <div class="hidden" data-step2></div>`,
    onSubmit: async (f, closeFn) => {
      const btn = f.querySelector('[data-submit]'), load = f.querySelector('[data-load]'), txt = f.querySelector('[data-load-txt]');
      const busy = (on, msg = '') => { load.classList.toggle('hidden', !on); txt.textContent = msg; };
      const label = btn.textContent;
      try {
        if (!items) {                                              // ---- paso 1: scrapear
          f.querySelector('[data-step1]').classList.add('hidden'); btn.textContent = 'Importando…'; busy(true, 'Leyendo el catálogo… puede tardar unos segundos');
          let r;
          try { r = await api('/import/treinta', { method: 'POST', body: { url: f.querySelector('#tzu').value.trim() } }); }
          catch (err) { f.querySelector('[data-step1]').classList.remove('hidden'); throw err; }
          items = r.products.map(p => ({ ...p, sel: !p.exists }));
          drawPreview(f, r, items); btn.textContent = saveLabel(items); btn.disabled = !items.some(i => i.sel); busy(false);
          return;
        }
        const chosen = items.filter(i => i.sel);                  // ---- paso 2: guardar en lotes
        let created = 0, skipped = 0, imgFail = 0;
        for (let i = 0; i < chosen.length; i += TZ_BATCH) {
          busy(true, `Guardando productos y fotos… ${Math.min(i + TZ_BATCH, chosen.length)}/${chosen.length}`); btn.textContent = 'Guardando…';
          const r = await api('/import/treinta/save', { method: 'POST', body: { products: chosen.slice(i, i + TZ_BATCH).map(p => ({
            name: p.name, price: Number(p.price) || 0, description: p.description || '', category: p.category || '', stock: Number(p.stock) || 0, image: p.image || '', images: p.images || [] })) } });
          created += r.created; skipped += r.skipped_duplicates; imgFail += r.images_failed;
        }
        busy(false);
        await done(closeFn, `${created} producto${created === 1 ? '' : 's'} importado${created === 1 ? '' : 's'}` + (skipped ? ` · ${skipped} ya existían` : '') + (imgFail ? ` · ${imgFail} foto(s) no se pudieron descargar` : ''));
      } catch (err) { busy(false); btn.textContent = items ? saveLabel(items) : 'Importar catálogo'; throw err; }
    } });
}

const saveLabel = items => { const n = items.filter(i => i.sel).length; return n ? `Guardar ${n} producto${n === 1 ? '' : 's'}` : 'Elegí al menos uno'; };

function drawPreview(form, r, items) {
  const box = form.querySelector('[data-step2]'), btn = form.querySelector('[data-submit]');
  const dup = items.filter(i => i.exists).length;
  box.innerHTML = `<p class="tz-sum"><strong>${items.length}</strong> producto${items.length === 1 ? '' : 's'} encontrado${items.length === 1 ? '' : 's'}${r.store ? ` en <strong>${esc(r.store)}</strong>` : ''}.
      ${dup ? `<span class="muted">${dup} ya existe${dup === 1 ? '' : 'n'} en tu inventario y vienen sin marcar.</span>` : ''}</p>
    <div class="tbl-wrap tz-tbl"><table><thead><tr><th><input type="checkbox" data-all aria-label="Seleccionar todos" ${items.some(i => i.sel) ? 'checked' : ''}></th><th>Foto</th><th>Producto</th><th class="num">Precio</th><th class="num">Costo</th></tr></thead>
      <tbody>${items.map((p, i) => `<tr data-i="${i}"><td><input type="checkbox" data-sel ${p.sel ? 'checked' : ''} aria-label="Importar ${esc(p.name)}"></td>
        <td>${p.image ? `<img class="tz-th" src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tz-th tz-noimg'}))">` : '<span class="tz-th tz-noimg"></span>'}</td>
        <td><input class="tz-in" data-name value="${esc(p.name)}" maxlength="120" aria-label="Nombre">${p.category ? `<small class="hint">${esc(p.category)}</small>` : ''}${p.exists ? ' <span class="pill-stock pill-off">Ya existe</span>' : ''}</td>
        <td class="num"><input class="tz-in tz-num" data-price type="number" min="0" step="any" value="${p.price}" aria-label="Precio"></td>
        <td class="num muted">$0</td></tr>`).join('')}</tbody></table></div>
    <small class="hint">Podés corregir nombre y precio antes de guardar. Los precios se importan tal como están publicados en Treinta (sin conversión de moneda).</small>`;
  box.classList.remove('hidden');
  const sync = () => { btn.textContent = saveLabel(items); btn.disabled = !items.some(i => i.sel); box.querySelector('[data-all]').checked = items.every(i => i.sel); };
  box.onchange = e => {
    const tr = e.target.closest('tr[data-i]'), p = tr && items[+tr.dataset.i];
    if (e.target.matches('[data-all]')) { items.forEach(i => i.sel = e.target.checked); box.querySelectorAll('[data-sel]').forEach(c => c.checked = e.target.checked); }
    else if (p && e.target.matches('[data-sel]')) p.sel = e.target.checked;
    sync();
  };
  box.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('input')) e.preventDefault(); };   // Enter al editar no debe guardar todo
  box.oninput = e => {
    const tr = e.target.closest('tr[data-i]'), p = tr && items[+tr.dataset.i]; if (!p) return;
    if (e.target.matches('[data-name]')) p.name = e.target.value; else if (e.target.matches('[data-price]')) p.price = e.target.value;
  };
  sync();
}
