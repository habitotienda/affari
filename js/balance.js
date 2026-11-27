/* Balance mensual (estilo Treinta): selector de mes, Balance / Ingresos / Egresos, lista de movimientos, detalle con ganancia y medios de pago.
   Backend: backend/balance.py (GET /api/balance?month=AAAA-MM). Usa api(), esc(), ars(), icon(), head(), openTicket()/bindTickets() (views.js),
   mvActions()/bindMoveActions() (movements.js: editar y anular desde acá también), Billing, Session, API, toast(), refresh(). */
Object.assign(ICON_PATHS, {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  balance: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  quote: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>'
});

const BL = { month: '', tab: 'in', detail: false };
const blNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const blShift = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const blName = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long' }); };
const blFull = ym => `${blName(ym)} de ${ym.slice(0, 4)}`;
const blAmt = n => (n < 0 ? '−' : '') + ars(Math.abs(n));
const blWhen = s => { const d = new Date(String(s).replace(' ', 'T')); return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '') + ' - ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); };

/* Fila de un movimiento (ingreso o egreso). `ix` es la posición en `list` para los botones de editar / anular. */
function blRow(m, ix, income) {
  const state = m.voided_at ? '<span class="bl-st void">Anulado</span>' : `<span class="bl-st ${income ? 'in' : 'out'}">${income ? 'Pagado' : 'Pagada'}</span>`;
  const ico = m.supplier_id ? 'truck' : m.is_payment ? 'book' : income ? 'cash' : 'wallet';
  return `<li class="bl-row ${income ? 'in' : 'out'}${m.voided_at ? ' gone' : ''}${m.items ? ' tk-row' : ''}"${m.items ? ` data-tk="${ix}" tabindex="0" role="button" aria-label="Ver los productos de esta venta"` : ''}>
    <span class="bl-ico">${icon(ico, 20)}</span>
    <div class="bl-main"><div class="bl-top"><strong>${esc(m.concept)}</strong><b>${blAmt(m.amount * (income ? 1 : -1))}</b></div>
      <div class="bl-sub"><span>${esc(m.method)} · ${blWhen(m.created_at)}${m.items ? ` · ${m.items.length} productos` : ''}</span>${state}</div>
      ${m.voided_at && m.void_reason ? `<small class="muted">Motivo: ${esc(m.void_reason)}</small>` : ''}
      <div class="bl-act">${mvActions(m, ix)}</div></div></li>`;
}

