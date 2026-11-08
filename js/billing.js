/* Planes, bloqueo de funciones y pago con Mercado Pago.
   Usa state, api(), httpRequest(), openModal(), toast(), icon(), esc(), renderShell(), renderView() */
const Billing = (() => {
  // Vista del menú → función que la desbloquea (el servidor aplica el mismo bloqueo: esto solo evita pantallas vacías)
  const FEATURE_OF = { asistente: 'ai', catalogo: 'catalog', estudio: 'studio', reportes: 'reports', flujo: 'advanced', proveedores: 'advanced', deudas: 'advanced', comprobantes: 'advanced' };
  const LABEL = { ai: 'el Asistente IA', catalog: 'el Catálogo digital', studio: 'el Estudio de Diseño', reports: 'las Estadísticas y reportes', reminders: 'los recordatorios por WhatsApp', advanced: 'esta sección' };
  const PLANS = [
    { id: 'pro', name: 'Pro', price: '$9.900', cta: 'Probar Pro', hot: true,
      items: ['Productos ilimitados', 'Catálogo digital', 'Recordatorios por WhatsApp', 'Reportes avanzados', 'Asistente IA', 'Estudio de Diseño'] },
    { id: 'negocio', name: 'Negocio', price: '$19.900', cta: 'Elegir Negocio',
      items: ['Todo lo de Pro', 'Varios usuarios', 'Varias sucursales', 'Soporte prioritario'] }
  ];
  const info = () => (state.user && state.user.billing) || { features: [], state: 'free' };
  const can = f => info().features.includes(f);
  const viewLocked = v => !!FEATURE_OF[v] && !can(FEATURE_OF[v]);
  const dmy = s => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
  const days = n => `${n} ${n === 1 ? 'día' : 'días'}`;

  let busy = false;
  async function checkout(plan, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try { const r = await api('/billing/checkout', { method: 'POST', body: { plan } }); location.href = r.init_point; }
    catch (e) { toast(e.message); busy = false; if (btn) btn.disabled = false; }
  }

  function showUpgrade({ feature, message } = {}) {
    const b = info(), expired = b.state === 'free' && new Date((b.trial_ends_at || '').replace(' ', 'T')) < new Date();
    const why = message || (feature ? `Para usar ${LABEL[feature] || 'esta función'} necesitás un plan Pro o Negocio.` : '');
    const { form } = openModal({ title: 'Elegí tu plan', wide: true, hideSubmit: true, html: `
      ${why || expired ? `<p class="plan-why">${esc(why)}${expired ? ' Tu prueba de 7 días ya terminó.' : ''}</p>` : ''}
      <div class="plan-grid">${PLANS.map(p => `<div class="plan-opt ${p.hot ? 'hot' : ''}">
        ${p.hot ? '<span class="tag">Más elegido</span>' : ''}<h3>${p.name}</h3>
        <div class="price">${p.price}<small>/mes</small></div>
        <ul>${p.items.map(it => `<li>${icon('check', 16)}${it}</li>`).join('')}</ul>
        <button type="button" class="btn ${p.hot ? 'btn-primary' : ''} btn-block" data-pay="${p.id}">${p.cta}</button></div>`).join('')}</div>
      <p class="hint plan-foot">Pagás de forma segura con Mercado Pago. Cada pago activa el plan por 30 días y se acredita solo, en unos segundos.</p>` });
    form.querySelectorAll('[data-pay]').forEach(btn => btn.onclick = () => checkout(btn.dataset.pay, btn));
  }

  function lockPanel(view) {
    const f = FEATURE_OF[view], d = document.createElement('div');
    d.className = 'card lock-panel';
    d.innerHTML = `<div class="lock-ico">${icon('lock', 28)}</div><h2>Desbloqueá ${LABEL[f] || 'esta función'}</h2>
      <p>Es parte de los planes Pro y Negocio. Con el plan gratis seguís usando la caja, el cuaderno de fiados y hasta 50 productos.</p>
      <button class="btn btn-primary" type="button">Ver planes</button>`;
    d.querySelector('button').onclick = () => showUpgrade({ feature: f });
    return d;
  }

  function chipHtml() {
    const b = info(), label = { vip: 'Acceso VIP · de por vida', trial: `Prueba Pro · ${days(b.days_left || 0)}`,
      paid: `Plan ${b.plan === 'negocio' ? 'Negocio' : 'Pro'} · hasta ${dmy(b.until)}`, free: 'Plan Gratis · Mejorar' }[b.state] || 'Plan Gratis · Mejorar';
    return `<button class="plan-chip ${b.state}" id="plan-chip" type="button">${esc(label)}</button>`;
  }
  function bindChip() { const c = document.getElementById('plan-chip'); if (c) c.onclick = () => info().state === 'vip' ? toast('Tu cuenta tiene acceso total de por vida') : showUpgrade(); }

  async function reload() { state.user = JSON.parse(await httpRequest('/me')); renderShell(); renderView(); }

  // Después de iniciar sesión: vuelta desde Mercado Pago (?pago=…) o plan elegido en la landing
  async function afterLogin() {
    const pago = new URLSearchParams(location.search).get('pago');
    if (pago) {
      history.replaceState(null, '', location.pathname);
      if (pago === 'ok') {
        toast('Pago recibido. Activando tu plan…');
        for (let i = 0; i < 8 && info().state !== 'paid'; i++) { await new Promise(r => setTimeout(r, 3000)); try { await reload(); } catch {} }
        if (info().state === 'paid') toast('¡Plan activado! Ya tenés todo desbloqueado.');
      } else toast(pago === 'pendiente' ? 'Tu pago está pendiente. Se activa solo cuando se acredite.' : 'No se completó el pago. Podés intentarlo de nuevo.');
      return;
    }
    let plan = null; try { plan = sessionStorage.getItem('affariPlan'); sessionStorage.removeItem('affariPlan'); } catch {}
    if (plan && info().state !== 'vip') checkout(plan);
  }

  // Recordatorios por WhatsApp (wa.me con texto y el atajo del panel): bloqueados sin plan
  document.addEventListener('click', e => {
    if (!state.user || can('reminders')) return;
    if (e.target.closest('a[href*="wa.me"][href*="text="], #wa')) { e.preventDefault(); e.stopImmediatePropagation(); showUpgrade({ feature: 'reminders' }); }
  }, true);

  return { can, viewLocked, showUpgrade, lockPanel, chipHtml, bindChip, afterLogin, checkout };
})();
