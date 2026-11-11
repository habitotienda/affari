/* Parte 5 (2/2): inventario con variantes y alertas rojas, comprobantes y datos fiscales (estructura AFIP). */

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
    list.innerHTML = rows.length ? `<table><thead><tr><th>Producto</th><th class="num">Costo</th><th class="num">Precio</th><th>Stock</th><th></th></tr></thead><tbody>${rows.map(p => {
      const hv = p.variants.length, low = prodLow(p);
      return `<tr class="${low ? 'row-low' : ''}"><td><div class="inv-prod">${p.images && p.images[0] ? `<img class="prod-th" src="${esc(p.images[0])}" alt="" loading="lazy" decoding="async">` : `<span class="prod-th">${esc((p.name[0] || '?').toUpperCase())}</span>`}<div><strong>${esc(p.name)}</strong>${p.category ? `<span class="cell-sub">${esc(p.category)}</span>` : ''}${p.active ? '' : ' <span class="pill-stock pill-off">Inactivo</span>'}${hv ? `<span class="var-chip">${p.variants.length} variantes</span>` : ''}${low ? '<span class="low-tag">Stock bajo</span>' : ''}</div></div></td>
        <td class="num">${ars(p.cost)}</td><td class="num">${ars(p.price)}</td><td>${hv ? `<span class="pill-stock ${p.variants.some(isLow) ? 'low' : ''}">${p.stock} u. en total</span>` : pill(p)}</td>
        <td><div class="act">${hv ? '' : `<button class="btn btn-sm" data-in="${p.id}">+ Stock</button>`}<button class="btn btn-sm" data-var="${p.id}">Variantes</button><button class="btn btn-sm" data-edit="${p.id}">Editar</button></div></td></tr>`
        + p.variants.map(v => `<tr class="row-var ${isLow(v) ? 'row-low' : ''}"><td>↳ ${esc(v.name)}${v.sku ? ` <span class="cell-sub" style="display:inline">· ${esc(v.sku)}</span>` : ''}${isLow(v) ? '<span class="low-tag">Stock bajo</span>' : ''}</td><td class="num">${ars(v.cost || p.cost)}</td><td class="num">${ars(v.price || p.price)}</td><td>${pill(v)} <span class="cell-sub" style="display:inline">mín. ${v.min_stock}</span></td><td><div class="act"><button class="btn btn-sm" data-vin="${v.id}">+ Stock</button></div></td></tr>`).join('');
    }).join('')}</tbody></table>` : `<div class="empty">${ps.length ? 'No hay productos con esos filtros.' : 'Todavía no cargaste productos.'}</div>`;
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

/* ---------- Datos fiscales ---------- */
function openFiscalModal(fis) {
  const v = k => esc(fis[k] ?? '');
  openModal({ title: 'Datos fiscales', wide: true, submit: 'Guardar datos fiscales',
    html: `<p class="muted" style="margin-bottom:14px">Estos datos aparecen en tus comprobantes y definen qué tipo de factura podés emitir.</p>
      ${fld('Razón social o nombre y apellido', `<input id="rs" maxlength="100" value="${v('razon_social')}">`, 'rs')}
      <div class="row2">${fld('CUIT', `<input id="cu" inputmode="numeric" maxlength="13" placeholder="20-12345678-6" value="${v('cuit')}">`, 'cu')}${fld('Condición frente al IVA', `<select id="ci">${['Monotributo', 'Responsable Inscripto', 'Exento'].map(c => `<option ${c === fis.cond_iva ? 'selected' : ''}>${c}</option>`).join('')}</select>`, 'ci')}
      ${fld('Punto de venta', `<input id="pv" type="number" min="1" max="99999" value="${fis.pto_vta}">`, 'pv')}${fld('Inicio de actividades', `<input id="ia" type="date" value="${v('inicio_actividades')}">`, 'ia')}
      ${fld('Domicilio comercial', `<input id="dm" maxlength="160" value="${v('domicilio')}">`, 'dm')}${fld('Ingresos Brutos', `<input id="ib" maxlength="30" value="${v('ingresos_brutos')}">`, 'ib')}</div>
      <label class="check"><input id="ae" type="checkbox" ${fis.afip_enabled ? 'checked' : ''}>Activar facturación electrónica AFIP</label>
      <div class="field"><label>Entorno</label><div class="seg"><label><input type="radio" name="env" value="homologacion" ${fis.afip_env !== 'produccion' ? 'checked' : ''}><span>Homologación (pruebas)</span></label><label><input type="radio" name="env" value="produccion" ${fis.afip_env === 'produccion' ? 'checked' : ''}><span>Producción</span></label></div></div>
      <p class="hint">Hoy los comprobantes A, B y C quedan <strong>pendientes de CAE</strong>: la conexión con los servicios de AFIP (WSAA/WSFE) requiere tu certificado digital y se integra en <code>backend/afip.py</code>. Los comprobantes X funcionan completos.</p>`,
    onSubmit: async (f, close) => {
      await api('/fiscal', { method: 'PUT', body: { razon_social: f.querySelector('#rs').value, cuit: f.querySelector('#cu').value, cond_iva: f.querySelector('#ci').value, pto_vta: num(f, '#pv') || 1, domicilio: f.querySelector('#dm').value,
        inicio_actividades: f.querySelector('#ia').value, ingresos_brutos: f.querySelector('#ib').value, afip_enabled: f.querySelector('#ae').checked, afip_env: f.querySelector('input[name=env]:checked').value } });
      await done(close, 'Datos fiscales guardados');
    } });
}

