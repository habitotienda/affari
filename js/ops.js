/* Parte 5 (1/2): clientes, proveedores, deudas y flujo de caja. Usa los helpers de views.js (fld, openModal, done, head, when, KIND, methodSeg). */
const ars2 = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0);
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shiftDay = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const num = (f, s) => Number(f.querySelector(s).value);

/* Descarga con sesión (el token va en el header, no en la URL) */
async function opsDownload(path, fallback) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + Session.token } });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(typeof d.detail === 'string' ? d.detail : 'No pudimos generar el archivo.'); }
  const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || fallback;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Ficha de cliente / proveedor (misma base, distinto endpoint) ---------- */
function openPartyModal(kind, p) {
  const label = kind === 'clients' ? 'cliente' : 'proveedor', v = k => esc(p ? p[k] || '' : '');
  openModal({ title: p ? `Editar ${label}` : `Nuevo ${label}`, wide: true,
    html: fld('Nombre o razón social', `<input id="n" required maxlength="100" value="${v('name')}">`, 'n') +
      `<div class="row2">${fld('Teléfono / WhatsApp', `<input id="t" type="tel" placeholder="351 555 0123" value="${v('phone')}">`, 't')}${fld('Email', `<input id="e" type="email" value="${v('email')}">`, 'e')}
      ${fld('CUIT / CUIL', `<input id="c" inputmode="numeric" maxlength="13" placeholder="20-12345678-6" value="${v('cuit')}">`, 'c')}${fld('Dirección', `<input id="a" maxlength="160" value="${v('address')}">`, 'a')}</div>` +
      `<div class="field"><label for="o">Notas</label><textarea id="o" maxlength="400" placeholder="Condiciones, horarios, observaciones…">${v('notes')}</textarea></div>`,
    onSubmit: async (f, close) => {
      const body = { name: f.querySelector('#n').value, phone: f.querySelector('#t').value, email: f.querySelector('#e').value, cuit: f.querySelector('#c').value, address: f.querySelector('#a').value, notes: f.querySelector('#o').value };
      await api(p ? `/${kind}/${p.id}` : `/${kind}`, { method: p ? 'PUT' : 'POST', body }); await done(close, p ? 'Datos actualizados' : `${label[0].toUpperCase() + label.slice(1)} creado`);
    } });
}
async function deleteParty(kind, p) {
  if (!confirm(`¿Eliminar a "${p.name}"? El historial de caja se conserva.`)) return;
  try { await api(`/${kind}/${p.id}`, { method: 'DELETE' }); toast('Eliminado'); refresh(); } catch (e) { toast(e.message); }
}
async function openMovesModal(kind, p) {
  const rows = await api(`/${kind}/${p.id}/moves`);
  const lbl = m => kind === 'clients' ? (m.is_payment ? 'Cobro' : KIND[m.kind]) : (m.kind === 'compra' ? 'Compra' : 'Pago');
  const neg = m => kind === 'clients' ? m.kind === 'salida' : m.kind === 'pago';
  openModal({ title: `Movimientos · ${p.name}`, hideSubmit: true, wide: true,
    html: rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th class="num">Monto</th></tr></thead><tbody>${rows.map(m => `<tr><td class="muted">${when(m.created_at)}</td><td>${esc(m.concept)}${m.due_date ? `<span class="cell-sub">Vence ${dmy(m.due_date)}</span>` : ''}</td><td>${lbl(m)}</td><td class="num ${neg(m) ? 'neg' : ''}">${ars2(m.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Sin movimientos todavía.</div>' });
}

/* ---------- Clientes ---------- */
VIEWS.clientes = async function (el) {
  const cs = await api('/clients'), debt = cs.reduce((s, c) => s + c.balance, 0);
  el.innerHTML = head('Clientes', `${cs.length} clientes · ${ars(debt)} por cobrar`, `<button class="btn btn-primary" data-new>${icon('plus')}Nuevo cliente</button>`) +
    `<div class="toolbar-row"><input class="search-in" type="search" placeholder="Buscar por nombre, teléfono o CUIT…" aria-label="Buscar cliente" data-q></div><div class="card tbl-wrap" data-list></div>`;
  const list = el.querySelector('[data-list]'), draw = () => {
    const q = (state.cq || '').toLowerCase(), rows = cs.filter(c => !q || [c.name, c.phone, c.cuit, c.email].some(x => String(x || '').toLowerCase().includes(q)));
    list.innerHTML = rows.length ? `<table><thead><tr><th>Cliente</th><th>Contacto</th><th>CUIT / CUIL</th><th class="num">Debe</th><th></th></tr></thead><tbody>${rows.map(c => `<tr><td><strong>${esc(c.name)}</strong>${c.address ? `<span class="cell-sub">${esc(c.address)}</span>` : ''}</td>
      <td>${esc(c.phone || '—')}${c.email ? `<span class="cell-sub">${esc(c.email)}</span>` : ''}</td><td class="muted">${esc(c.cuit || '—')}</td><td class="num ${c.balance > 0 ? 'neg' : ''}">${ars(c.balance)}</td>
      <td><div class="act">${c.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(c.phone)}" aria-label="WhatsApp">${icon('whatsapp', 16)}</a>` : ''}<button class="btn btn-sm" data-mv="${c.id}">Movimientos</button><button class="btn btn-sm" data-ed="${c.id}">Editar</button><button class="btn btn-sm btn-danger" data-rm="${c.id}" aria-label="Eliminar">${icon('close', 16)}</button></div></td></tr>`).join('')}</tbody></table>` : `<div class="empty">${cs.length ? 'Ninguna coincidencia.' : 'Todavía no cargaste clientes. Agregá el primero para facturarle o anotarle fiados.'}</div>`;
    list.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => openMovesModal('clients', cs.find(c => c.id == b.dataset.mv)));
    list.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => openPartyModal('clients', cs.find(c => c.id == b.dataset.ed)));
    list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => deleteParty('clients', cs.find(c => c.id == b.dataset.rm)));
  };
  const q = el.querySelector('[data-q]'); q.value = state.cq || ''; q.oninput = () => { state.cq = q.value; draw(); };
  el.querySelector('[data-new]').onclick = () => openPartyModal('clients'); draw();
};

/* ---------- Proveedores ---------- */
function openPurchaseModal(s) {
  const { form } = openModal({ title: `Compra a ${s.name}`, submit: 'Registrar compra',
    html: fld('Concepto', '<input id="c" placeholder="Ej: Mercadería factura 0001-123" maxlength="120">', 'c') + `<div class="row2">${fld('Monto (ARS)', '<input id="a" type="number" min="1" step="any" required>', 'a')}${fld('Vence el', '<input id="d" type="date">', 'd')}</div>` +
      `<label class="check"><input id="paid" type="checkbox">Pagada en el momento (sale de caja)</label><div data-pm class="hidden">${methodSeg()}</div>`,
    onSubmit: async (f, close) => {
      const paid = f.querySelector('#paid').checked;
      await api(`/suppliers/${s.id}/purchase`, { method: 'POST', body: { amount: num(f, '#a'), concept: f.querySelector('#c').value, due_date: f.querySelector('#d').value || null, paid, method: f.querySelector('input[name=sm]:checked').value } });
      await done(close, paid ? 'Compra pagada y registrada' : 'Compra anotada en la cuenta corriente');
    } });
  form.querySelector('#paid').onchange = e => form.querySelector('[data-pm]').classList.toggle('hidden', !e.target.checked);
}
function openSupplierPayModal(s) {
  openModal({ title: `Pagar a ${s.name}`, submit: 'Registrar pago',
    html: `<p class="muted" style="margin-bottom:14px">Les debés: <strong>${ars(s.balance)}</strong></p>` + fld('Monto pagado (ARS)', `<input id="a" type="number" min="1" max="${s.balance}" step="any" value="${s.balance}" required>`, 'a') + fld('Concepto (opcional)', '<input id="c" maxlength="120">', 'c') + methodSeg(),
    onSubmit: async (f, close) => { await api(`/suppliers/${s.id}/pay`, { method: 'POST', body: { amount: num(f, '#a'), concept: f.querySelector('#c').value, method: f.querySelector('input[name=sm]:checked').value } }); await done(close, 'Pago registrado'); } });
}
VIEWS.proveedores = async function (el) {
  const ss = await api('/suppliers'), debt = ss.reduce((t, s) => t + s.balance, 0), today = todayIso();
  el.innerHTML = head('Proveedores', `${ss.length} proveedores · ${ars(debt)} por pagar`, `<button class="btn btn-primary" data-new>${icon('plus')}Nuevo proveedor</button>`) + `<div class="card tbl-wrap">${ss.length ? `<table><thead><tr><th>Proveedor</th><th>Contacto</th><th>CUIT</th><th>Próximo vencimiento</th><th class="num">Les debés</th><th></th></tr></thead><tbody>${ss.map(s => {
    const over = s.balance > 0 && s.next_due && s.next_due < today;
    return `<tr><td><strong>${esc(s.name)}</strong>${s.address ? `<span class="cell-sub">${esc(s.address)}</span>` : ''}</td><td>${esc(s.phone || '—')}${s.email ? `<span class="cell-sub">${esc(s.email)}</span>` : ''}</td><td class="muted">${esc(s.cuit || '—')}</td>
      <td class="${over ? 'neg' : 'muted'}">${s.balance > 0 && s.next_due ? dmy(s.next_due) + (over ? ' · vencida' : '') : '—'}</td><td class="num ${s.balance > 0 ? 'neg' : ''}">${ars(s.balance)}</td>
      <td><div class="act"><button class="btn btn-sm" data-buy="${s.id}">+ Compra</button>${s.balance > 0 ? `<button class="btn btn-sm" data-pay="${s.id}">Pagar</button>` : ''}<button class="btn btn-sm" data-mv="${s.id}">Movimientos</button><button class="btn btn-sm" data-ed="${s.id}">Editar</button><button class="btn btn-sm btn-danger" data-rm="${s.id}" aria-label="Eliminar">${icon('close', 16)}</button></div></td></tr>`;
  }).join('')}</tbody></table>` : '<div class="empty">Todavía no cargaste proveedores. Agregalos para llevar su cuenta corriente y saber cuánto debés.</div>'}</div>`;
  const by = a => ss.find(s => s.id == a);
  el.querySelector('[data-new]').onclick = () => openPartyModal('suppliers');
  el.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => openPurchaseModal(by(b.dataset.buy)));
  el.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => openSupplierPayModal(by(b.dataset.pay)));
  el.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => openMovesModal('suppliers', by(b.dataset.mv)));
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => openPartyModal('suppliers', by(b.dataset.ed)));
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => deleteParty('suppliers', by(b.dataset.rm)));
};