async function blDownload(month) {
  const [y, m] = month.split('-').map(Number), last = new Date(y, m, 0).getDate();
  const res = await fetch(`${API}/reports/export.xlsx?from=${month}-01&to=${month}-${String(last).padStart(2, '0')}`, { headers: { Authorization: 'Bearer ' + Session.token } });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})), msg = typeof d.detail === 'string' ? d.detail : 'No pudimos generar el archivo.';
    if (res.status === 402 && typeof Billing !== 'undefined') Billing.showUpgrade({ message: msg });
    throw new Error(msg);
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `affari-balance-${month}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

VIEWS.balance = async function (el) {
  const cur = blNow(); if (!BL.month) BL.month = cur;
  const d = await api('/balance?month=' + BL.month), ym = d.month, P = d.profit;
  /* meses visibles: los últimos hasta el actual; si el elegido es más viejo, entra como primero */
  const nm = window.innerWidth < 480 ? 3 : 4;                      // en celular entran 3 meses + el calendario
  let months = Array.from({ length: nm }, (_, i) => blShift(cur, i - (nm - 1))); if (!months.includes(ym)) months = [ym, ...months.slice(1)];
  const bar = `<div class="bl-months" role="tablist" aria-label="Mes">${months.map(m => `<button type="button" role="tab" aria-selected="${m === ym}" class="${m === ym ? 'on' : ''}" data-m="${m}">${blName(m)}${m.slice(0, 4) !== cur.slice(0, 4) ? ' ' + m.slice(2, 4) : ''}</button>`).join('')}
    <label class="bl-cal" title="Elegir otro mes">${icon('calendar', 22)}<input type="month" min="${d.first_month}" max="${cur}" value="${ym}" aria-label="Elegir mes"></label></div>`;
  const neg = d.balance < 0;
  const summary = `<section class="card bl-sum"><div class="bl-bal"><span>Balance de ${esc(blFull(ym))}</span><strong class="${neg ? 'neg' : ''}">${blAmt(d.balance)}</strong></div>
    <div class="bl-io"><div><span class="in">${icon('trend', 15)} Ingresos</span><b>${ars(d.income)}</b></div><div><span class="out">${icon('trend', 15)} Egresos</span><b>${d.expense ? '−' : ''}${ars(d.expense)}</b></div></div>
    <div class="bl-links"><button type="button" class="bl-link" data-dl>Descargar reportes</button>${BL.detail ? '' : `<button type="button" class="bl-link go" data-detail>Ver balance ›</button>`}</div></section>`;

  if (BL.detail) {
    const all = [...d.incomes, ...d.expenses].filter(m => !m.voided_at);
    const mrow = (m, inc) => `<li><span>${esc(m.concept)}<small class="muted"> · ${blWhen(m.created_at)}</small></span><b class="${inc ? 'in' : 'out'}">${inc ? '+' : '−'}${ars(m.amount)}</b></li>`;
    el.innerHTML = head('Detalle del balance', blFull(ym), '<button type="button" class="btn" data-back>← Volver</button>') + bar + summary + `
      <section class="card bl-prof"><div class="section-title">Ganancia</div><p class="muted">Se calcula restando de tus ventas el costo que tenés registrado en los productos.</p>
        <dl><dt>Ventas</dt><dd>${ars(P.sales)}</dd><dt>Costo de productos vendidos</dt><dd class="out">${P.cost ? '−' : ''}${ars(P.cost)}</dd></dl>
        <div class="bl-est"><span>Ganancia estimada</span><strong class="${P.estimated < 0 ? 'neg' : ''}">${blAmt(P.estimated)}</strong></div>
        ${P.no_cost_items ? `<small class="muted">${P.no_cost_items} ${P.no_cost_items === 1 ? 'venta no tiene' : 'ventas no tienen'} un producto asociado: su costo no se descuenta y la ganancia puede ser menor a la real.</small>` : ''}</section>
      <section class="bl-meths">${d.methods.map(m => {
        const rows = all.filter(x => x.method === m.method).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return `<details class="card bl-m"><summary><strong>${esc(m.method)}</strong><span class="${m.net < 0 ? 'neg' : ''}">${blAmt(m.net)}</span></summary>
          <div class="bl-m-in"><div><span>Ingresos</span><b class="in">${ars(m.inflow)}</b></div><div><span>Egresos</span><b class="out">${m.outflow ? '−' : ''}${ars(m.outflow)}</b></div></div>
          ${rows.length ? `<ul class="bl-mini">${rows.map(x => mrow(x, d.incomes.includes(x))).join('')}</ul>` : '<p class="muted">Sin movimientos en este mes.</p>'}</details>`; }).join('')}</section>`;
    el.querySelector('[data-back]').onclick = () => { BL.detail = false; refresh(); };
  } else {
    const list = BL.tab === 'in' ? d.incomes : d.expenses, inc = BL.tab === 'in';
    el.innerHTML = head('Balance', 'Ingresos, egresos y ganancia de cada mes.') + bar + summary + `
      <div class="bl-tabs" role="tablist"><button type="button" role="tab" aria-selected="${inc}" class="${inc ? 'on' : ''}" data-tab="in">Ingresos</button><button type="button" role="tab" aria-selected="${!inc}" class="${!inc ? 'on' : ''}" data-tab="out">Egresos</button></div>
      <div class="card bl-list">${list.length ? `<ul>${list.map((m, ix) => blRow(m, ix, inc)).join('')}</ul>` : `<div class="empty">No hay ${inc ? 'ingresos' : 'egresos'} en ${esc(blFull(ym))}.</div>`}</div>`;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { BL.tab = b.dataset.tab; refresh(); });
    bindTickets(el, list); bindMoveActions(el, list);
    const dt = el.querySelector('[data-detail]'); if (dt) dt.onclick = () => { BL.detail = true; window.scrollTo(0, 0); refresh(); };
  }
  el.querySelectorAll('.bl-months [data-m]').forEach(b => b.onclick = () => { BL.month = b.dataset.m; refresh(); });
  const cal = el.querySelector('.bl-cal input'); cal.onchange = () => { if (cal.value) { BL.month = cal.value; refresh(); } };
  el.querySelector('[data-dl]').onclick = async e => { const b = e.currentTarget; b.disabled = true; try { await blDownload(ym); } catch (err) { toast(err.message); } b.disabled = false; };
};