/* ---------- Comprobantes ---------- */
const TYPE_LBL = { X: 'Comprobante X (no fiscal)', A: 'Factura A', B: 'Factura B', C: 'Factura C' };
const AFIP_BADGE = { no_fiscal: ['b-nofiscal', 'No fiscal'], pendiente: ['b-pend', 'Pendiente CAE'], aprobado: ['b-ok', 'Autorizado'], rechazado: ['b-anul', 'Rechazado'] };

async function openInvoiceView(id) {
  const i = await api('/invoices/' + id), [bc, bl] = AFIP_BADGE[i.afip_status] || AFIP_BADGE.no_fiscal, canVoid = i.status === 'emitido' && !i.cae, isABz = i.type === 'A' || i.type === 'B';
  const { form, close } = openModal({ title: `${i.type === 'X' ? 'Comprobante X' : 'Factura ' + i.type} ${i.full_number}`, wide: true, hideSubmit: true,
    html: `<div class="inv-view"><p style="margin-bottom:12px"><span class="badge ${bc}">${bl}</span> ${i.status === 'anulado' ? '<span class="badge b-anul">Anulado</span>' : ''}</p>
      <dl><dt>Fecha</dt><dd>${dmy(i.issue_date)}</dd><dt>Cliente</dt><dd>${esc(i.client_name)}${i.client_doc !== '0' ? ' · ' + esc(i.client_doc) : ''}</dd><dt>Condición IVA</dt><dd>${esc(i.client_iva)}</dd><dt>Medio de pago</dt><dd>${esc(i.method)}</dd>${i.cae ? `<dt>CAE</dt><dd>${esc(i.cae)} · vence ${dmy(i.cae_due)}</dd>` : ''}</dl>
      <div class="tbl-wrap"><table><thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Subtotal</th></tr></thead><tbody>${i.items.map(x => `<tr><td>${esc(x.description)}</td><td class="num">${x.qty}</td><td class="num">${ars2(x.unit_price)}</td><td class="num">${ars2(x.qty * x.unit_price)}</td></tr>`).join('')}</tbody></table></div>
      ${isABz ? `<p class="muted" style="text-align:right">Neto ${ars2(i.net)} · IVA ${ars2(i.iva)}</p>` : ''}<div class="tot">Total ${ars2(i.total)}</div>
      ${i.type !== 'X' && !i.cae ? '<p class="hint">Sin CAE: este comprobante todavía no es válido como factura. Se autoriza cuando se conecte AFIP.</p>' : ''}
      <div class="toolbar"><button type="button" class="btn btn-primary" data-pdf>${icon('download', 16)}Descargar PDF</button>${canVoid ? '<button type="button" class="btn btn-danger" data-void>Anular comprobante</button>' : ''}</div></div>` });
  form.querySelector('[data-pdf]').onclick = async e => { e.currentTarget.disabled = true; try { await opsDownload(`/invoices/${id}/pdf`, `comprobante-${i.full_number}.pdf`); } catch (err) { toast(err.message); } e.currentTarget.disabled = false; };
  const v = form.querySelector('[data-void]');
  if (v) v.onclick = async () => { if (!confirm('Se anula el comprobante, se devuelve el stock y se revierte la venta. ¿Continuar?')) return; try { await api(`/invoices/${id}/annul`, { method: 'POST' }); close(); toast('Comprobante anulado'); refresh(); } catch (err) { toast(err.message); } };
}

