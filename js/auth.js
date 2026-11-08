/* Sesión + pantalla de Login / Registro */
const API = window.AFFARI_API || '/api';
const Session = {
  get token() { try { return localStorage.getItem('affari_token'); } catch { return null; } },
  save(t) { try { localStorage.setItem('affari_token', t); } catch {} DataStore.clear(); },
  clear() { try { localStorage.removeItem('affari_token'); } catch {} DataStore.clear(); }   // otra cuenta = otra caché
};

/* Pedido HTTP "crudo": devuelve el texto de la respuesta o lanza un Error con .status */
async function httpRequest(path, { method = 'GET', body, timeout = 0 } = {}) {
  const ctl = timeout ? new AbortController() : null, timer = ctl && setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(API + path, {
      method, signal: ctl && ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(Session.token ? { Authorization: 'Bearer ' + Session.token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    const e = new Error(err.name === 'AbortError' ? 'Tardó demasiado en responder. Probá de nuevo.' : 'No hay conexión con el servidor. Revisá tu internet.'); e.status = 0; throw e;
  } finally { clearTimeout(timer); }
  const text = await res.text();
  if (!res.ok) {
    let data = {}; try { data = JSON.parse(text); } catch {}
    const msg = typeof data.detail === 'string' ? data.detail : 'Revisá los datos ingresados e intentá de nuevo.';
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return text || '{}';
}
DataStore.init(path => httpRequest(path));

/* api(): los GET pasan por la caché (DataStore); cualquier escritura la invalida y vuelve a calentarla en segundo plano */
async function api(path, { method = 'GET', body, timeout = 0 } = {}) {
  if (method === 'GET' && !timeout && DataStore.cacheable(path)) return DataStore.get(path);
  let data;
  try { data = JSON.parse(await httpRequest(path, { method, body, timeout })); }
  catch (e) { if (e.status === 402 && method !== 'GET' && typeof Billing !== 'undefined') Billing.showUpgrade({ message: e.message }); throw e; }
  if (method !== 'GET' && !/^\/(login|register|auth\/)/.test(path)) { DataStore.invalidate(); DataStore.warmSoon(typeof state === 'undefined' ? '' : state.view); }   // incluye /ai/chat: el asistente también modifica productos y stock
  return data;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUSINESS_TYPES = ['Almacén', 'Indumentaria', 'Servicios', 'Ferretería', 'Gastronomía', 'Kiosco', 'Belleza y cuidado personal', 'Otro'];

const passField = (id, label) => `<div class="field"><label for="${id}">${label}</label>
  <div class="input">${icon('lock')}<input id="${id}" type="password" autocomplete="current-password" required minlength="8" placeholder="Mínimo 8 caracteres">
  <button type="button" class="toggle" data-toggle="${id}" aria-label="Mostrar u ocultar contraseña">${icon('eye')}</button></div></div>`;
const textField = (id, label, ico, ph, type = 'text', req = true) =>
  `<div class="field"><label for="${id}">${label}</label><div class="input">${icon(ico)}<input id="${id}" type="${type}" placeholder="${ph}" ${req ? 'required' : ''}></div></div>`;

function renderAuth(root, onSuccess, startMode = 'login', onBack = null) {
  let mode = startMode;
  const draw = () => {
    const login = mode === 'login';
    root.innerHTML = `<div class="auth">
      <aside class="auth-brand">
        <div class="brand">${LOGO_SVG}AFFARI</div>
        <div><h2>Tu negocio en orden, tus cuentas claras.</h2>
        <p>Registrá ventas, controlá el stock y llevá el cuaderno de fiados desde un solo lugar.</p></div>
        <svg class="auth-art" viewBox="0 0 440 180" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="438" height="178" rx="6" fill="#fff" stroke="#E2E8F0"/>
          <g fill="#A7F3D0"><rect x="30" y="110" width="36" height="45"/><rect x="86" y="90" width="36" height="65"/><rect x="142" y="100" width="36" height="55"/><rect x="198" y="70" width="36" height="85"/><rect x="254" y="60" width="36" height="95"/></g>
          <rect x="310" y="40" width="36" height="115" fill="#10B981"/>
          <path d="M30 100 100 78 160 88 216 56 272 46 328 24" stroke="#0F172A" stroke-width="2.5" stroke-linecap="square"/>
          <text x="368" y="60" font-family="sans-serif" font-weight="700" font-size="16" fill="#059669">+24%</text>
        </svg>
      </aside>
      <main class="auth-form-wrap"><form class="auth-card" id="authForm">
        <h1>${login ? 'Ingresá a tu cuenta' : 'Creá tu cuenta gratis'}</h1>
        <p class="sub">${login ? 'Seguí donde dejaste tu caja.' : 'Empezá a ordenar tu negocio en un minuto.'}</p>
        <div id="authError" class="error hidden" role="alert"></div>
        <div class="gsi-wrap" id="gsi" hidden></div><div class="auth-or" hidden><span>o con tu email</span></div>
        ${login ? `
          ${textField('identifier', 'Email o teléfono', 'mail', 'tu@email.com')}
          ${passField('password', 'Contraseña')}
          <div class="auth-links"><span></span><button type="button" class="link" id="forgot">¿Olvidaste tu contraseña?</button></div>
          <button class="btn btn-primary" type="submit">Iniciar sesión en Affari</button>` : `
          ${textField('name', 'Tu nombre completo', 'user', 'Ej: Marcela Gómez')}
          ${textField('business', 'Nombre del negocio', 'shop', 'Ej: Almacén Don Pepe')}
          <div class="field"><label for="btype">Tipo de negocio</label><div class="input">${icon('store')}
            <select id="btype">${BUSINESS_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div></div>
          ${textField('email', 'Email', 'mail', 'tu@email.com', 'email')}
          <div class="field"><label for="phone">Teléfono / WhatsApp <span class="req" title="Obligatorio">*</span></label><div class="input">${icon('phone')}<input id="phone" type="tel" inputmode="tel" autocomplete="tel" required aria-required="true" minlength="8" placeholder="351 555 0123"></div><small class="hint">Con código de área. Lo usamos para identificar tu comercio y enviar recordatorios de cobro.</small></div>
          ${passField('password', 'Contraseña')}
          <button class="btn btn-primary" type="submit">Crear cuenta en Affari</button>`}
        <p class="switch">${login ? '¿Todavía no tenés cuenta?' : '¿Ya tenés cuenta?'} <button type="button" class="link" id="swap">${login ? 'Crear una cuenta gratis' : 'Iniciar sesión'}</button></p>
      ${onBack ? '<p class="switch"><button type="button" class="link" id="back">Volver al inicio</button></p>' : ''}
      </form></main></div>`;
    const $ = id => root.querySelector('#' + id);
    const showErr = m => { const e = $('authError'); e.textContent = m; e.classList.remove('hidden'); };
    $('swap').onclick = () => { mode = login ? 'register' : 'login'; draw(); };
    root.querySelector('[data-toggle]').onclick = ev => {
      const inp = $('password'), show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      ev.currentTarget.innerHTML = icon(show ? 'eyeoff' : 'eye');
    };
    if (onBack) $('back').onclick = onBack;
    if (login) $('forgot').onclick = () => showErr('La recuperación por email se activa al conectar un servicio de correo.');
    GoogleAuth.mount($('gsi'), {                                   // botón «Continuar con Google» (solo si el servidor lo tiene configurado)
      text: login ? 'signin_with' : 'signup_with', onError: showErr,
      onResult: data => data.token ? (Session.save(data.token), onSuccess(data.user)) : GoogleAuth.profileStep($('authForm'), data, onSuccess, draw)
    });
    $('authForm').onsubmit = async ev => {
      ev.preventDefault();
      if (!login && !/^\d{8,15}$/.test($('phone').value.replace(/\D/g, ''))) { $('phone').focus(); return showErr('El teléfono / WhatsApp es obligatorio. Ingresalo con código de área.'); };
      const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const data = login
          ? await api('/login', { method: 'POST', body: { identifier: $('identifier').value.trim(), password: $('password').value } })
          : await api('/register', { method: 'POST', body: { name: $('name').value.trim(), business: $('business').value.trim(), business_type: $('btype').value, email: $('email').value.trim(), phone: $('phone').value.trim(), password: $('password').value } });
        Session.save(data.token); onSuccess(data.user);
      } catch (e) { showErr(e.message); btn.disabled = false; }
    };
  };
  draw();
}
