/* Horarios · lógica compartida por el panel (vista previa) y la tienda pública (/c/<slug>).
   Formato: { enabled, tz, days: { mon: [["09:00","13:00"], …], …, sun: [] } }   (mismo que backend/hours.py)
   Una franja que cierra antes de abrir cruza la medianoche. */
const SF_DAYS = [['mon', 'Lunes', 'Lun'], ['tue', 'Martes', 'Mar'], ['wed', 'Miércoles', 'Mié'], ['thu', 'Jueves', 'Jue'], ['fri', 'Viernes', 'Vie'], ['sat', 'Sábado', 'Sáb'], ['sun', 'Domingo', 'Dom']];
const SF_WEEK = 7 * 1440, SF_SOON = 60;            // «cierra pronto» = falta una hora o menos

const sfTm = t => +t.slice(0, 2) * 60 + +t.slice(3);
const sfHm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* Día de la semana (lunes = 0) y minuto del día en la zona horaria del negocio, sin importar la del visitante */
function sfNowIn(tz, ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Argentina/Buenos_Aires', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), min: (+p.hour % 24) * 60 + +p.minute };
}

function sfIntervals(h) {
  const out = [];
  SF_DAYS.forEach(([k], i) => (h.days?.[k] || []).forEach(([o, c]) => { const s = i * 1440 + sfTm(o), e = i * 1440 + sfTm(c); out.push([s, e > s ? e : e + 1440]); }));
  return out;
}

/* Si otra franja empieza justo cuando esta termina, el cierre real es el de la última */
function sfExtend(iv, end) {
  for (let i = 0; i < 21; i++) {
    let nxt = null;
    for (const [s, e] of iv) for (const k of [0, 1]) if (s + k * SF_WEEK === end) nxt = Math.max(nxt ?? 0, e + k * SF_WEEK);
    if (nxt === null || nxt <= end) break;
    end = nxt;
  }
  return end;
}

/* Estado en el instante `ms`. null = el comerciante no activó los horarios (la tienda muestra lo de siempre).
   → { open, soon, closes:'20:00'|null, opens:{ days, time }|null } */
function sfOpenStatus(h, ms = Date.now()) {
  if (!h || !h.enabled) return null;
  const { dow, min } = sfNowIn(h.tz, ms), n = dow * 1440 + min, iv = sfIntervals(h);
  for (const off of [0, SF_WEEK]) for (const [s, e] of iv) if (s <= n + off && n + off < e) {
    const end = sfExtend(iv, e);
    return { open: true, soon: end - (n + off) <= SF_SOON, closes: sfHm(end % 1440), opens: null };
  }
  let best = null;
  for (const [s] of iv) for (const off of [0, SF_WEEK]) if (s + off > n && (best === null || s + off < best)) best = s + off;
  return { open: false, soon: false, closes: null, opens: best === null ? null : { days: Math.floor(best / 1440) - Math.floor(n / 1440), time: sfHm(best % 1440), dow: Math.floor(best / 1440) % 7 } };
}

/* Textos para el badge */
function sfStatusText(st) {
  if (st.open) return { label: st.soon ? 'Cierra pronto' : 'Abierto ahora', detail: `cierra ${st.closes} hs` };
  if (!st.opens) return { label: 'Cerrado', detail: '' };
  const d = st.opens.days, when = d === 0 ? 'hoy' : d === 1 ? 'mañana' : 'el ' + SF_DAYS[st.opens.dow][1].toLowerCase();
  return { label: 'Cerrado', detail: `abre ${when} ${st.opens.time} hs` };
}

/* HTML del badge (botón que despliega el horario semanal en la tienda) */
function sfHoursBadge(st, esc = sfEsc) {
  const t = sfStatusText(st), cls = st.open ? (st.soon ? 'warn' : 'ok') : 'closed';
  return `<button type="button" class="sf-badge sf-hbadge ${cls}" data-hours-toggle aria-expanded="false" aria-controls="sfHours"><i></i><b>${esc(t.label)}</b>${t.detail ? `<span>· ${esc(t.detail)}</span>` : ''}</button>`;
}

/* Tabla semanal; resalta el día de hoy */
function sfHoursTable(h, ms = Date.now(), esc = sfEsc) {
  const today = sfNowIn(h.tz, ms).dow;
  return SF_DAYS.map(([k, name], i) => {
    const r = h.days?.[k] || [];
    return `<div class="sf-hrow${i === today ? ' today' : ''}"><span>${name}</span><span>${r.length ? r.map(([o, c]) => `${esc(o)} – ${esc(c)}`).join(' · ') : 'Cerrado'}</span></div>`;
  }).join('');
}