async function openInvoiceModal(fis) {
  const [clients, products] = await Promise.all([api('/clients'), api('/products')]), avail = products.filter(p => p.active && p.stock > 0);
  const items = [{ product_id: null, variant_id: null, description: '', qty: 1, unit_price: '', iva_rate: 21 }];
  const types = fis.allowed_types, abz = () => ['A', 'B'].includes(cur.type);
  const cur = { type: types.includes('X') ? 'X' : types[0] };
  const { form } = openModal({ title: 'Nuevo comprobante', wide: true, submit: 'Emitir comprobante',
    html: `<div class="row2">${fld('Tipo de comprobante', `<select id="ty">${types.map(t => `<option value="${t}">${TYPE_LBL[t]}</option>`).join('')}</select>`, 'ty')}
        ${fld('Cliente', `<select id="cl"><option value="">Consumidor Final</option>${clients.map(c => `<option value="${c.id}">${esc(c.name)}${c.balance > 0 ? ' · debe ' + ars(c.balance) : ''}</option>`).join('')}</select>`, 'cl')}
        ${fld('Condición IVA del cliente', `<select id="ci">${['Consumidor Final', 'Responsable Inscripto', 'Monotributo', 'Exento'].map(c => `<option>${c}</option>`).join('')}</select>`, 'ci')}
        ${fld('CUIT / DNI del cliente', '<input id="cd" inputmode="numeric" maxlength="13" placeholder="Opcional (obligatorio en Factura A)">', 'cd')}</div>
      <div class="field" data-nm><label for="nm">Nombre del cliente (si no está en tu base)</label><div class="input"><input id="nm" maxlength="100" placeholder="Consumidor Final"></div></div>
      <p class="hint hidden" data-fhint></p>
      <div class="field"><label>Ítems</label><div class="inv-items" data-items></div><button type="button" class="btn btn-sm" data-add>+ Agregar ítem</button></div>
      <div class="inv-total"><span>Total</span><span data-total>$ 0,00</span></div>
      <div class="field"><label>Medio de pago</label><div class="seg seg4">${['Efectivo', 'Transferencia', 'Tarjeta', 'Fiado'].map((m, i) => `<label><input type="radio" name="im" value="${m}" ${i ? '' : 'checked'}><span>${m}</span></label>`).join('')}</div></div>
      ${fld('Observaciones', '<input id="no" maxlength="300" placeholder="Opcional">', 'no')}`,
    onSubmit: async (f, close) => {
      const body = { type: f.querySelector('#ty').value, client_id: f.querySelector('#cl').value ? Number(f.querySelector('#cl').value) : null, client_name: f.querySelector('#nm').value, client_doc: f.querySelector('#cd').value, client_iva: f.querySelector('#ci').value,
        method: f.querySelector('input[name=im]:checked').value, notes: f.querySelector('#no').value,
        items: items.map(i => ({ product_id: i.product_id, variant_id: i.variant_id, description: i.product_id ? '' : i.description, qty: Number(i.qty) || 1, unit_price: i.unit_price === '' ? null : Number(i.unit_price), iva_rate: Number(i.iva_rate) })) };
      const r = await api('/invoices', { method: 'POST', body }); close(); toast(r.message); await refresh(); openInvoiceView(r.id);
    } });
  const $ = s => form.querySelector(s), box = $('[data-items]');
  const total = () => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  const upd = () => { $('[data-total]').textContent = ars2(total()); box.querySelectorAll('[data-sub]').forEach((s, n) => s.textContent = ars2((Number(items[n].qty) || 0) * (Number(items[n].unit_price) || 0))); };
  const draw = () => {
    box.innerHTML = items.map((it, n) => {
      const p = avail.find(x => x.id === it.product_id), vs = p ? p.variants : [];
      return `<div class="inv-it" data-n="${n}"><select data-k="product_id" aria-label="Producto"><option value="">Ítem libre (servicio, otro)</option>${avail.map(x => `<option value="${x.id}" ${x.id === it.product_id ? 'selected' : ''}>${esc(x.name)} · ${x.stock} u.</option>`).join('')}</select>
        ${p ? (vs.length ? `<select data-k="variant_id" aria-label="Variante">${vs.map(v => `<option value="${v.id}" ${v.id === it.variant_id ? 'selected' : ''} ${v.stock < 1 ? 'disabled' : ''}>${esc(v.name)} · ${v.stock} u.</option>`).join('')}</select>` : '<span class="muted">Sin variantes</span>') : `<input data-k="description" placeholder="Descripción" maxlength="120" value="${esc(it.description)}" aria-label="Descripción">`}
        <input data-k="qty" type="number" min="1" ${p ? `max="${(vs.find(v => v.id === it.variant_id) || p).stock}"` : ''} value="${it.qty}" aria-label="Cantidad">
        <input data-k="unit_price" type="number" min="0" step="any" placeholder="Precio" value="${it.unit_price}" aria-label="Precio unitario">
        ${abz() ? `<select data-k="iva_rate" aria-label="IVA">${[0, 10.5, 21, 27].map(r => `<option value="${r}" ${r == it.iva_rate ? 'selected' : ''}>IVA ${r}%</option>`).join('')}</select>` : '<span class="sub" data-sub></span>'}
        ${items.length > 1 ? `<button type="button" class="icon-btn" data-rm="${n}" aria-label="Quitar ítem">${icon('close', 16)}</button>` : '<span></span>'}</div>`;
    }).join(''); upd();
  };
  box.addEventListener('input', e => { const k = e.target.dataset.k, n = e.target.closest('.inv-it')?.dataset.n; if (k && !(e.target.tagName === 'SELECT')) { items[n][k] = e.target.value; upd(); } });
  box.addEventListener('change', e => {
    const k = e.target.dataset.k, n = e.target.closest('.inv-it')?.dataset.n; if (!k || e.target.tagName !== 'SELECT') return; const it = items[n];
    if (k === 'product_id') { const p = avail.find(x => x.id == e.target.value); it.product_id = p ? p.id : null; it.variant_id = p?.variants.find(v => v.stock > 0)?.id ?? null; const v = p?.variants.find(v => v.id === it.variant_id); it.unit_price = p ? (v?.price || p.price) : ''; }
    else if (k === 'variant_id') { it.variant_id = Number(e.target.value); const p = avail.find(x => x.id === it.product_id), v = p.variants.find(v => v.id === it.variant_id); it.unit_price = v.price || p.price; }
    else it[k] = e.target.value;
    draw();
  });
  box.onclick = e => { const r = e.target.closest('[data-rm]'); if (r) { items.splice(+r.dataset.rm, 1); draw(); } };
  $('[data-add]').onclick = () => { items.push({ product_id: null, variant_id: null, description: '', qty: 1, unit_price: '', iva_rate: 21 }); draw(); };

  // Tipo sugerido según condición fiscal y cliente; "Fiado" solo con cliente de la base
  const suggest = () => { const c = $('#ci').value; return fis.cond_iva === 'Responsable Inscripto' ? (['Responsable Inscripto', 'Monotributo'].includes(c) ? 'A' : 'B') : (types.includes('C') && fis.afip_enabled ? 'C' : 'X'); };
  const sync = () => {
    const hasC = !!$('#cl').value, fiado = form.querySelector('input[value=Fiado]');
    fiado.disabled = !hasC; fiado.nextElementSibling.style.opacity = hasC ? '' : '.45';
    if (!hasC && fiado.checked) form.querySelector('input[value=Efectivo]').checked = true;
    $('[data-nm]').classList.toggle('hidden', hasC);
    const t = $('#ty').value, hint = $('[data-fhint]'); cur.type = t;
    hint.classList.toggle('hidden', t === 'X'); hint.textContent = t === 'X' ? '' : (fis.afip_enabled ? 'Se solicitará el CAE a AFIP al emitir.' : 'Factura sin CAE: quedará pendiente de autorización hasta conectar AFIP.');
    draw();
  };
  $('#cl').onchange = () => { const c = clients.find(x => x.id == $('#cl').value); if (c) { $('#cd').value = c.cuit || ''; if (c.cuit) $('#ci').value = $('#ci').value === 'Consumidor Final' ? 'Responsable Inscripto' : $('#ci').value; } $('#ty').value = types.includes(suggest()) ? suggest() : $('#ty').value; sync(); };
  $('#ci').onchange = () => { $('#ty').value = types.includes(suggest()) ? suggest() : $('#ty').value; sync(); };
  $('#ty').value = types.includes(suggest()) ? suggest() : cur.type; $('#ty').onchange = sync; sync();
}

