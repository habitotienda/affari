/* Corregir entradas y salidas: editar, anular y restaurar (backend/movements.py).
   Usa openModal(), fld(), methodSeg(), todayISO() (views.js), api(), esc(), icon(), ars(), toast() y refresh(). */

const mvLockMsg = m => m.locked === 'comprobante'
  ? 'Viene de un comprobante: se anula desde Comprobantes.'
  : 'Es un pago a un proveedor: no se corrige desde Caja.';

/* Aviso con más tiempo que toast() (los avisos largos no se alcanzan a leer en 2 segundos) */
function mvNotice(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), msg.length > 60 ? 6500 : 2600);
}
const mvDay = iso => String(iso).slice(0, 10).split('-').reverse().join('/');
/* Si el día corregido ya tenía cierre de caja, el cierre guardado no se recalcula: se avisa para que lo revisen */
const mvClosedNote = r => r && r.closed_days && r.closed_days.length
  ? ` · Ojo: ${r.closed_days.map(mvDay).join(', ')} ya tenía cierre de caja, revisalo en Flujo de caja.` : '';

/* Botones de cada fila. `compact` = solo íconos (tablas angostas). Va dentro de un <td>. */
function mvActions(m, ix, compact) {
  if (m.locked) return `<div class="act"><span class="mv-lock" role="img" title="${esc(mvLockMsg(m))}" aria-label="${esc(mvLockMsg(m))}">${icon('lock', 15)}</span></div>`;
  if (m.voided_at) return `<div class="act"><button type="button" class="btn btn-sm" data-mv="restore" data-ix="${ix}">Restaurar</button></div>`;
  return `<div class="act">
    <button type="button" class="btn btn-sm" data-mv="edit" data-ix="${ix}" title="Editar" aria-label="Editar movimiento">${icon('edit', 15)}${compact ? '' : 'Editar'}</button>
    <button type="button" class="btn btn-sm btn-danger" data-mv="void" data-ix="${ix}" title="Anular" aria-label="Anular movimiento">${icon('close', 15)}${compact ? '' : 'Anular'}</button></div>`;
}

/* En celular la columna de acciones queda fuera de pantalla (la tabla se desliza de costado): se repiten bajo el concepto, solo en pantallas angostas */
const mvInline = (m, ix) => m.locked ? '' : `<div class="mv-inline">${mvActions(m, ix)}</div>`;

function bindMoveActions(el, list) {
  const run = { edit: openMoveEdit, void: openMoveVoid, restore: restoreMove };
  el.querySelectorAll('[data-mv]').forEach(b => {
    b.onclick = e => { e.stopPropagation(); run[b.dataset.mv](list[+b.dataset.ix]); };     // sin esto la fila (venta de varios productos) también se abriría
    b.onkeydown = e => e.stopPropagation();
  });
}

/* ---------- Editar ---------- */
function openMoveEdit(m) {
  const multi = !!m.items, pay = !!m.is_payment, fiado = m.kind === 'fiado';
  const hasItem = !multi && !pay && m.kind !== 'salida' && !!m.product_id && m.qty > 0;      // vendió un producto: la cantidad toca el stock
  const plain = !multi && !pay && !hasItem && !fiado;                                       // sin producto: se puede pasar de entrada a salida
  const today = todayISO(), day = String(m.created_at).slice(0, 10);
  const title = multi ? 'Editar venta' : pay ? 'Editar cobro de fiado' : fiado ? 'Editar fiado' : m.kind === 'salida' ? 'Editar gasto' : 'Editar venta';
  const kindSeg = plain ? `<div class="field"><label>Tipo de movimiento</label><div class="seg"><label><input type="radio" name="mk" value="entrada"${m.kind === 'entrada' ? ' checked' : ''}><span>Entrada</span></label><label><input type="radio" name="mk" value="salida"${m.kind === 'salida' ? ' checked' : ''}><span>Salida</span></label></div></div>` : '';
  const concept = multi
    ? fld('Nombre de la venta', `<input id="ec" maxlength="160" value="${esc(m.title || '')}" placeholder="Opcional">`, 'ec')
    : fld('Concepto', `<input id="ec" maxlength="160" value="${esc(m.concept)}" required>`, 'ec');
  const amount = multi
    ? fld('Total de la venta', `<input value="${esc(ars(m.amount))}" disabled>`) + `<p class="muted mv-hint">Esta venta tiene ${m.items.length} productos: acá podés cambiar el nombre, el medio de pago y la fecha. Para cambiar montos o cantidades, anulala y cargala de nuevo.</p>`
    : fld('Monto (ARS)', `<input id="ea" type="number" min="0.01" step="any" inputmode="decimal" value="${m.amount}" required>`, 'ea');
  const qty = hasItem
    ? fld(`Cantidad${m.product_name ? ' · ' + esc(m.product_name) : ''}`, `<input id="eq" type="number" min="1" step="1" inputmode="numeric" value="${m.qty}" required>`, 'eq') + '<p class="muted mv-hint">Al cambiar la cantidad se ajusta el stock.</p>'
    : '';
  const note = fiado && !multi ? '<p class="muted mv-hint">Si cambiás el monto, también cambia lo que debe el cliente.</p>'
    : pay ? '<p class="muted mv-hint">Si cambiás el monto, también cambia lo que debe el cliente.</p>' : '';
  const { form } = openModal({
    title, submit: 'Guardar cambios',
    html: kindSeg + concept + amount + note + qty + fld('Fecha', `<input id="ed" type="date" max="${today}" value="${day}" required>`, 'ed') + (fiado ? '' : methodSeg()),
    onSubmit: async (f, close) => {
      const v = s => f.querySelector(s), body = { concept: v('#ec').value.trim(), date: v('#ed').value };
      if (!multi) body.amount = Number(v('#ea').value);
      if (hasItem) body.qty = Number(v('#eq').value);
      if (!fiado) body.method = f.querySelector('input[name=sm]:checked').value;
      if (plain) body.kind = f.querySelector('input[name=mk]:checked').value;
      const r = await api(`/sales/${m.id}`, { method: 'PUT', body });
      close(); mvNotice('Cambios guardados' + mvClosedNote(r)); await refresh();
    }
  });
  const rb = form.querySelector(`input[name=sm][value="${m.method}"]`); if (rb) rb.checked = true;      // methodSeg() trae «Efectivo» marcado
  if (hasItem) {                                                                                         // si cambia la cantidad, el monto la acompaña (salvo que lo hayan tocado a mano)
    const ea = form.querySelector('#ea'), eq = form.querySelector('#eq'), unit = m.amount / m.qty; let manual = false;
    ea.addEventListener('input', () => { manual = true; });
    eq.addEventListener('input', () => { const q = Number(eq.value); if (!manual && q >= 1) ea.value = Math.round(unit * q * 100) / 100; });
  }
}

