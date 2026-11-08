/* node tests/js/datastore.test.js  — prueba la caché sin navegador */
const fs = require('fs'), assert = require('assert');
global.window = { dispatchEvent() {} }; global.Event = class { constructor(t) { this.type = t; } };
const load = () => new Function(fs.readFileSync(__dirname + '/../../js/datastore.js', 'utf8') + '; return DataStore;')();
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const mkServer = () => { const s = { calls: [], data: {}, delay: 0 }; s.fetch = async p => { s.calls.push(p); await tick(s.delay); return JSON.stringify(s.data[p]); }; return s; };

(async () => {
  // 1) primer pedido va a la red; el segundo sale de memoria
  let S = mkServer(), D = load(); D.init(S.fetch); S.data['/products'] = [{ id: 1 }];
  assert.deepStrictEqual(await D.get('/products'), [{ id: 1 }]);
  assert.deepStrictEqual(await D.get('/products'), [{ id: 1 }]);
  assert.strictEqual(S.calls.length, 1, 'segundo get no debe ir a la red');

  // 2) la lectura devuelve copias: mutar el resultado no ensucia la caché
  const a = await D.get('/products'); a.push({ id: 99 });
  assert.strictEqual((await D.get('/products')).length, 1);

  // 3) pedidos iguales en vuelo se deduplican
  S = mkServer(); D = load(); D.init(S.fetch); S.data['/clients'] = []; S.delay = 20;
  await Promise.all([D.get('/clients'), D.get('/clients'), D.get('/clients')]);
  assert.strictEqual(S.calls.length, 1, 'dedupe');

  // 4) invalidate: tras una escritura vuelve a pedir
  D.invalidate(); await D.get('/clients'); assert.strictEqual(S.calls.length, 2);

  // 5) una respuesta que estaba en vuelo cuando hubo una escritura NO se guarda (podría ser vieja)
  S = mkServer(); D = load(); D.init(S.fetch); S.data['/dashboard'] = { v: 'viejo' }; S.delay = 30;
  const p = D.get('/dashboard'); await tick(5); D.invalidate(); S.data['/dashboard'] = { v: 'nuevo' };
  await p; S.delay = 0;
  assert.strictEqual((await D.get('/dashboard')).v, 'nuevo', 'no debe quedar el dato viejo cacheado');

  // 6) stale-while-revalidate: devuelve lo cacheado al instante, revalida y avisa solo si cambió
  S = mkServer(); D = load(); D.init(S.fetch); S.data['/sales'] = [1]; const changed = []; D.onChange(p => changed.push(p));
  await D.get('/sales'); D.stale();
  S.data['/sales'] = [1, 2];
  const t0 = Date.now(); const got = await D.get('/sales');
  assert.deepStrictEqual(got, [1], 'devuelve lo viejo de inmediato'); assert.ok(Date.now() - t0 < 15);
  await tick(5); assert.deepStrictEqual(changed, ['/sales']);
  assert.deepStrictEqual(await D.get('/sales'), [1, 2]);
  D.stale(); await D.get('/sales'); await tick(5);   // revalida sin cambios → no avisa de nuevo
  assert.strictEqual(changed.length, 1, 'no avisa si los datos son iguales');

  // 7) rutas en vivo no se cachean
  assert.ok(!D.cacheable('/reports?from=1') && !D.cacheable('/cashflow?day=x') && !D.cacheable('/ai/history') && !D.cacheable('/me'));
  assert.ok(D.cacheable('/products') && D.cacheable('/dashboard'));

  // 8) seguimiento de dependencias por vista + precarga (máx. 2 a la vez)
  S = mkServer(); D = load(); D.init(S.fetch); S.delay = 15; ['/a', '/b', '/c', '/d'].forEach(k => S.data[k] = k);
  const deps = D.begin(); await D.get('/a'); await D.get('/b'); D.end('caja', deps);
  assert.deepStrictEqual(D.depsOf('caja'), ['/a', '/b']);
  D.clear(); S.calls.length = 0; let peak = 0, run = 0; const f0 = S.fetch;
  D.init(async p => { run++; peak = Math.max(peak, run); try { return await f0(p); } finally { run--; } });
  D.prefetch(['/a', '/b', '/c', '/d']); await tick(80);
  assert.strictEqual(S.calls.length, 4); assert.ok(peak <= 2, 'concurrencia ' + peak);
  S.calls.length = 0; await Promise.all(['/a', '/b', '/c', '/d'].map(D.get)); assert.strictEqual(S.calls.length, 0, 'ya estaba precalentado');

  console.log('datastore: OK (8 grupos de pruebas)');
})().catch(e => { console.error(e); process.exit(1); });
