/* Catálogo · verificador de fotos principales.
   La primera foto de cada producto se baja de forma diferida (sfLazyCards) y utils.js reintenta las que fallan o se cuelgan, pero nada comprobaba
   que, al final, TODAS hubieran quedado cargadas: una foto lejana nunca iniciada, una que perdió su src o una que agotó los reintentos
   se quedaban en blanco hasta que el visitante tocaba o volvía a entrar.
   sfImageGuard revisa las tarjetas de la lista y se ocupa de lo que falta, SOLO de las que están en pantalla o cerca (NEAR px).
   Las lejanas esperan: no se baja nada que el visitante todavía no esté por ver. Al hacer scroll se vuelve a revisar.
   · sin iniciar  -> la descarga (si el lazy-load no llegó), las más cercanas primero y pocas a la vez;
   · sin src      -> la repone con la URL que tenía;
   · rota         -> (sf-broken, o terminó de cargar sin ancho) la reintenta hasta 3 rondas y, desde la 2.ª, pide la foto original en vez de la miniatura;
   · en reintento -> no la toca: de esas se encarga utils.js (así no se duplican pedidos).
   Se rearma sola al volver la conexión o la pestaña. Se detiene cuando todas están cargadas o ya no hay nada más por intentar.
   API: sfImageGuard.watch(cards)  ·  .status() -> { total, ok, loading, pending, broken, failed, done }  ·  .stop()
   Evento: document 'sf:images' con detail = status() cada vez que cambia el recuento. */
(() => {
  if (window.sfImageGuard) return;
  const CONC = 4,            // descargas simultáneas iniciadas por el verificador
    ROUNDS = 3,              // rondas de reintento para una foto rota antes de darla por perdida
    RUN_MAX = 45000,         // una descarga iniciada por el verificador se considera colgada a los 45 s
    NEAR = 900,              // px (arriba o abajo de la pantalla) dentro de los que una foto sin pedir ya se considera «por ver»
    FAST = 350, SLOW = 3000; // cada cuánto revisa: con descargas en curso / en espera
  let cards = [], timer = null, last = '';
  const run = new Map(), rounds = new WeakMap(), want = new WeakMap();   // img -> inicio · img -> rondas · img -> URL original

  const mainImg = card => card.querySelector('.sf-slides img');
  const imgs = () => cards.filter(c => c.isConnected).map(mainImg).filter(Boolean);
  const stateOf = img => {
    const src = img.getAttribute('src');
    if (img.hasAttribute('data-first')) return 'pending';                 // todavía no se pidió
    if (!src) return want.has(img) ? 'lost' : 'pending';
    if (img.classList.contains('sf-broken')) return 'broken';
    if (img.complete) return img.naturalWidth > 0 ? 'ok' : (img.dataset.rt ? 'loading' : 'broken');
    return 'loading';
  };
  const remember = img => { if (!want.has(img)) { const u = img.dataset.first || img.dataset.src0 || img.getAttribute('src'); if (u) want.set(img, u); } };
  const dist = img => { const r = img.getBoundingClientRect(); return r.bottom < 0 ? -r.bottom : r.top > innerHeight ? r.top - innerHeight : 0; };

  function status() {
    const s = { total: 0, ok: 0, loading: 0, pending: 0, broken: 0, failed: 0, done: false };
    imgs().forEach(img => {
      const st = stateOf(img); if ((st === 'pending' || st === 'lost') && dist(img) > NEAR) return;   // lejana: todavía no cuenta
      s.total++;
      if (st === 'ok') s.ok++; else if (st === 'loading') s.loading++; else if (st === 'pending' || st === 'lost') s.pending++;
      else { s.broken++; if ((rounds.get(img) || 0) >= ROUNDS) s.failed++; }
    });
    s.done = s.ok + s.failed === s.total;
    return s;
  }

  function begin(img, st) {
    remember(img);
    const n = (rounds.get(img) || 0) + (st === 'broken' ? 1 : 0);
    rounds.set(img, n);
    run.set(img, Date.now());
    if (st === 'pending') { img.src = img.dataset.first; img.removeAttribute('data-first'); return; }
    let u = want.get(img) || img.dataset.src0 || img.getAttribute('src') || '';
    if (!u) return;
    if (n >= 2) u = u.replace(/([?&])w=\d+&?/, '$1').replace(/[?&]$/, '');   // la miniatura no sale: se pide la foto original
    img.dataset.src0 = u;
    if (st === 'lost') { img.src = u; return; }
    if (typeof window.sfImgRetry === 'function') window.sfImgRetry(img);   // utils.js: salta cachés rotas y vuelve a vigilarla
    else { img.classList.remove('sf-broken'); img.src = u + (u.includes('?') ? '&' : '?') + '_g=' + Date.now(); }
  }

  function tick() {
    timer = null;
    const now = Date.now(), list = imgs();
    for (const [img, t] of run) { const st = stateOf(img); if (!img.isConnected || st === 'ok' || st === 'broken' || st === 'lost' || now - t > RUN_MAX) run.delete(img); }
    if (!document.hidden && navigator.onLine !== false) {
      const todo = list.filter(i => !run.has(i)).map(i => [i, stateOf(i)])
        .filter(([i, st]) => ((st === 'pending' || st === 'lost') && dist(i) <= NEAR) || (st === 'broken' && (rounds.get(i) || 0) < ROUNDS))
        .sort((a, b) => dist(a[0]) - dist(b[0]));
      todo.slice(0, Math.max(0, CONC - run.size)).forEach(([i, st]) => begin(i, st));
    }
    const s = status(), key = [s.ok, s.loading, s.pending, s.broken, s.failed].join();
    if (key !== last) { last = key; try { document.dispatchEvent(new CustomEvent('sf:images', { detail: s })); } catch (e) { /* sin CustomEvent */ } }
    if (!s.done) timer = setTimeout(tick, run.size || s.loading ? FAST : SLOW);
  }
  const kick = (ms = 0) => { if (!timer || ms === 0) { clearTimeout(timer); timer = setTimeout(tick, ms); } };

  const revive = () => { imgs().forEach(i => { if (stateOf(i) === 'broken') rounds.set(i, 0); }); kick(); };
  let st0 = 0; document.addEventListener('scroll', () => { if (!st0) st0 = setTimeout(() => { st0 = 0; if (cards.length) kick(); }, 250); }, { capture: true, passive: true });   // al acercarse a más fotos, vuelve a revisar
  addEventListener('online', revive); addEventListener('pageshow', revive);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revive(); });
  document.addEventListener('load', e => { if (e.target instanceof HTMLImageElement && run.has(e.target)) kick(); }, true);   // terminó una: arranca la siguiente sin esperar

  window.sfImageGuard = {
    watch(list) { cards = [...(list || [])]; run.clear(); last = ''; kick(); return this; },
    status, stop() { clearTimeout(timer); timer = null; cards = []; run.clear(); }
  };
})();
