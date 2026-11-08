/* DataStore · caché en memoria para las consultas GET del panel (stale-while-revalidate).

   Idea: una pestaña ya visitada se pinta al instante con los datos que ya tenemos y, si están "viejos",
   se piden de nuevo EN SEGUNDO PLANO; solo si cambiaron se vuelve a dibujar la vista.

   - get(path)         → datos desde memoria (0 ms) o red. Deduplica pedidos iguales en vuelo.
   - invalidate()      → se llama tras cualquier escritura (POST/PUT/DELETE): vacía la caché.
   - prefetch(paths)   → calienta la caché sin bloquear (hover en el menú, tiempo libre tras el login).
   - onChange(fn)      → avisa cuando una revalidación trajo datos distintos (para redibujar en silencio).
   Se guarda el JSON como texto: cada lectura devuelve un objeto nuevo (las vistas pueden modificarlo sin ensuciar la caché). */
const DataStore = (() => {
  const FRESH = 30_000;               // < 30 s: se usa sin tocar la red
  const MAX_AGE = 10 * 60_000;        // > 10 min: se descarta y se espera a la red
  const NO_CACHE = [/^\/me$/, /^\/ai\//, /^\/reports/, /^\/cashflow/, /\/pdf$/, /^\/login/, /^\/register/, /^\/auth\//, /^\/config/];  // sesión, chat y vistas con actualización en vivo
  const entries = new Map(), inflight = new Map(), listeners = new Set();
  const viewDeps = {};                // vista → rutas que usó la última vez (para precargarla antes de entrar)
  let gen = 0, fetcher = null, current = null, warmTimer = 0;

  const cacheable = path => !NO_CACHE.some(r => r.test(path));
  const track = path => { if (current) current.add(path); };

  /* Pide `path` a la red, guarda el resultado y avisa si cambió. Siempre devuelve el texto JSON. */
  function fetchInto(path) {
    if (inflight.has(path)) return inflight.get(path);
    const g = gen, before = entries.get(path)?.raw;
    const p = fetcher(path).then(raw => {
      if (g === gen) {                                   // si hubo una escritura mientras volaba el pedido, la respuesta puede ser vieja: no se guarda
        entries.set(path, { raw, t: Date.now() });
        if (before !== undefined && before !== raw) listeners.forEach(fn => fn(path));
      }
      return raw;
    }).finally(() => inflight.delete(path));
    inflight.set(path, p);
    return p;
  }

  function get(path) {
    track(path);
    const e = entries.get(path), age = e ? Date.now() - e.t : Infinity;
    if (age < MAX_AGE) {
      if (age >= FRESH) fetchInto(path).catch(err => { if (err.status === 401) window.dispatchEvent(new Event('affari:unauthorized')); });
      return Promise.resolve(JSON.parse(e.raw));
    }
    return fetchInto(path).then(JSON.parse);
  }

  function invalidate() { gen++; entries.clear(); }
  function clear() { invalidate(); inflight.clear(); Object.keys(viewDeps).forEach(k => delete viewDeps[k]); }

  /* Precarga con a lo sumo 2 pedidos a la vez (no saturar el pool de conexiones de Supabase) */
  let queue = [], running = 0;
  function prefetch(paths) {
    for (const p of paths || []) {
      const e = entries.get(p);
      if (!cacheable(p) || inflight.has(p) || queue.includes(p) || (e && Date.now() - e.t < FRESH)) continue;
      queue.push(p);
    }
    pump();
  }
  function pump() {
    while (running < 2 && queue.length) {
      const p = queue.shift(); running++;
      fetchInto(p).catch(() => {}).finally(() => { running--; pump(); });
    }
  }
  /* Tras una escritura la caché queda vacía: se vuelve a calentar lo que el usuario ya visitó, sin apuro */
  function warmSoon(skip) {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => prefetch(Object.entries(viewDeps).flatMap(([v, ps]) => v === skip ? [] : ps)), 900);
  }

  /* Seguimiento de qué rutas usa cada render, para saber qué vista redibujar cuando llegan datos nuevos */
  function begin() { current = new Set(); return current; }
  function end(view, deps) { if (current === deps) current = null; if (view && deps.size) viewDeps[view] = [...deps]; }

  return {
    init(fn) { fetcher = fn; },
    cacheable, get, invalidate, clear, prefetch, warmSoon, begin, end,
    depsOf: view => viewDeps[view] || [],
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    /* Marca todo como "viejo" (conserva los datos): el próximo get() los usa y revalida de fondo */
    stale() { entries.forEach(e => { e.t = Date.now() - FRESH; }); },
    _debug: { entries, inflight }
  };
})();
