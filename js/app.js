/* Frontend principal: ruteo de vistas y dashboard */
const root = document.getElementById('root');
const ars = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const NAV = [
  ['dashboard', 'Dashboard', 'dashboard'], ['caja', 'Caja y Ventas', 'cash'], ['flujo', 'Flujo de caja', 'wallet'], ['reportes', 'Estadísticas', 'trend'],
  ['inventario', 'Inventario & Stock', 'box'], ['asistente', 'Asistente IA', 'spark'], ['fiados', 'Cuaderno de Fiados', 'book'], ['deudas', 'Deudas', 'scale'], ['clientes', 'Clientes', 'users'],
  ['proveedores', 'Proveedores', 'truck'], ['comprobantes', 'Comprobantes', 'receipt'], ['catalogo', 'Catálogo Digital', 'store'], ['estudio', 'Estudio de Diseño', 'palette'], ['config', 'Configuración', 'settings']
];
const state = { user: null, view: 'dashboard', tk: 0 };
/* ---------- PWA: instalación y Service Worker ---------- */
const PWA = (() => {
  let deferred = null;                                       // evento beforeinstallprompt guardado
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const btn = () => document.getElementById('install-app');
  const sync = () => { const b = btn(); if (b) b.style.display = deferred && !standalone() ? '' : 'none'; };

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; sync(); });
  window.addEventListener('appinstalled', () => { deferred = null; sync(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => console.warn('[affari] Service Worker no registrado:', err));
    });
  }
  return {
    bindButton() {                                           // se llama cada vez que se dibuja el menú
      const b = btn(); if (!b) return;
      b.onclick = async () => {
        if (!deferred) return;
        deferred.prompt();
        await deferred.userChoice.catch(() => {});
        deferred = null; sync();
      };
      sync();
    }
  };
})();

const refresh = () => renderView(true);

/* ---------- Velocidad entre secciones ----------
   Los datos viven en DataStore (js/datastore.js): una pestaña ya visitada se dibuja al instante desde memoria y se actualiza sola de fondo. */
/* Vistas de solo lectura: si llegan datos nuevos mientras se miran, se redibujan solas. Las demás (editor del catálogo, estudio, asistente, configuración)
   nunca se pisan: tienen formularios o un borrador en curso. */
const LIVE_SAFE = new Set(['dashboard', 'caja', 'fiados', 'inventario', 'clientes', 'proveedores', 'deudas', 'comprobantes']);
/* Rutas de cada vista la primera vez (después se aprenden solas de lo que realmente pide cada una) */
const WARM = { dashboard: ['/dashboard'], caja: ['/dashboard', '/sales'], inventario: ['/products'], fiados: ['/clients'], clientes: ['/clients'],
  proveedores: ['/suppliers'], deudas: ['/debts'], comprobantes: ['/invoices', '/fiscal'], catalogo: ['/products'] };
const viewPaths = v => DataStore.depsOf(v).length ? DataStore.depsOf(v) : (WARM[v] || []);
const SKELETON = '<div class="skel" aria-busy="true" aria-label="Cargando"><div class="skel-h"></div><div class="skel-row"><i></i><i></i><i></i><i></i></div><div class="skel-card"></div></div>';
/* Con localStorage.affariPerf = 1 la consola muestra cuánto tarda cada cambio de sección */
const perf = (view, t0, silent) => { try { if (localStorage.getItem('affariPerf')) console.log(`[affari] ${view}${silent ? ' (en segundo plano)' : ''}: ${Math.round(performance.now() - t0)} ms`); } catch {} };
/* Precalienta en tiempo libre las pantallas principales: cuando la persona hace clic, los datos ya están */
function warmIdle() { (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => DataStore.prefetch(Object.values(WARM).flat()), { timeout: 4000 }); }

DataStore.onChange(path => {                         // una revalidación de fondo trajo datos distintos
  if (!state.user || !LIVE_SAFE.has(state.view) || !DataStore.depsOf(state.view).includes(path)) return;
  const v = document.getElementById('view'), a = document.activeElement;
  if (document.querySelector('.modal-overlay') || (v && v.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;   // no pisar un diálogo ni lo que se está escribiendo
  renderView(true);
});
window.addEventListener('affari:unauthorized', () => { if (state.user) logout(); });
let hiddenAt = 0;                                   // al volver a la pestaña después de un rato, se refrescan los datos de fondo
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (state.user && Date.now() - hiddenAt > 30000) { DataStore.stale(); viewPaths(state.view).forEach(p => DataStore.get(p).catch(() => {})); }
});

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}

function logout() { if (state.stop) state.stop(); setDrawer(false); Session.clear(); state.user = null; state.draft = null; boot(); }

