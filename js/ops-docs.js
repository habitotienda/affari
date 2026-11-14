/* Parte 5 (2/2): inventario con variantes y alertas rojas. */

/* ---------- Inventario ---------- */
const isLow = x => x.stock <= x.min_stock;                                   // producto o variante
const prodLow = p => p.variants.length ? p.variants.some(isLow) : isLow(p);

VIEWS.inventario = async function (el) {
  const ps = await api('/products'), lowN = ps.filter(prodLow).length, units = ps.reduce((s, p) => s + p.stock, 0);
  const cost = ps.reduce((s, p) => s + (p.variants.length ? p.variants.reduce((t, v) => t + v.stock * (v.cost || p.cost), 0) : p.stock * p.cost), 0);
  const retail = ps.reduce((s, p) => s + (p.variants.length ? p.variants.reduce((t, v) => t + v.stock * (v.price || p.price), 0) : p.stock * p.price), 0);
  const only = state.invLow ? 'low' : 'all';
  el.innerHTML = head('Inventario & Stock', `${ps.length} productos · ${units} unidades`, `<button class="btn ai-pencil-btn" data-aiall title="Generar con IA la descripción de los productos que no tienen">${icon('edit', 16)}<span>Descripciones IA</span></button><button class="btn" data-stock>${icon('box')}Ingresar stock</button><button class="btn btn-primary" data-new>${icon('plus')}Nuevo producto</button>`) + `
    <section class="kpis"><div class="card kpi ${lowN ? 'alert-k' : ''}"><span>${lowN ? '⚠ ' : ''}Stock bajo</span><strong>${lowN}</strong><small>${lowN ? 'Reponelos para no perder ventas' : 'Todo el stock está en orden'}</small></div>
      <div class="card kpi"><span>Productos</span><strong>${ps.length}</strong><small>${ps.filter(p => p.variants.length).length} con variantes</small></div>
      <div class="card kpi"><span>Valor a costo</span><strong>${ars(cost)}</strong><small>Lo que invertiste en mercadería</small></div>
      <div class="card kpi pos"><span>Valor a precio de venta</span><strong>${ars(retail)}</strong><small>Ganancia potencial ${ars(retail - cost)}</small></div></section>
    <div class="toolbar-row"><input class="search-in" type="search" placeholder="Buscar producto o categoría…" aria-label="Buscar producto" data-q>
      <div class="seg" style="min-width:230px"><label><input type="radio" name="invf" value="all" ${only === 'all' ? 'checked' : ''}><span>Todos</span></label><label><input type="radio" name="invf" value="low" ${only === 'low' ? 'checked' : ''}><span>Solo stock bajo</span></label></div></div>
    <div class="card tbl-wrap" data-list></div>`;
  const list = el.querySelector('[data-list]'), pill = x => `<span class="pill-stock ${isLow(x) ? 'low' : ''}">${x.stock} u.</span>`;
  const draw = () => {
    const q = (state.iq || '').toLowerCase(), rows = ps.filter(p => (!state.invLow || prodLow(p)) && (!q || (p.name + ' ' + p.category).toLowerCase().includes(q)));
    list.innerHTML = rows.length ? `<p class="tbl-hint">${icon('edit', 14)}Tocá un producto para editarlo, sumar stock o ver sus variantes</p><table><thead><tr><th>Producto</th><th class="num">Costo</th><th class="num">Precio</th><th>Stock</th><th></th></tr></thead><tbody>${rows.map(p => {
      const hv = p.variants.length, low = prodLow(p);
      return `<tr class="row-prod ${low ? 'row-low' : ''}" data-prow="${p.id}"><td><div class="inv-prod">${p.images && p.images[0] ? `<img class="prod-th" src="${esc(p.images[0])}" alt="" loading="lazy" decoding="async">` : `<span class="prod-th">${esc((p.name[0] || '?').toUpperCase())}</span>`}<div><strong>${esc(p.name)}</strong>${p.category ? `<span class="cell-sub">${esc(p.category)}</span>` : ''}${p.active ? '' : ' <span class="pill-stock pill-off">Inactivo</span>'}${hv ? `<span class="var-chip">${p.variants.length} variantes</span>` : ''}${low ? '<span class="low-tag">Stock bajo</span>' : ''}</div></div></td>
        <td class="num">${ars(p.cost)}</td><td class="num">${ars(p.price)}</td><td>${hv ? `<span class="pill-stock ${p.variants.some(isLow) ? 'low' : ''}">${p.stock} u. en total</span>` : pill(p)}</td>
        <td><div class="act">${hv ? '' : `<button class="btn btn-sm" data-in="${p.id}">+ Stock</button>`}<button class="btn btn-sm" data-var="${p.id}">Variantes</button><button class="btn btn-sm" data-edit="${p.id}">Editar</button></div></td></tr>`
        + p.variants.map(v => `<tr class="row-var ${isLow(v) ? 'row-low' : ''}" data-vrow="${v.id}"><td>↳ ${esc(v.name)}${v.sku ? ` <span class="cell-sub" style="display:inline">· ${esc(v.sku)}</span>` : ''}${isLow(v) ? '<span class="low-tag">Stock bajo</span>' : ''}</td><td class="num">${ars(v.cost || p.cost)}</td><td class="num">${ars(v.price || p.price)}</td><td>${pill(v)} <span class="cell-sub" style="display:inline">mín. ${v.min_stock}</span></td><td><div class="act"><button class="btn btn-sm" data-vin="${v.id}">+ Stock</button></div></td></tr>`).join('');
    }).join('')}</tbody></table>` : `<div class="empty">${ps.length ? 'No hay productos con esos filtros.' : 'Todavía no cargaste productos.'}</div>`;
    /* Celular en vertical: las acciones quedan a la derecha de la tabla, fuera de la vista. Tocar la fila abre un menú con las mismas acciones. */
    const phone = () => matchMedia('(max-width:700px)').matches;
    list.onclick = e => {
      if (!phone() || e.target.closest('button,a,input,select,textarea,label')) return;
      const vr = e.target.closest('[data-vrow]'), pr = e.target.closest('[data-prow]');
      if (vr) {
        const p = ps.find(p => p.variants.some(v => v.id == vr.dataset.vrow)), v = p && p.variants.find(v => v.id == vr.dataset.vrow); if (!v) return;
        const m = openModal({ title: `${p.name} · ${v.name}`, hideSubmit: true, html: `<div class="act-sheet"><button type="button" class="btn" data-a="vin">${icon('plus', 18)}<span>+ Stock</span><small>Hay ${v.stock} u.</small></button></div>` });
        m.form.querySelector('[data-a=vin]').onclick = () => { m.close(); openVariantStockModal(p, v); };
        return;
      }
      if (!pr) return;
      const p = ps.find(p => p.id == pr.dataset.prow); if (!p) return;
      const hv = p.variants.length, low = prodLow(p);
      const m = openModal({ title: 'Producto', hideSubmit: true, html: `<div class="act-sheet">
        <div class="as-head">${p.images && p.images[0] ? `<img class="prod-th" src="${esc(p.images[0])}" alt="">` : `<span class="prod-th">${esc((p.name[0] || '?').toUpperCase())}</span>`}
          <div><strong>${esc(p.name)}</strong>${p.category ? `<span class="cell-sub">${esc(p.category)}</span>` : ''}${p.active ? '' : '<span class="pill-stock pill-off">Inactivo</span>'}</div></div>
        <div class="as-stats"><div><small>Costo</small><strong>${ars(p.cost)}</strong></div><div><small>Precio</small><strong>${ars(p.price)}</strong></div>
          <div class="${low ? 'low' : ''}"><small>${hv ? 'Unidades en total' : 'Unidades'}</small><strong>${p.stock} u.</strong></div></div>
        ${low ? '<p class="as-low">Stock bajo: conviene reponerlo.</p>' : ''}
        <div class="as-btns">${hv ? '' : `<button type="button" class="btn btn-primary" data-a="in">${icon('plus', 18)}<span>+ Stock</span></button>`}
          <button type="button" class="btn" data-a="var">${icon('sliders', 18)}<span>Variantes${hv ? ` (${hv})` : ''}</span></button>
          <button type="button" class="btn ${hv ? 'btn-primary' : ''}" data-a="edit">${icon('edit', 18)}<span>Editar</span></button></div></div>` });
      const go = (k, fn) => { m.form.querySelector(`[data-a=${k}]`)?.addEventListener('click', () => { m.close(); fn(); }); };
      go('edit', () => openProductModal(p)); go('in', () => openStockModal(p.id)); go('var', () => openVariantsModal(p.id));
    };
    list.querySelectorAll('[data-in]').forEach(b => b.onclick = () => openStockModal(+b.dataset.in));
    list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openProductModal(ps.find(p => p.id == b.dataset.edit)));
    list.querySelectorAll('[data-var]').forEach(b => b.onclick = () => openVariantsModal(+b.dataset.var));
    list.querySelectorAll('[data-vin]').forEach(b => b.onclick = () => { const p = ps.find(p => p.variants.some(v => v.id == b.dataset.vin)); openVariantStockModal(p, p.variants.find(v => v.id == b.dataset.vin)); });
  };
  const q = el.querySelector('[data-q]'); q.value = state.iq || ''; q.oninput = () => { state.iq = q.value; draw(); };
  el.querySelectorAll('[name=invf]').forEach(r => r.onchange = () => { state.invLow = r.value === 'low'; draw(); });
  el.querySelector('[data-aiall]').onclick = e => fillMissingDescriptions(ps, e.currentTarget);
  el.querySelector('[data-stock]').onclick = () => openStockModal(); el.querySelector('[data-new]').onclick = () => openProductModal(); draw();
};

