/* Estadísticas y reportes: costos vs ganancia neta en vivo, ranking de productos, medios de pago y exportación PDF/Excel. */
const RP = { preset: '30', from: '', to: '', sort: 'units' };
const rpIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rpDM = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const rpDMY = iso => rpDM(iso) + '/' + iso.slice(0, 4);
const rpPct = n => n.toFixed(1).replace('.', ',') + '%';

function rpRange() {
  const now = new Date(), to = rpIso(now), back = n => { const d = new Date(now); d.setDate(d.getDate() - n); return rpIso(d); };
  if (RP.preset === 'today') return { from: to, to };
  if (RP.preset === '7') return { from: back(6), to };
  if (RP.preset === '30') return { from: back(29), to };
  if (RP.preset === 'month') return { from: rpIso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  return { from: RP.from || back(29), to: RP.to || to };
}
const rpQuery = () => { const r = rpRange(); return `from=${r.from}&to=${r.to}`; };

/* ---------- Gráfico: costos vs ganancia neta (SVG propio, sin librerías) ---------- */
function rpBuckets(daily) {
  const size = daily.length > 45 ? 7 : 1, out = [];
  for (let i = 0; i < daily.length; i += size) {
    const ch = daily.slice(i, i + size);
    out.push({ label: size === 1 ? rpDM(ch[0].date) : rpDM(ch[0].date) + '–' + rpDM(ch[ch.length - 1].date), costs: ch.reduce((s, x) => s + x.costs, 0), net: ch.reduce((s, x) => s + x.net, 0), sales: ch.reduce((s, x) => s + x.sales, 0) });
  }
  return { rows: out, size };
}
function rpNiceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function rpChart(daily) {
  const { rows, size } = rpBuckets(daily), W = 720, H = 270, L = 64, R = 10, T = 14, B = 34;
  const top = Math.max(0, ...rows.map(r => Math.max(r.costs, r.net))), bot = Math.min(0, ...rows.map(r => r.net)), step = rpNiceMax((top - bot) / 4 || 1);
  const hi = Math.max(step, Math.ceil(top / step) * step), lo = Math.floor(bot / step) * step;      // el 0 siempre cae en una marca de la escala
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B), x0 = y(0), slot = (W - L - R) / rows.length, bw = Math.max(2, Math.min(18, slot * .36));
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + step * i), every = Math.ceil(rows.length / 10);
  const short = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' M' : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + ' mil' : String(Math.round(v));
  const tip = r => `${r.label}: ventas ${ars(r.sales)} · costos ${ars(r.costs)} · ganancia neta ${ars(r.net)}`;
  return `<svg viewBox="0 0 ${W} ${H}" class="rp-svg" role="img" aria-label="Costos contra ganancia neta ${size > 1 ? 'por semana' : 'por día'}">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'ax0' : 'gr'}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="tk">${t < 0 ? '−' : ''}$${short(Math.abs(t))}</text>`).join('')}
    ${rows.map((r, i) => { const cx = L + slot * (i + .5), hc = Math.abs(y(r.costs) - x0), hn = Math.abs(y(r.net) - x0);
      return `<g class="bg"><title>${esc(tip(r))}</title><rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>
        <rect x="${cx - bw - 1}" y="${y(Math.max(r.costs, 0))}" width="${bw}" height="${Math.max(hc, r.costs ? 1 : 0)}" rx="2" class="b-cost"/>
        <rect x="${cx + 1}" y="${r.net >= 0 ? y(r.net) : x0}" width="${bw}" height="${Math.max(hn, r.net ? 1 : 0)}" rx="2" class="${r.net >= 0 ? 'b-net' : 'b-loss'}"/></g>
        ${i % every === 0 ? `<text x="${cx}" y="${H - 12}" text-anchor="middle" class="tk">${r.label.split('–')[0]}</text>` : ''}`; }).join('')}
  </svg>`;
}

/* ---------- Piezas ---------- */
function rpDelta(cur, prev, bad = false) {
  if (!prev) return '<small class="dl">Sin datos del período anterior</small>';
  const p = (cur - prev) / Math.abs(prev) * 100; if (Math.abs(p) < .5) return '<small class="dl">Igual que el período anterior</small>';
  const up = p > 0, good = bad ? !up : up;
  return `<small class="dl ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs período anterior</small>`;
}
function rpSplit(t) {
  if (!t.sales) return '<div class="empty">Todavía no hay ventas en este período.</div>';
  if (t.net < 0) return `<div class="rp-loss">Los costos superan a las ventas por <strong>${ars(-t.net)}</strong> en este período.</div>`
    + `<div class="rp-stack"><i class="c1" style="flex:${t.cogs}"></i><i class="c2" style="flex:${t.expenses}"></i></div><div class="rp-leg"><span><i class="c1"></i>Mercadería ${ars(t.cogs)}</span><span><i class="c2"></i>Gastos ${ars(t.expenses)}</span></div>`;
  const p = v => v / t.sales * 100;
  return `<p class="muted">De cada <strong>$100</strong> que vendiste: <strong>$${p(t.cogs).toFixed(0)}</strong> fueron mercadería, <strong>$${p(t.expenses).toFixed(0)}</strong> gastos y te quedaron <strong class="pos-t">$${p(t.net).toFixed(0)}</strong> de ganancia neta.</p>
    <div class="rp-stack"><i class="c1" style="flex:${t.cogs}"></i><i class="c2" style="flex:${t.expenses}"></i><i class="c3" style="flex:${t.net}"></i></div>
    <div class="rp-leg"><span><i class="c1"></i>Mercadería ${ars(t.cogs)}</span><span><i class="c2"></i>Gastos ${ars(t.expenses)}</span><span><i class="c3"></i>Ganancia neta ${ars(t.net)}</span></div>`;
}
function rpRanking(r) {
  const key = RP.sort, list = [...r.products].sort((a, b) => b[key] - a[key]).slice(0, 10), max = Math.max(1, ...list.map(p => p[key]));
  const tabs = `<div class="seg seg3 rp-sort">${[['units', 'Unidades'], ['revenue', 'Ingresos'], ['profit', 'Ganancia']].map(([k, l]) => `<label><input type="radio" name="rpsort" value="${k}" ${key === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  if (!list.length) return tabs + '<div class="empty">Vendé un producto cargado en inventario y va a aparecer acá.</div>';
  return tabs + `<ol class="rp-rank">${list.map((p, i) => `<li><span class="n">${i + 1}</span><div><div class="rp-rk-top"><strong>${esc(p.name)}</strong><span>${key === 'units' ? p.units + ' u.' : ars(p[key])}</span></div>
    <div class="rp-bar"><i style="width:${Math.max(3, p[key] / max * 100)}%"></i></div><small>${p.units} u. · ${ars(p.revenue)} en ventas · ${ars(p.profit)} de ganancia</small></div></li>`).join('')}</ol>`
    + (r.unassigned.count ? `<p class="hint">${r.unassigned.count} ${r.unassigned.count === 1 ? 'venta' : 'ventas'} por ${ars(r.unassigned.amount)} se cargaron sin producto y no entran en el ranking.</p>` : '');
}
function rpMethods(r) {
  if (!r.methods.length) return '<div class="empty">Sin movimientos de caja.</div>';
  const max = Math.max(1, ...r.methods.map(m => m.inflow));
  return r.methods.map(m => `<div class="rp-m"><div class="rp-rk-top"><strong>${esc(m.method)}</strong><span>${ars(m.balance)}</span></div><div class="rp-bar"><i style="width:${Math.max(2, m.inflow / max * 100)}%"></i></div><small>Ingresos ${ars(m.inflow)} · Egresos ${ars(m.outflow)}</small></div>`).join('');
}
function rpExpenses(r) {
  return r.expenses.length ? `<ul class="rp-ex">${r.expenses.map(e => `<li><span>${esc(e.concept)}${e.count > 1 ? ` <small>×${e.count}</small>` : ''}</span><strong>${ars(e.total)}</strong></li>`).join('')}</ul>` : '<div class="empty">No registraste gastos en este período.</div>';
}

function rpBody(r) {
  const t = r.totals, p = r.prev, size = rpBuckets(r.daily).size;
  return `<section class="kpis">
      <div class="card kpi"><span>Ventas</span><strong>${ars(t.sales)}</strong>${rpDelta(t.sales, p.sales)}<small>${t.count} operaciones · ticket ${ars(t.avg_ticket)}</small></div>
      <div class="card kpi"><span>Costos totales</span><strong>${ars(t.costs)}</strong>${rpDelta(t.costs, p.costs, true)}<small>Mercadería ${ars(t.cogs)} + gastos ${ars(t.expenses)}</small></div>
      <div class="card kpi ${t.net >= 0 ? 'pos' : 'neg-k'}"><span>Ganancia neta</span><strong>${ars(t.net)}</strong>${rpDelta(t.net, p.net)}<small>Ventas − costos</small></div>
      <div class="card kpi"><span>Margen neto</span><strong>${rpPct(t.margin)}</strong><small>Ganancia bruta ${ars(t.gross)}</small></div></section>
    <section class="card rp-card"><div class="rp-h"><div class="section-title">Costos vs ganancia neta ${size > 1 ? '(por semana)' : '(por día)'}</div>
      <div class="rp-leg"><span><i class="c1"></i>Costos</span><span><i class="c3"></i>Ganancia neta</span><span><i class="c4"></i>Pérdida</span></div></div>
      ${r.daily.some(d => d.sales || d.costs) ? rpChart(r.daily) : '<div class="empty">Sin movimientos en el período elegido.</div>'}</section>
    <section class="card rp-card"><div class="section-title">¿A dónde va lo que vendés?</div>${rpSplit(t)}</section>
    <section class="rp-cols"><div class="card rp-card"><div class="section-title">Productos más vendidos</div>${rpRanking(r)}</div>
      <div class="rp-side"><div class="card rp-card"><div class="section-title">Caja por medio de pago</div>${rpMethods(r)}</div>
      <div class="card rp-card"><div class="section-title">Principales gastos</div>${rpExpenses(r)}</div>
      <div class="card rp-card"><div class="section-title">Fiados</div><p class="muted">Otorgado en el período: <strong>${ars(t.fiado_new)}</strong><br>Cobrado: <strong>${ars(t.fiado_paid)}</strong><br>Pendiente hoy: <strong class="${r.fiados.pending ? 'neg' : ''}">${ars(r.fiados.pending)}</strong> (${r.fiados.clients} clientes)</p></div></div></section>`;
}

/* ---------- Descarga con sesión (el token va en el header, no en la URL) ---------- */
async function rpDownload(fmt) {
  const res = await fetch(`${API}/reports/export.${fmt}?${rpQuery()}`, { headers: { Authorization: 'Bearer ' + Session.token } });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(typeof d.detail === 'string' ? d.detail : 'No pudimos generar el archivo.'); }
  const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || `affari-balance.${fmt}`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Vista ---------- */
VIEWS.reportes = async function (el) {
  const PRE = [['today', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['month', 'Este mes'], ['custom', 'Otro']];
  const r0 = rpRange();
  el.innerHTML = head('Estadísticas y reportes', 'Costos, ganancias y rankings de tu negocio, actualizados en tiempo real.',
    `<button class="btn" data-x="xlsx">${icon('book', 16)}Exportar Excel</button><button class="btn btn-primary" data-x="pdf">${icon('book', 16)}Exportar PDF</button>`) + `
    <div class="rp-bar-top"><div class="seg seg5" role="radiogroup" aria-label="Período">${PRE.map(([k, l]) => `<label><input type="radio" name="rpp" value="${k}" ${RP.preset === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="rp-dates ${RP.preset === 'custom' ? '' : 'hidden'}"><label>Desde <input type="date" name="rpf" value="${r0.from}" max="${r0.to}"></label><label>Hasta <input type="date" name="rpt" value="${r0.to}"></label></div>
      <span class="live" data-live><i></i><span>En vivo</span></span></div>
    <div id="rp-body" aria-live="polite"></div>`;
  const body = el.querySelector('#rp-body'); let last = '', timer = null;

  const paint = r => { const s = JSON.stringify(r); if (s === last) return; last = s; body.innerHTML = rpBody(r); };
  const stamp = () => { const l = (document.getElementById('view') || el).querySelector('[data-live] span'); if (l) l.textContent = 'En vivo · ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  const load = async quiet => {
    try { const r = await api('/reports?' + rpQuery()); paint(r); RP.data = r; stamp(); }
    catch (e) { if (e.status === 401) return logout(); if (!quiet) body.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  await load();

  // Actualización automática cada 10 s mientras la pestaña esté visible y esta vista abierta
  timer = setInterval(() => { const live = document.getElementById('rp-body'); if (!live) return stop(); if (!document.hidden) load(true); }, 10000);
  const stop = () => { clearInterval(timer); if (state.stop === stop) state.stop = null; };
  state.stop = stop;

  const dates = el.querySelector('.rp-dates'), from = el.querySelector('[name=rpf]'), to = el.querySelector('[name=rpt]');
  el.querySelectorAll('[name=rpp]').forEach(i => i.onchange = () => { RP.preset = i.value; dates.classList.toggle('hidden', i.value !== 'custom'); if (i.value === 'custom') { RP.from = from.value; RP.to = to.value; } last = ''; load(); });
  const custom = () => { if (!from.value || !to.value) return; if (from.value > to.value) return toast('La fecha "desde" no puede ser posterior a "hasta".'); RP.from = from.value; RP.to = to.value; last = ''; load(); };
  from.onchange = to.onchange = custom;
  body.addEventListener('change', e => { if (e.target.name === 'rpsort') { RP.sort = e.target.value; last = ''; if (RP.data) paint(RP.data); } });
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
    const txt = b.innerHTML; b.disabled = true; b.textContent = 'Generando…';
    try { await rpDownload(b.dataset.x); toast('Reporte descargado'); } catch (e) { toast(e.message); }
    b.disabled = false; b.innerHTML = txt;
  });
};