/* Menú lateral en celular (botón de tres rayas): se abre como cajón sobre el contenido */
function setDrawer(open) {
  state.drawer = !!open;
  const app = root.querySelector('.app'); if (!app) return;
  app.classList.toggle('drawer-open', state.drawer);
  document.body.classList.toggle('no-scroll', state.drawer);
  const b = root.querySelector('#menu'); if (b) b.setAttribute('aria-expanded', String(state.drawer));
  if (state.drawer) root.querySelector('.nav button.active')?.focus({ preventScroll: true });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.drawer) setDrawer(false); });
window.matchMedia('(min-width:901px)').addEventListener('change', e => { if (e.matches) setDrawer(false); });

function renderShell() {
  const u = state.user, initial = esc(u.name[0].toUpperCase());
  state.drawer = false; document.body.classList.remove('no-scroll');
  root.innerHTML = `<div class="app">
    <header class="topbar">
      <button class="icon-btn menu-btn" id="menu" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="sidebar">${icon('menu', 26)}</button>
      <div class="brand">${LOGO_SVG}AFFARI</div>
      <div class="avatar" aria-hidden="true">${initial}</div>
    </header>
    <div class="scrim" id="scrim"></div>
    <aside class="sidebar" id="sidebar" aria-label="Menú principal">
      <div class="brand">${LOGO_SVG}AFFARI<button class="icon-btn drawer-close" id="menu-close" type="button" aria-label="Cerrar menú">${icon('close', 22)}</button></div>
      <nav class="nav" aria-label="Principal">${NAV.map(([id, label, ic]) =>
        `<button data-view="${id}" class="${state.view === id ? 'active' : ''}" ${state.view === id ? 'aria-current="page"' : ''}>${icon(ic, 20)}<span>${label}</span></button>`).join('')}</nav>
      <div class="side-foot">
        <button class="btn" id="install-app" type="button" style="display:none">${icon('box')}Instalar aplicación</button>
        ${Billing.chipHtml()}
        <span class="cash-badge">Caja abierta</span>
        <div class="who"><div class="avatar">${initial}</div><div><strong>${esc(u.name.split(' ')[0])}</strong><small>${esc(u.business)}</small></div></div>
        <button class="btn" id="logout">${icon('logout')}Cerrar sesión</button>
      </div>
    </aside>
    <main class="main" id="view"></main></div>`;
  root.querySelectorAll('[data-view]').forEach(b => {
    b.onclick = () => go(b.dataset.view);
    const warm = () => DataStore.prefetch(viewPaths(b.dataset.view));          // los datos empiezan a bajar antes del clic
    b.addEventListener('pointerenter', warm); b.addEventListener('focus', warm); b.addEventListener('touchstart', warm, { passive: true });
  });
  root.querySelector('#logout').onclick = logout;
  PWA.bindButton(); Billing.bindChip();
  root.querySelector('#menu').onclick = () => setDrawer(!state.drawer);
  root.querySelector('#menu-close').onclick = () => setDrawer(false);
  root.querySelector('#scrim').onclick = () => setDrawer(false);
  const side = root.querySelector('#sidebar'); let x0 = null;      // deslizar el cajón hacia la izquierda lo cierra
  side.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  side.addEventListener('touchend', e => { if (x0 !== null && e.changedTouches[0].clientX - x0 < -60) setDrawer(false); x0 = null; }, { passive: true });
}
function go(view) {
  if (state.stop) state.stop();          // corta la actualización en vivo de la vista anterior
  state.view = view;
  root.querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === view; b.classList.toggle('active', on);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  setDrawer(false); window.scrollTo(0, 0);
  renderView();
}