function openVariantStockModal(p, v) {
  openModal({ title: `Ingresar stock · ${p.name}`, submit: 'Sumar al inventario',
    html: `<p class="muted" style="margin-bottom:14px">${esc(v.name)} · hay <strong>${v.stock}</strong> u.</p>` + fld('Unidades que ingresan', '<input id="q" type="number" min="1" value="1" required>', 'q'),
    onSubmit: async (f, close) => { await api(`/variants/${v.id}/stock`, { method: 'POST', body: { qty: num(f, '#q') } }); await done(close, 'Stock actualizado'); } });
}

/* Editor de variantes: cada fila se guarda por separado; el stock del producto es la suma */
async function openVariantsModal(pid) {
  const { form } = openModal({ title: 'Variantes del producto', wide: true, hideSubmit: true, html: '<div data-vbox><div class="empty">Cargando…</div></div>' });
  const box = form.querySelector('[data-vbox]'), inp = (k, v, t = 'text', extra = '') => `<input data-k="${k}" type="${t}" value="${esc(v)}" ${extra} aria-label="${k}">`;
  const row = v => `<div class="var-row ${v.id && isLow(v) ? 'low' : ''}" data-id="${v.id || ''}">${inp('name', v.name || '', 'text', 'placeholder="Ej: Talle M / Rojo" maxlength="60"')}${inp('sku', v.sku || '', 'text', 'placeholder="SKU (opcional)" maxlength="40"')}${inp('price', v.price || 0, 'number', 'min="0" step="any"')}${inp('cost', v.cost || 0, 'number', 'min="0" step="any"')}${inp('stock', v.stock ?? 0, 'number', 'min="0"')}${inp('min_stock', v.min_stock ?? 2, 'number', 'min="0"')}
    <div class="act"><button type="button" class="btn btn-sm ${v.id ? '' : 'btn-primary'}" data-save>${v.id ? 'Guardar' : '+ Agregar'}</button>${v.id ? `<button type="button" class="btn btn-sm btn-danger" data-del aria-label="Eliminar variante">${icon('close', 16)}</button>` : ''}</div></div>`;
  const load = async () => {
    const p = (await api('/products')).find(x => x.id === pid); if (!p) return;
    box.innerHTML = `<p class="muted" style="margin-bottom:12px"><strong>${esc(p.name)}</strong> · precio ${ars(p.price)} · costo ${ars(p.cost)}. Dejá precio o costo en 0 para usar los del producto. El stock total (${p.stock} u.) se calcula sumando las variantes.</p>${!p.variants.length && p.stock > 0 ? `<div class="banner">Hoy este producto tiene ${p.stock} u. sin variante. Al crear la primera variante, el stock pasa a ser la suma de las variantes: cargá esas ${p.stock} u. dentro de ella para no perderlas.</div>` : ''}
      <div class="var-head"><span>Variante</span><span>SKU</span><span>Precio</span><span>Costo</span><span>Stock</span><span>Alerta</span><span></span></div>${p.variants.map(row).join('')}<p class="hint" style="margin:14px 0 6px;font-weight:700">Nueva variante</p>${row({})}`;
  };
  box.onclick = async e => {
    const r = e.target.closest('.var-row'), save = e.target.closest('[data-save]'), del = e.target.closest('[data-del]'); if (!r || (!save && !del)) return;
    const body = { name: r.querySelector('[data-k=name]').value.trim() }; r.querySelectorAll('input').forEach(i => { if (i.dataset.k !== 'name' && i.dataset.k !== 'sku') body[i.dataset.k] = Number(i.value) || 0; }); body.sku = r.querySelector('[data-k=sku]').value;
    try {
      if (del) { if (!confirm('¿Eliminar esta variante y su stock?')) return; await api(`/variants/${r.dataset.id}`, { method: 'DELETE' }); }
      else if (r.dataset.id) await api(`/variants/${r.dataset.id}`, { method: 'PUT', body });
      else await api(`/products/${pid}/variants`, { method: 'POST', body });
      toast(del ? 'Variante eliminada' : 'Variante guardada'); await load(); refresh();
    } catch (err) { toast(err.message); }
  };
  await load();
}