VIEWS.comprobantes = async function (el) {
  const [list, fis] = await Promise.all([api('/invoices'), api('/fiscal')]), ok = list.filter(i => i.status === 'emitido');
  el.innerHTML = head('Comprobantes', 'Facturas y comprobantes digitales de tus ventas.', `<button class="btn" data-fis>${icon('settings')}Datos fiscales</button><button class="btn btn-primary" data-new>${icon('plus')}Nuevo comprobante</button>`) +
    (fis.cuit_ok ? '' : `<div class="banner"><span>Cargá tu CUIT y condición fiscal para emitir Facturas A, B o C. Mientras tanto podés emitir comprobantes X (no fiscales).</span><button class="btn btn-sm" data-fis2>Completar datos</button></div>`) + `
    <section class="kpis k3"><div class="card kpi"><span>Comprobantes emitidos</span><strong>${ok.length}</strong><small>${list.length - ok.length} anulados</small></div>
      <div class="card kpi pos"><span>Total facturado</span><strong>${ars(ok.reduce((s, i) => s + i.total, 0))}</strong><small>Sin contar anulados</small></div>
      <div class="card kpi ${ok.some(i => i.afip_status === 'pendiente') ? 'alert-k' : ''}"><span>Pendientes de CAE</span><strong>${ok.filter(i => i.afip_status === 'pendiente').length}</strong><small>${fis.afip_enabled ? 'Se autorizan al conectar AFIP' : 'AFIP no está activado'}</small></div></section>
    <div class="card tbl-wrap">${list.length ? `<table><thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th>Medio</th><th>AFIP</th><th class="num">Total</th><th></th></tr></thead><tbody>${list.map(i => { const [bc, bl] = AFIP_BADGE[i.afip_status] || AFIP_BADGE.no_fiscal;
      return `<tr class="${i.status === 'anulado' ? 'void' : ''}"><td><span class="type-tag">${i.type}</span>${esc(i.full_number)}</td><td class="muted">${dmy(i.issue_date)}</td><td>${esc(i.client_name)}</td><td>${esc(i.method)}</td><td><span class="badge ${i.status === 'anulado' ? 'b-anul' : bc}">${i.status === 'anulado' ? 'Anulado' : bl}</span></td><td class="num">${ars2(i.total)}</td><td><div class="act"><button class="btn btn-sm" data-v="${i.id}">Ver</button></div></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Todavía no emitiste comprobantes. Creá el primero: descuenta stock y registra la venta en tu caja.</div>'}</div>`;
  const fiscal = () => openFiscalModal(fis);
  el.querySelector('[data-fis]').onclick = fiscal; const b = el.querySelector('[data-fis2]'); if (b) b.onclick = fiscal;
  el.querySelector('[data-new]').onclick = () => openInvoiceModal(fis);
  el.querySelectorAll('[data-v]').forEach(x => x.onclick = () => openInvoiceView(+x.dataset.v));
};