/* ---------- Deudas: por cobrar y por pagar ---------- */
VIEWS.deudas = async function (el) {
  const d = await api('/debts'), r = d.receivable, p = d.payable;
  el.innerHTML = head('Deudas', 'Lo que te deben tus clientes y lo que debés a tus proveedores.', `<button class="btn" data-fiado>${icon('book')}Anotar fiado</button><button class="btn btn-primary" data-sup>${icon('truck')}Ir a proveedores</button>`) + `
    <section class="kpis"><div class="card kpi pos-k"><span>Por cobrar (fiados)</span><strong>${ars(r.total)}</strong><small>${r.items.length} clientes · ${ars(r.over30)} con más de 30 días</small></div>
      <div class="card kpi neg-k"><span>Por pagar (proveedores)</span><strong>${ars(p.total)}</strong><small>${p.items.length} proveedores · ${ars(p.overdue)} vencido</small></div>
      <div class="card kpi ${d.position >= 0 ? 'pos-k' : 'neg-k'}"><span>Posición neta</span><strong>${d.position < 0 ? '−' : ''}${ars(Math.abs(d.position))}</strong><small>${d.position >= 0 ? 'Te deben más de lo que debés' : 'Debés más de lo que te deben'}</small></div>
      <div class="card kpi ${p.overdue > 0 ? 'neg-k' : ''}"><span>Pagos vencidos</span><strong>${ars(p.overdue)}</strong><small>${p.overdue > 0 ? 'Regularizalos primero' : 'Sin vencimientos atrasados'}</small></div></section>
    <div class="grid2"><div class="card"><div class="section-title">Clientes que te deben</div>${r.items.length ? r.items.map(c => `<div class="debt-row"><div><strong>${esc(c.name)}</strong><small class="${c.days >= 30 ? 'over' : ''}">${c.days >= 1 ? `Sin movimientos hace ${c.days} días` : 'Movimiento reciente'}</small></div>
        <div class="act"><strong class="neg">${ars(c.balance)}</strong>${c.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(c)}">${icon('whatsapp', 16)}Recordar</a>` : ''}<button class="btn btn-sm" data-cobrar="${c.id}">Cobrar</button></div></div>`).join('') : '<div class="empty">Nadie te debe. 🎉</div>'}</div>
      <div class="card"><div class="section-title">Proveedores a los que debés</div>${p.items.length ? p.items.map(s => `<div class="debt-row"><div><strong>${esc(s.name)}</strong><small class="${s.overdue ? 'over' : ''}">${s.next_due ? (s.overdue ? 'Vencida el ' : 'Vence el ') + dmy(s.next_due) : 'Sin fecha de vencimiento'}</small></div>
        <div class="act"><strong class="neg">${ars(s.balance)}</strong><button class="btn btn-sm" data-pagar="${s.id}">Pagar</button></div></div>`).join('') : '<div class="empty">No debés nada a proveedores.</div>'}</div></div>`;
  el.querySelector('[data-fiado]').onclick = () => openFiadoModal(); el.querySelector('[data-sup]').onclick = () => go('proveedores');
  el.querySelectorAll('[data-cobrar]').forEach(b => b.onclick = () => openPayModal(r.items.find(c => c.id == b.dataset.cobrar)));
  el.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () => openSupplierPayModal(p.items.find(s => s.id == b.dataset.pagar)));
};

/* ---------- Flujo de caja diario (en vivo si el día es hoy) ---------- */
const CF_ICON = { Efectivo: 'cash', Transferencia: 'trend', Tarjeta: 'wallet' };
function cfBody(d, closures) {
  const cl = d.closure, m = d.methods, S = d.summary, diffCls = x => Math.abs(x) < .5 ? 'ok' : Math.abs(x) < 1000 ? 'mid' : 'bad';
  const diffTxt = x => Math.abs(x) < .5 ? 'Caja cuadrada' : (x > 0 ? 'Sobran ' : 'Faltan ') + ars2(Math.abs(x));
  return `<section class="cf-methods">${m.map(x => `<div class="card cf-m"><h3>${x.method}${icon(CF_ICON[x.method], 18)}</h3><strong class="${x.closing < 0 ? 'neg' : ''}">${ars2(x.closing)}</strong>
      <dl><dt>Saldo inicial</dt><dd>${ars2(x.opening)}</dd><dt>Entró</dt><dd class="in">+ ${ars2(x.inflow)}</dd><dt>Salió</dt><dd class="out">− ${ars2(x.outflow)}</dd></dl></div>`).join('')}</section>
    <section class="card cf-sum"><div><span>Ventas del día</span><strong>${ars2(S.sales)}</strong></div><div><span>Fiado nuevo</span><strong>${ars2(S.fiado)}</strong></div><div><span>Cobros de fiados</span><strong>${ars2(S.cobros)}</strong></div>
      <div><span>Gastos</span><strong class="neg">${ars2(S.gastos)}</strong></div><div><span>Pagos a proveedores</span><strong class="neg">${ars2(S.proveedores)}</strong></div><div><span>Total en caja</span><strong>${ars2(d.total_closing)}</strong></div></section>
    <section class="card cf-close"><div class="section-title" style="padding:0 0 12px;border:0">Cierre de caja ${cl ? `<span class="diff ${diffCls(cl.diff)}">${diffTxt(cl.diff)}</span>` : ''}</div>
      <form data-close><div class="row2">${fld(`Efectivo contado (esperado ${ars2(d.expected_cash)})`, `<input name="counted" type="number" min="0" step="any" inputmode="decimal" required value="${cl ? cl.counted : ''}">`)}
      ${fld('Observaciones', `<input name="notes" maxlength="300" placeholder="Opcional" value="${esc(cl ? cl.notes : '')}">`)}</div>
      <div class="toolbar"><button class="btn btn-primary">${cl ? 'Actualizar cierre' : 'Cerrar caja'}</button><span class="diff hidden" data-live-diff></span></div></form></section>
    <div class="grid2"><div class="card tbl-wrap"><div class="section-title">Movimientos del día</div>${d.moves.length ? `<table><thead><tr><th>Hora</th><th>Concepto</th><th>Medio</th><th class="num">Monto</th></tr></thead><tbody>${d.moves.map(x => `<tr><td class="muted">${x.created_at.slice(11, 16)}</td><td>${esc(x.concept)}<span class="cell-sub">${x.supplier_id ? 'Proveedor' : x.is_payment ? 'Cobro de fiado' : KIND[x.kind]}</span></td><td>${esc(x.method)}</td><td class="num ${x.kind === 'salida' ? 'neg' : ''}">${x.kind === 'salida' ? '−' : ''}${ars2(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No hubo movimientos este día.</div>'}</div>
      <div class="card tbl-wrap"><div class="section-title">Últimos cierres</div>${closures.length ? `<table><thead><tr><th>Día</th><th class="num">Esperado</th><th class="num">Contado</th><th>Resultado</th></tr></thead><tbody>${closures.map(c => `<tr><td>${dmy(c.day)}</td><td class="num">${ars2(c.expected)}</td><td class="num">${ars2(c.counted)}</td><td><span class="diff ${diffCls(c.diff)}">${diffTxt(c.diff)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Todavía no cerraste ninguna caja.</div>'}</div></div>`;
}
VIEWS.flujo = async function (el) {
  if (state.stop) state.stop();                 // evita temporizadores duplicados al refrescar la vista
  const day = state.fday ||= todayIso(), isToday = day === todayIso();
  el.innerHTML = head('Flujo de caja', 'Efectivo, transferencias y tarjetas del día, con cierre y control de diferencias.') + `
    <div class="toolbar-row"><div class="day-nav"><button class="btn btn-sm" data-d="-1" aria-label="Día anterior">‹</button><input type="date" value="${day}" max="${todayIso()}" data-day aria-label="Día"><button class="btn btn-sm" data-d="1" ${isToday ? 'disabled' : ''} aria-label="Día siguiente">›</button>${isToday ? '' : '<button class="btn btn-sm" data-today>Hoy</button>'}</div>
    ${isToday ? '<span class="live" data-live><i></i><span>En vivo</span></span>' : ''}</div><div id="cf-body"></div>`;
  const body = el.querySelector('#cf-body'); let last = '', timer = null, expected = 0;
  const bind = () => {
    const f = body.querySelector('[data-close]'), live = body.querySelector('[data-live-diff]');
    f.querySelector('[name=counted]').oninput = e => {
      if (e.target.value === '') return live.classList.add('hidden');
      const x = Number(e.target.value) - expected; live.className = 'diff ' + (Math.abs(x) < .5 ? 'ok' : Math.abs(x) < 1000 ? 'mid' : 'bad'); live.textContent = Math.abs(x) < .5 ? 'Cuadra' : (x > 0 ? 'Sobran ' : 'Faltan ') + ars2(Math.abs(x));
    };
    f.onsubmit = async e => {
      e.preventDefault(); const b = f.querySelector('button'); b.disabled = true;
      try { await api('/cashflow/close', { method: 'POST', body: { day, counted: Number(f.counted.value), notes: f.notes.value } }); toast('Caja cerrada'); last = ''; load(); }
      catch (err) { toast(err.message); b.disabled = false; }
    };
  };
  const load = async quiet => {
    try {
      const [d, cls] = await Promise.all([api('/cashflow?day=' + day), api('/cashflow/closures')]), s = JSON.stringify([d, cls]);
      if (s === last || (quiet && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;   // no pisar lo que se está escribiendo
      last = s; expected = d.expected_cash; body.innerHTML = cfBody(d, cls); bind();
      const l = el.querySelector('[data-live] span'); if (l) l.textContent = 'En vivo · ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { if (e.status === 401) return logout(); if (!quiet) body.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  await load();
  const stop = () => { clearInterval(timer); if (state.stop === stop) state.stop = null; }; state.stop = stop;
  if (isToday) timer = setInterval(() => { if (!document.getElementById('cf-body')) return stop(); if (!document.hidden) load(true); }, 10000);
  const goDay = d => { state.fday = d; stop(); renderView(); };
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => goDay(shiftDay(day, +b.dataset.d)));
  el.querySelector('[data-day]').onchange = e => e.target.value && goDay(e.target.value);
  const t = el.querySelector('[data-today]'); if (t) t.onclick = () => goDay(todayIso());
};
