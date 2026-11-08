/* Configuración · tarjeta «Horarios de atención».
   Se engancha a VIEWS.config sin tocar views.js: corre la vista original y le agrega la tarjeta al final.
   Usa api(), esc(), icon(), toast(), state y las utilidades de js/store/hours.js. */
(() => {
  const MAX = 3;                                            // franjas por día (igual que backend/hours.py)
  const DEF_RANGE = ['09:00', '18:00'];
  const blank = () => ({ enabled: false, days: Object.fromEntries(SF_DAYS.map(([k]) => [k, []])) });
  const clone = h => JSON.parse(JSON.stringify(h || blank()));

  function hoursCard() {
    let h = clone(state.user.hours), dirty = false;
    const card = document.createElement('div'); card.className = 'card cfg hrs'; card.dataset.hoursCard = '';

    const status = () => {
      if (!h.enabled) return '<span class="hrs-chip off">Horarios desactivados: la tienda muestra el badge manual del diseño</span>';
      const st = sfOpenStatus({ ...h, tz: state.user.hours?.tz }), t = st && sfStatusText(st);
      const cls = !st ? 'off' : st.open ? (st.soon ? 'warn' : 'ok') : 'closed';
      return `<span class="hrs-chip ${cls}"><i></i>Así se ve ahora tu tienda: <b>${esc(t.label)}</b>${t.detail ? ' · ' + esc(t.detail) : ''}</span>`;
    };

    const dayRow = ([k, name]) => {
      const r = h.days[k], open = r.length > 0;
      return `<div class="hrs-day${open ? '' : ' closed'}" data-day="${k}">
        <label class="hrs-name check"><input type="checkbox" data-toggle-day ${open ? 'checked' : ''}><span>${name}</span></label>
        <div class="hrs-ranges">${open ? r.map(([o, c], i) => `<div class="hrs-range" data-i="${i}">
            <input type="time" data-t="0" value="${esc(o)}" required aria-label="${name}: abre">
            <span aria-hidden="true">a</span>
            <input type="time" data-t="1" value="${esc(c)}" required aria-label="${name}: cierra">
            ${r.length > 1 ? `<button type="button" class="icon-btn" data-rm aria-label="Quitar franja del ${name}">${icon('close', 16)}</button>` : '<span class="hrs-sp"></span>'}
          </div>`).join('') : '<span class="muted">Cerrado</span>'}</div>
        ${open && r.length < MAX ? `<button type="button" class="btn btn-sm" data-add>+ Franja</button>` : '<span></span>'}
      </div>`;
    };

    const draw = () => {
      card.innerHTML = `<div class="section-title">Horarios de atención</div><div class="hrs-body">
        <p class="muted hrs-lead">Tus clientes ven en la tienda si estás <b>abiertos ahora</b> y cuándo volvés a abrir. Podés cargar más de una franja por día (por ejemplo, corte de mediodía).</p>
        <div class="error hidden" data-err role="alert"></div>
        <label class="check"><input type="checkbox" data-enabled ${h.enabled ? 'checked' : ''}>Mostrar horarios y estado «Abierto / Cerrado» en mi tienda</label>
        <div data-status>${status()}</div>
        <div class="hrs-days${h.enabled ? '' : ' off'}">${SF_DAYS.map(dayRow).join('')}</div>
        <div class="hrs-actions"><button type="button" class="btn btn-sm" data-copy ${h.days.mon.length ? '' : 'disabled'} title="Copia las franjas del lunes a todos los demás días">Copiar el lunes a todos los días</button>
          <span class="hint" data-dirty>${dirty ? 'Cambios sin guardar' : ''}</span><button type="button" class="btn btn-primary" data-save>Guardar horarios</button></div></div>`;
    };
    const touch = () => { dirty = true; const d = card.querySelector('[data-dirty]'); if (d) d.textContent = 'Cambios sin guardar'; card.querySelector('[data-status]').innerHTML = status(); };
    const err = m => { const e = card.querySelector('[data-err]'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };

    card.addEventListener('change', e => {
      const T = e.target, day = T.closest('[data-day]')?.dataset.day;
      if (T.matches('[data-enabled]')) {
        h.enabled = T.checked;
        if (h.enabled && SF_DAYS.every(([k]) => !h.days[k].length)) ['mon', 'tue', 'wed', 'thu', 'fri'].forEach(k => { h.days[k] = [[...DEF_RANGE]]; });   // primer uso: lunes a viernes de 9 a 18 como punto de partida
        dirty = true; return draw();
      }
      if (T.matches('[data-toggle-day]')) { h.days[day] = T.checked ? [[...DEF_RANGE]] : []; dirty = true; return draw(); }
      if (T.matches('[data-t]')) { h.days[day][+T.closest('[data-i]').dataset.i][+T.dataset.t] = T.value; err(''); touch(); }
    });
    card.addEventListener('click', async e => {
      const T = e.target, day = T.closest('[data-day]')?.dataset.day;
      if (T.closest('[data-add]')) {
        const r = h.days[day], last = r[r.length - 1], start = last && last[1] < '20:00' ? last[1] : '16:00';
        r.push([start, start < '22:00' ? '20:00' : '23:00']); dirty = true; return draw();
      }
      if (T.closest('[data-rm]')) { h.days[day].splice(+T.closest('[data-i]').dataset.i, 1); dirty = true; return draw(); }
      if (T.closest('[data-copy]')) { SF_DAYS.forEach(([k]) => { h.days[k] = JSON.parse(JSON.stringify(h.days.mon)); }); dirty = true; return draw(); }
      if (T.closest('[data-save]')) {
        const b = T.closest('[data-save]'); err('');
        if (h.enabled && SF_DAYS.every(([k]) => !h.days[k].length)) return err('Marcá al menos un día de atención o desactivá los horarios.');
        if (SF_DAYS.some(([k]) => h.days[k].some(r => !r[0] || !r[1]))) return err('Completá la hora de apertura y de cierre de cada franja.');
        b.disabled = true;
        try {
          state.user = await api('/store/hours', { method: 'PUT', body: { hours: h } });
          h = clone(state.user.hours); dirty = false; toast('Horarios guardados'); draw();
        } catch (ex) { err(ex.message); b.disabled = false; }
      }
    });
    draw();
    return card;
  }

  const base = VIEWS.config;
  VIEWS.config = async function (el) { await base(el); el.appendChild(hoursCard()); };
})();
