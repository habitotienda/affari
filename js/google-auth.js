/* Ingreso con Google (Google Identity Services) + paso rápido de alta (negocio y teléfono).
   Usa api(), httpRequest(), Session, esc(), icon(), textField(), BUSINESS_TYPES (auth.js).
   Si el servidor no tiene GOOGLE_CLIENT_ID, o Google no carga, el botón no aparece y el formulario normal sigue andando. */
const GoogleAuth = (() => {
  let cfg = null, lib = null, inited = false, onCredential = null;

  const config = () => cfg ||= httpRequest('/config').then(JSON.parse).catch(() => ({ google_client_id: '' }));
  const loadLib = () => lib ||= new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = ok; s.onerror = () => { lib = null; bad(new Error('gsi')); }; document.head.appendChild(s);
  });

  /* Calienta config + librería mientras la persona todavía mira la portada (el botón aparece al instante en el login) */
  const preload = () => config().then(c => c.google_client_id && loadLib()).catch(() => {});

  /* Dibuja el botón oficial de Google dentro de `host`.
     opts: { text: 'signin_with' | 'signup_with', onResult(data), onError(msg) } */
  async function mount(host, opts) {
    const { google_client_id: id } = await config(); if (!id || !host.isConnected) return;
    try { await loadLib(); } catch { return; }
    if (!host.isConnected) return;
    onCredential = async resp => {
      try { opts.onResult(await api('/auth/google', { method: 'POST', body: { credential: resp.credential } })); }
      catch (e) { opts.onError(e.message); }
    };
    if (!inited) { google.accounts.id.initialize({ client_id: id, callback: r => onCredential(r), auto_select: false, cancel_on_tap_outside: true }); inited = true; }
    host.hidden = false; const or = host.nextElementSibling; if (or && or.classList.contains('auth-or')) or.hidden = false;
    google.accounts.id.renderButton(host, { type: 'standard', theme: 'outline', size: 'large', text: opts.text, shape: 'rectangular', logo_alignment: 'left', locale: 'es', width: Math.max(200, Math.min(400, host.clientWidth || 320)) });
  }

  /* Cuenta nueva: pide solo lo imprescindible (negocio + teléfono). El nombre y el email ya vienen de Google. */
  function profileStep(form, g, onSuccess, onBack) {
    const first = esc((g.name || '').split(' ')[0] || 'bienvenido');
    form.innerHTML = `<h1>¡Hola, ${first}!</h1>
      <p class="sub">Un último paso para dejar tu negocio listo. Ingresás con <b>${esc(g.email)}</b>.</p>
      <div id="authError" class="error hidden" role="alert"></div>
      ${textField('gbiz', 'Nombre del negocio', 'shop', 'Ej: Almacén Don Pepe')}
      <div class="field"><label for="gtype">Tipo de negocio</label><div class="input">${icon('store')}<select id="gtype">${BUSINESS_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div></div>
      <div class="field"><label for="gphone">Teléfono / WhatsApp <span class="req" title="Obligatorio">*</span></label><div class="input">${icon('phone')}<input id="gphone" type="tel" inputmode="tel" autocomplete="tel" required minlength="8" placeholder="351 555 0123"></div><small class="hint">Con código de área. Lo usamos para identificar tu comercio y enviar recordatorios de cobro.</small></div>
      <button class="btn btn-primary" type="submit">Empezar a usar Affari</button>
      <p class="switch"><button type="button" class="link" id="gback">Usar otra cuenta</button></p>`;
    const $ = i => form.querySelector('#' + i), err = m => { const e = $('authError'); e.textContent = m; e.classList.remove('hidden'); };
    $('gbiz').focus(); $('gback').onclick = onBack;
    form.onsubmit = async ev => {
      ev.preventDefault();
      if (!/^\d{8,15}$/.test($('gphone').value.replace(/\D/g, ''))) { $('gphone').focus(); return err('El teléfono / WhatsApp es obligatorio. Ingresalo con código de área.'); }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const data = await api('/auth/google/complete', { method: 'POST', body: { ticket: g.ticket, business: $('gbiz').value.trim(), business_type: $('gtype').value, phone: $('gphone').value.trim() } });
        Session.save(data.token); onSuccess(data.user);
      } catch (e) { err(e.message); btn.disabled = false; }
    };
  }

  return { preload, mount, profileStep };
})();
