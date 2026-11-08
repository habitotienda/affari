/* node tests/js/navigation.test.js
   Integración: carga datastore.js + auth.js + google-auth.js + app.js REALES con un DOM mínimo y un servidor falso lento (300 ms por pedido, como Supabase).
   Verifica que cambiar de sección sea instantáneo, que no haya pedidos repetidos y que los datos se mantengan al día. */
const fs = require('fs'), assert = require('assert');
const src = f => fs.readFileSync(__dirname + '/../../js/' + f, 'utf8');
const tick = ms => new Promise(r => setTimeout(r, ms));

// ---- servidor falso
const srv = { delay: 300, calls: [], db: { '/sales': [{ id: 1 }], '/clients': [{ id: 7 }], '/products': [{ id: 3 }] } };
const fetch = async (url, o = {}) => {
  const p = url.replace('/api', ''); srv.calls.push((o.method || 'GET') + ' ' + p); await tick(srv.delay);
  const body = o.method && o.method !== 'GET' ? { ok: true } : (srv.db[p] ?? (p === '/config' ? { google_client_id: '' } : {}));
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
// ---- DOM mínimo
const mkEl = () => ({ classes: new Set(), html: '', kids: [], classList: { toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, add(c) { this._s.add(c); }, _s: null }, contains: () => false,
  set innerHTML(v) { this.html = v; this.kids = []; }, get innerHTML() { return this.html; }, replaceChildren(...k) { this.kids = k; this.html = ''; }, appendChild() {}, querySelectorAll: () => [], querySelector: () => null });
const view = mkEl(); view.classList._s = view.classes;
const doc = { getElementById: id => id === 'view' ? view : mkEl(), createElement: () => ({ childNodes: ['<rendered/>'] }), addEventListener() {}, querySelector: () => null, activeElement: { tagName: 'BODY' }, hidden: false, body: { classList: { toggle() {}, remove() {} } } };
const win = { addEventListener() {}, matchMedia: () => ({ addEventListener() {} }), scrollTo() {}, dispatchEvent() {} };

const code = 'const VIEWS = {};\n' + src('datastore.js') + src('auth.js') + src('google-auth.js') + src('app.js').replace(/\nboot\(\);\s*$/, '\n') + `
  window.__t = { state, VIEWS, renderView, go, api, DataStore, viewPaths };`;
new Function('document', 'window', 'fetch', 'localStorage', 'LOGO_SVG', 'icon', 'renderLanding', 'renderAuth', code)(
  doc, win, fetch, { getItem: () => null, setItem() {}, removeItem() {} }, '', () => '', () => {}, () => {});
const T = win.__t;

(async () => {
  T.state.user = { name: 'Ana Gómez', business: 'Kiosco' };
  let renders = 0;
  T.VIEWS.caja = async el => { const [a, b] = await Promise.all([T.api('/sales'), T.api('/clients')]); renders++; el.innerHTML = JSON.stringify([a, b]); };
  T.VIEWS.fiados = async el => { const c = await T.api('/clients'); renders++; el.innerHTML = JSON.stringify(c); };
  const nav = async v => { T.state.view = v; const t0 = performance.now(); await T.renderView(); return performance.now() - t0; };

  // 1) primera visita: viaja a la red (300 ms) y, como pasa de 120 ms, muestra el esqueleto
  let ms = await nav('caja'); assert.ok(ms >= 290, 'primera visita espera a la red: ' + ms);
  assert.deepStrictEqual(srv.calls.sort(), ['GET /clients', 'GET /sales'], 'pedidos en paralelo, uno por ruta');
  assert.ok(view.kids.length === 1 && view.classes.has('still') === false, 'tras esperar, la vista entra con su animación corta');

  // 2) volver a la misma vista: instantáneo y SIN pedidos nuevos
  srv.calls.length = 0; ms = await nav('caja'); assert.ok(ms < 30, 'vista ya visitada en ' + ms + ' ms'); assert.strictEqual(srv.calls.length, 0);
  assert.ok(view.classes.has('still'), 'render instantáneo: sin animación de entrada');

  // 3) otra vista que comparte /clients: también instantánea (dato ya en memoria)
  ms = await nav('fiados'); assert.ok(ms < 30 && srv.calls.length === 0, 'fiados reutiliza /clients: ' + ms + ' ms');

  // 4) hover: la vista se precarga antes del clic
  T.DataStore.invalidate(); srv.calls.length = 0;        // caché vacía, pero la vista «recuerda» qué rutas usa
  assert.deepStrictEqual(T.viewPaths('caja').sort(), ['/clients', '/sales']);
  T.DataStore.prefetch(T.viewPaths('caja')); await tick(700);
  srv.calls.length = 0; ms = await nav('caja'); assert.ok(ms < 30 && srv.calls.length === 0, 'precargada: ' + ms + ' ms');

  // 5) escritura → caché vacía → el siguiente render trae datos frescos
  await T.api('/sales', { method: 'POST', body: { amount: 10 } });
  srv.db['/sales'] = [{ id: 1 }, { id: 2 }]; srv.calls.length = 0;
  ms = await nav('caja'); assert.ok(srv.calls.includes('GET /sales') && view.kids.length === 1, 'después de vender se vuelven a pedir los datos');

  // 6) datos viejos (>30 s): se dibuja YA con lo que hay y se revalida de fondo; si cambió, se redibuja sola
  T.DataStore.stale(); srv.db['/sales'] = [{ id: 1 }, { id: 2 }, { id: 3 }]; srv.calls.length = 0; renders = 0;
  ms = await nav('caja'); assert.ok(ms < 30, 'con datos viejos igual es instantáneo: ' + ms);
  await tick(450);
  assert.ok(srv.calls.includes('GET /sales'), 'revalidó en segundo plano'); assert.ok(renders >= 2, 'redibujó al llegar datos distintos (renders=' + renders + ')');

  // 7) no se redibuja si hay un campo en foco (la persona está escribiendo)
  doc.activeElement = { tagName: 'INPUT' }; view.contains = () => true; T.DataStore.stale(); srv.db['/sales'] = [{ id: 9 }]; renders = 0;
  await nav('caja'); renders = 0; await tick(450); assert.strictEqual(renders, 0, 'no pisa lo que se está escribiendo');

  console.log('navigation: OK  (primera visita ~300 ms · visitas siguientes < 30 ms · sin pedidos repetidos)');
})().catch(e => { console.error(e); process.exit(1); });