async function renderView(silent) {
  const el = document.getElementById('view'); if (!el) return;
  const view = state.view, tk = ++state.tk, tmp = document.createElement('div'), t0 = performance.now(), deps = DataStore.begin();
  // El esqueleto aparece solo si la vista tarda más de 120 ms (con datos en caché nunca se ve: no hay «Cargando…» entre secciones)
  const loader = silent ? 0 : setTimeout(() => { if (tk === state.tk) el.innerHTML = SKELETON; }, 120);
  try {
    if (Billing.viewLocked(view)) tmp.appendChild(Billing.lockPanel(view));      // función avanzada sin plan: panel de bloqueo en vez de la vista
    else if (view === 'dashboard') drawDashboard(tmp, await api('/dashboard')); else await VIEWS[view](tmp);
    if (tk === state.tk) {
      el.classList.toggle('still', !!silent || performance.now() - t0 < 100);   // render instantáneo → sin animación de entrada
      el.replaceChildren(...tmp.childNodes); perf(view, t0, silent);
    }
  } catch (e) { if (e.status === 401) return logout(); if (e.status === 402) { if (tk === state.tk) el.replaceChildren(Billing.lockPanel(view)); return; } if (tk === state.tk) el.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  finally { clearTimeout(loader); DataStore.end(view, deps); }
}

function drawDashboard(el, d) {
  const h = new Date().getHours(), hi = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const k = d.kpis, label = { entrada: 'Entrada', salida: 'Salida', fiado: 'Fiado' };
  el.innerHTML = `
    <header class="page-head">
      <div><h1>${hi}, ${esc(state.user.name.split(' ')[0])}</h1><p>${esc(state.user.business)} · ${date}</p></div>
      <button class="btn btn-primary" data-sale>${icon('plus')}Nueva venta</button>
    </header>
    <section class="kpis">
      <div class="card kpi pos"><span>Ventas del día</span><strong>${ars(k.sales_today)}</strong><small>${k.sales_count} operaciones</small></div>
      <div class="card kpi"><span>Flujo de caja</span><strong>${ars(k.cash + k.transfer + k.card)}</strong><small>Efvo ${ars(k.cash)} · Transf. ${ars(k.transfer)} · Tarj. ${ars(k.card)}</small></div>
      <div class="card kpi"><span>Fiados pendientes</span><strong>${ars(k.fiados)}</strong><small>${k.fiados_clients} clientes por cobrar · debés ${ars(k.payable)}</small></div>
      <div class="card kpi pos"><span>Ganancia estimada</span><strong>${ars(k.profit)}</strong><small>Ventas menos costo</small></div>
    </section>
    <section class="shortcuts">
      <button class="card shortcut" data-sale>${icon('cash', 22)}Registrar venta</button>
      <button class="card shortcut" data-fiado>${icon('book', 22)}Anotar fiado</button>
      <button class="card shortcut" data-stock>${icon('box', 22)}Ingresar stock</button>
      <button class="card shortcut" id="wa">${icon('whatsapp', 22)}Recordatorio WhatsApp</button>
    </section>
    <section class="cols">
      <div class="card"><div class="section-title">Últimos movimientos</div>
        ${d.movements.length ? `<table><thead><tr><th>Concepto</th><th>Tipo</th><th>Medio</th><th class="num">Monto</th></tr></thead><tbody>
          ${d.movements.map(m => `<tr><td>${esc(m.concept)}</td><td><span class="badge b-${m.kind}">${label[m.kind]}</span></td><td>${esc(m.method)}</td><td class="num">${m.kind === 'salida' ? '−' : ''}${ars(m.amount)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Todavía no registraste movimientos. Empezá con tu primera venta.</div>'}
      </div>
      <aside class="card"><div class="section-title">Stock bajo ${icon('alert', 16)}</div>
        ${d.low_stock.length ? `<ul class="alert-list">${d.low_stock.map(p => `<li><div>${esc(p.name)}<small>Mínimo ${p.min_stock}</small></div><span class="stock-n">${p.stock} u.</span></li>`).join('')}</ul>` : '<div class="empty">Todo el stock está en orden.</div>'}
      </aside>
    </section>`;
  el.querySelectorAll('[data-sale]').forEach(b => b.onclick = () => openSaleModal());
  el.querySelector('[data-fiado]').onclick = () => openFiadoModal();
  el.querySelector('[data-stock]').onclick = () => openStockModal();
  el.querySelector('#wa').onclick = openReminderModal;
}

async function boot() {
  if (Session.token) {
    DataStore.prefetch(['/dashboard']);                       // el dashboard baja en paralelo con /me (antes iban uno detrás del otro)
    try { state.user = await api('/me'); renderShell(); renderView(); warmIdle(); Billing.afterLogin(); return; }
    catch (e) {
      if (e.status !== 401) {                                 // sin internet o servidor caído: no se cierra la sesión, se ofrece reintentar
        root.innerHTML = `<div class="empty" style="margin:20vh auto;max-width:360px">${esc(e.message)}<br><br><button class="btn btn-primary" id="retry">Reintentar</button></div>`;
        return root.querySelector('#retry').addEventListener('click', boot);
      }
      Session.clear();
    }
  }
  const onAuth = u => { state.user = u; state.view = 'dashboard'; renderShell(); renderView(); warmIdle(); Billing.afterLogin(); };
  const showAuth = mode => { window.scrollTo(0, 0); renderAuth(root, onAuth, mode, showLanding); };
  function showLanding() { window.scrollTo(0, 0); GoogleAuth.preload(); renderLanding(root, { onLogin: () => showAuth('login'), onRegister: () => showAuth('register') }); }
  showLanding();
}
boot();
