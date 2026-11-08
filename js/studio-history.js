/* ==========================================================================
   Affari · Estudio de Diseño — FASE 3 · historial (deshacer / rehacer) + borrador
   · Cada cambio (agregar, quitar, modificar, cambiar fondo o formato) toma una «foto» del lienzo,
     agrupando los cambios seguidos en una sola (300 ms) para que un arrastre = un paso.
   · Las imágenes grandes (data URL) se guardan una sola vez en un «pool»: 40 pasos no pesan 40 veces.
   · El borrador se guarda solo en localStorage y se ofrece recuperar al volver a abrir el estudio.
   Atajos: Ctrl/⌘+Z deshacer · Ctrl/⌘+Shift+Z o Ctrl+Y rehacer.
   ========================================================================== */
(() => {
  'use strict';
  const Studio = window.Studio; if (!Studio || !Studio.kit.applyBg) return;
  const kit = Studio.kit;

  const MAX_STEPS = 40;
  const DRAFT_DAYS = 14;
  const POOL_MIN = 1500;                       // solo se «poolean» imágenes con src más largo que esto

  const draftKey = () => {
    let id = 'x';
    try { const u = state && state.user; id = (u && (u.store_id || u.slug || u.id)) || 'x'; } catch (_) { /* sin sesión */ }
    return 'affari_studio_draft:' + id;
  };

  Studio.use((api) => {
    const fc = api.canvas();
    const H = { stack: [], i: -1, restoring: false, timer: 0, saveTimer: 0, pool: [], poolIdx: new Map(), dead: false };

    /* ------------------------------------------------------------- helpers */
    const fmtId = () => { const { w, h } = api.size(); return (Studio.CONFIG.formats.find(f => f.w === w && f.h === h) || {}).id; };
    const bgSig = (bg) => !bg ? '' : bg.type === 'image' ? 'image:' + bg.url.length + ':' + bg.url.slice(-48) : JSON.stringify(bg);
    const walk = (list, fn) => (list || []).forEach(o => { fn(o); if (o.objects) walk(o.objects, fn); });

    function pool(data) {                                           // src largos → '__pool:n'
      walk(data.objects, (o) => {
        if (o.type !== 'image' || typeof o.src !== 'string' || o.src.length < POOL_MIN) return;
        let n = H.poolIdx.get(o.src);
        if (n === undefined) { n = H.pool.push(o.src) - 1; H.poolIdx.set(o.src, n); }
        o.src = '__pool:' + n;
      });
    }
    function unpool(data) {
      walk(data.objects, (o) => { if (typeof o.src === 'string' && o.src.startsWith('__pool:')) o.src = H.pool[+o.src.slice(7)] || ''; });
    }
    const serialize = () => { const d = fc.toJSON(['name']); delete d.backgroundImage; return d; };   // el fondo-imagen vive en kit.bg

    function take() {
      const d = serialize(); pool(d);
      return { j: JSON.stringify(d), bg: kit.bg ? Object.assign({}, kit.bg) : null, fmt: fmtId() };
    }
    const same = (a, b) => !!a && !!b && a.j === b.j && a.fmt === b.fmt && bgSig(a.bg) === bgSig(b.bg);

    function buttons() {
      api.setEnabled('undo', H.i > 0);
      api.setEnabled('redo', H.i < H.stack.length - 1);
    }

    let notice = null;                                              // aviso «recuperar borrador» (mientras está visible no se pisa el borrador)

    /* -------------------------------------------------------------- guardar */
    function commit() {
      clearTimeout(H.timer); H.timer = 0;
      if (H.restoring || H.dead) return;
      const snap = take();
      if (same(snap, H.stack[H.i])) return;
      dismissNotice();                                              // editar = renunciar al borrador viejo
      H.stack.length = H.i + 1;                                     // lo que había para «rehacer» se descarta
      H.stack.push(snap);
      if (H.stack.length > MAX_STEPS) H.stack.shift();
      H.i = H.stack.length - 1;
      buttons(); queueSave();
    }
    const schedule = () => { if (H.restoring || H.dead) return; clearTimeout(H.timer); H.timer = setTimeout(commit, 300); };
    const flush = () => { if (H.timer) commit(); };

    /* ------------------------------------------------------------ restaurar */
    function load(snap, done) {
      H.restoring = true;
      const finish = () => {
        fc.discardActiveObject(); fc.requestRenderAll();
        fc.fire('selection:cleared');                               // refresca capas y propiedades
        H.restoring = false; buttons(); done && done();
      };
      try {
        if (snap.fmt && snap.fmt !== fmtId()) api.setFormat(snap.fmt);
        const data = JSON.parse(snap.j); unpool(data);
        fc.loadFromJSON(data, () => {
          kit.bg = snap.bg ? Object.assign({}, snap.bg) : { type: 'solid', color: '#FFFFFF' };
          kit.applyBg(api, kit.bg);                                 // recalcula degradé / imagen para el tamaño actual
          finish();
        });
      } catch (err) { console.error('[Studio] historial', err); H.restoring = false; api.toast('No se pudo restaurar ese paso.'); }
    }
    function step(d) {
      if (H.restoring) return;
      flush();
      const n = H.i + d; if (n < 0 || n >= H.stack.length) return;
      H.i = n; load(H.stack[n], queueSave);
    }
    const undo = () => step(-1), redo = () => step(1);

    /* -------------------------------------------------------------- borrador */
    function queueSave() { clearTimeout(H.saveTimer); H.saveTimer = setTimeout(saveDraft, 1500); }
    function saveDraft() {
      if (H.dead || notice) return;                                 // con el aviso visible, el borrador viejo todavía no se toca
      try {
        const objs = fc.getObjects().length;
        if (!objs) { localStorage.removeItem(draftKey()); return; }
        localStorage.setItem(draftKey(), JSON.stringify({ t: Date.now(), fmt: fmtId(), bg: kit.bg || null, c: serialize() }));
      } catch (_) { try { localStorage.removeItem(draftKey()); } catch (__) { /* sin espacio: el borrador es opcional */ } }
    }
    function dismissNotice() { if (notice) { notice.remove(); notice = null; } }

    function offerDraft() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (_) { d = null; }
      if (!d || !d.c || !(d.c.objects || []).length || Date.now() - d.t > DRAFT_DAYS * 864e5) return;
      const stage = api.root.querySelector('[data-r="stage"]'); if (!stage) return;
      const ago = Math.max(1, Math.round((Date.now() - d.t) / 6e4));
      const when = ago < 60 ? `hace ${ago} min` : ago < 1440 ? `hace ${Math.round(ago / 60)} h` : `hace ${Math.round(ago / 1440)} d`;
      notice = document.createElement('div');
      notice.className = 'st-notice'; notice.setAttribute('role', 'status');
      notice.innerHTML = `<span>Tenés un diseño sin terminar <small>(${when})</small></span>
        <button type="button" class="st-btn is-primary" data-n="ok">Recuperar</button>
        <button type="button" class="st-btn" data-n="no">Descartar</button>`;
      notice.onclick = (e) => {
        const b = e.target.closest('[data-n]'); if (!b) return;
        if (b.dataset.n === 'no') { try { localStorage.removeItem(draftKey()); } catch (_) { /* nada */ } return dismissNotice(); }
        dismissNotice();
        if (d.fmt && d.fmt !== fmtId()) api.setFormat(d.fmt);
        H.restoring = true;
        fc.loadFromJSON(d.c, () => {
          kit.bg = d.bg || { type: 'solid', color: '#FFFFFF' }; kit.applyBg(api, kit.bg);
          fc.discardActiveObject(); fc.requestRenderAll(); fc.fire('selection:cleared');
          H.restoring = false; commit(); api.toast('Diseño recuperado');
        });
      };
      stage.append(notice);
    }

    /* --------------------------------------------------------------- enganche */
    ['object:added', 'object:removed', 'object:modified', 'bg:changed'].forEach(ev => fc.on(ev, schedule));
    const offFormat = api.on('format', schedule);
    const offCmd = api.on('cmd', (k) => { if (k === 'undo') undo(); else if (k === 'redo') redo(); });

    const onKey = (e) => {
      if (H.dead || !api.root.isConnected) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
      if (!mod) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', onKey);

    api.on('destroy', () => {
      if (H.timer) commit();                                        // no perder el último cambio
      saveDraft();
      H.dead = true; clearTimeout(H.timer); clearTimeout(H.saveTimer);
      document.removeEventListener('keydown', onKey); offFormat(); offCmd(); dismissNotice();
      H.stack = []; H.pool = []; H.poolIdx.clear();
    });

    api.history = { undo, redo, commit, get index() { return H.i; }, get length() { return H.stack.length; } };

    /* Estado inicial = punto de partida del historial (el lienzo vacío) */
    H.stack.push(take()); H.i = 0; buttons();
    offerDraft();
  });
})();