/* ---------- Anular ---------- */
function openMoveVoid(m) {
  const sold = !!m.items || (!m.is_payment && m.kind !== 'salida' && !!m.product_id && m.qty > 0);
  const fx = [];
  if (sold) fx.push('El stock vuelve al inventario.');
  if (m.is_payment) fx.push('El cliente vuelve a deber este cobro.');
  else if (m.kind === 'fiado') fx.push('Se descuenta de lo que debe el cliente.');
  fx.push(m.kind === 'salida' ? 'Deja de contar como gasto en caja y reportes.' : 'Deja de sumar en caja, estadísticas y reportes.');
  fx.push('Queda en el historial como «Anulado» y lo podés restaurar.');
  const { form } = openModal({
    title: m.items ? 'Anular venta' : 'Anular movimiento', submit: 'Anular',
    html: `<p class="mv-what"><strong>${esc(m.concept)}</strong><span>${ars(m.amount)} · ${esc(m.method)} · ${when(m.created_at)}</span></p>
      <ul class="mv-fx">${fx.map(t => `<li>${t}</li>`).join('')}</ul>` +
      fld('Motivo (opcional)', `<input id="vr" maxlength="120" list="vrl" autocomplete="off" placeholder="Ej: Cancelaron el pedido"><datalist id="vrl"><option value="Cancelaron el pedido"><option value="Me equivoqué al cargarlo"><option value="Devolución del cliente"><option value="Estaba duplicado"></datalist>`, 'vr'),
    onSubmit: async (f, close) => {
      const r = await api(`/sales/${m.id}/void`, { method: 'POST', body: { reason: f.querySelector('#vr').value.trim() } });
      let msg = 'Movimiento anulado';
      if (r.stock_back) msg += ` · ${r.stock_back} ${r.stock_back === 1 ? 'unidad vuelve' : 'unidades vuelven'} al stock`;
      if (r.stock_lost) msg += ` · ${r.stock_lost} u. no volvieron al stock porque el producto ya no existe`;
      close(); mvNotice(msg + mvClosedNote(r)); await refresh();
    }
  });
  form.querySelector('[data-submit]').classList.add('mv-danger');          // acción destructiva: botón rojo
}

/* ---------- Restaurar ---------- */
async function restoreMove(m) {
  const stock = !!m.items || (!m.is_payment && m.kind !== 'salida' && !!m.product_id && m.qty > 0);
  if (!confirm(`¿Restaurar este movimiento? Vuelve a sumar en caja y reportes${stock ? ' y se descuenta el stock otra vez' : ''}.`)) return;
  try { const r = await api(`/sales/${m.id}/restore`, { method: 'POST', body: {} }); mvNotice('Movimiento restaurado' + mvClosedNote(r)); await refresh(); }
  catch (e) { mvNotice(e.message); }
}
