/* ==========================================================================
   Affari · Estudio de Diseño — FASE 1 (estructura base y UI responsiva)
   Mini-editor tipo Canva para placas y catálogos de productos.

   Qué hace esta fase:
     1. Registra la vista «estudio» en el router de Affari (VIEWS.estudio).
     2. Construye el layout responsivo (3 columnas en escritorio · bottom sheet en celular).
     3. Carga Fabric.js bajo demanda (solo al entrar al estudio) e inicializa el lienzo.
     4. Zoom / encuadre / cambio de formato, lista de capas y panel de propiedades (solo lectura).

   Fase 2 (studio-tools.js / studio-templates.js): plantillas, elementos, textos, fondos y ajustes.
   Fase 3 (studio-history.js / studio-products.js / studio-export.js): deshacer/rehacer + borrador
   automático, productos del inventario (y catálogo de varios productos) y exportación a imagen.

   Puntos de extensión para las próximas fases:
     · Studio.registerPane(id, { render(bodyEl, api) })   → rellena un panel de herramientas
     · Studio.use(fn(api))  → plugin que corre una vez por editor, con el lienzo ya listo
     · api.canvas() / api.fabric / api.add(obj) / api.on(evento, fn) / api.root / api.zoom()
   Depende de: icons.js (ICON_PATHS, icon), app.js (VIEWS, state, toast).
   ========================================================================== */
(() => {
  'use strict';

  /* ---------------------------------------------------------------- CONFIG */
  const CONFIG = {
    /* Se prueba en orden. Si algún día querés servirla vos, copiá fabric.min.js a js/vendor/ */
    fabricSources: [
      'js/vendor/fabric.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js',
    ],
    formats: [
      { id: 'square',    label: 'Post 1:1',         sub: '1080 × 1080', w: 1080, h: 1080 },
      { id: 'portrait',  label: 'Post 4:5',         sub: '1080 × 1350', w: 1080, h: 1350 },
      { id: 'story',     label: 'Historia 9:16',    sub: '1080 × 1920', w: 1080, h: 1920 },
      { id: 'landscape', label: 'Placa 16:9',       sub: '1920 × 1080', w: 1920, h: 1080 },
    ],
    defaultFormat: 'square',
    zoom: { min: 0.1, max: 4, step: 1.25 },
    deskMinWidth: 900,          // ancho mínimo DEL MÓDULO para usar las 3 columnas
    boardColor: '#FFFFFF',
    seedDemo: false,            // objetos de muestra para probar arrastre/escala (ya no hacen falta desde la Fase 2)
  };

  /* Pestañas de herramientas. 'props' solo aparece en la barra inferior del celular. */
  const TABS = [
    { id: 'plantillas', label: 'Plantillas', icon: 'layout' },
    { id: 'elementos',  label: 'Elementos',  icon: 'shapes' },
    { id: 'texto',      label: 'Texto',      icon: 'type' },
    { id: 'fondo',      label: 'Fondo',      icon: 'palette' },
    { id: 'productos',  label: 'Productos',  icon: 'box' },
    { id: 'props',      label: 'Ajustes',    icon: 'sliders', onlySmall: true },
  ];

  /* Paneles de herramientas. Las fases siguientes los completan con registerPane(). */
  const PANES = {
    plantillas: { title: 'Plantillas', soon: 'Placas de oferta, lanzamiento y lista de precios listas para editar.', phase: 2 },
    elementos:  { title: 'Elementos',  soon: 'Formas, etiquetas de precio e imágenes.', phase: 2 },
    texto:      { title: 'Texto',      soon: 'Títulos, precios y descripciones.', phase: 2 },
    fondo:      { title: 'Fondo',      soon: 'Colores, degradés e imágenes de fondo.', phase: 2 },
    productos:  { title: 'Productos',  soon: 'Traé fotos, nombres y precios directo de tu inventario.', phase: 3 },
  };

  /* Íconos nuevos (se suman al catálogo global de js/icons.js) */
  Object.assign(ICON_PATHS, {
    layout:  '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    shapes:  '<rect x="3" y="12" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="7.5" r="4.5"/>',
    type:    '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
    image:   '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.4-1.2.4-2.6 1.7-2.6H17a4 4 0 0 0 4-4C21 6.9 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    sliders: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="18" r="2.2"/>',
    undo:    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo:    '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    zoomin:  '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    zoomout: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
    fit:     '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    layers:  '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  });

  /* --------------------------------------------------------------- HELPERS */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const rAF = (fn) => { let q = 0; return (...a) => { if (q) return; q = requestAnimationFrame(() => { q = 0; fn(...a); }); }; };

  /* Carga Fabric.js una sola vez, probando cada fuente en orden */
  let fabricPromise = null;
  function loadFabric() {
    if (window.fabric) return Promise.resolve(window.fabric);
    if (fabricPromise) return fabricPromise;
    const tryLoad = (src) => new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => window.fabric ? ok() : (s.remove(), fail(new Error('Respuesta inválida: ' + src)));
      s.onerror = () => (s.remove(), fail(new Error('No se pudo cargar: ' + src)));
      document.head.appendChild(s);
    });
    fabricPromise = CONFIG.fabricSources
      .reduce((p, src) => p.catch(() => tryLoad(src)), Promise.reject())
      .then(() => window.fabric)
      .catch((e) => { fabricPromise = null; throw e; });
    return fabricPromise;
  }

  const TYPE_LABEL = { 'i-text': 'Texto', text: 'Texto', textbox: 'Texto', rect: 'Forma', circle: 'Forma', triangle: 'Forma', image: 'Imagen', group: 'Grupo', activeSelection: 'Selección múltiple' };
  const TYPE_ICON  = { 'i-text': 'type', text: 'type', textbox: 'type', image: 'image', group: 'layers', activeSelection: 'layers' };
  const typeLabel = (o) => o.name || TYPE_LABEL[o.type] || 'Objeto';
  const typeIcon  = (o) => TYPE_ICON[o.type] || 'shapes';

  /* ============================================================== MONTAJE */
  /* Crea una instancia del editor dentro de `host`. Devuelve su API pública. */
  function mount(host) {
    const fmt0 = CONFIG.formats.find(f => f.id === CONFIG.defaultFormat) || CONFIG.formats[0];
    const S = {                                   // estado de la instancia
      fc: null, fabric: null, destroyed: false,
      format: fmt0, W: fmt0.w, H: fmt0.h,
      zoom: 1, autoFit: true,
      mode: 'mobile', tab: 'plantillas', leftTab: 'plantillas', sheet: 'closed',
    };
    const listeners = {};
    const api = {
      get fabric() { return S.fabric; },
      canvas: () => S.fc,
      size: () => ({ w: S.W, h: S.H }),
      on: (ev, fn) => ((listeners[ev] ||= []).push(fn), () => api.off(ev, fn)),
      off: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); },
      emit: (ev, ...a) => (listeners[ev] || []).forEach(f => f(...a)),
      add: (obj) => { S.fc.add(obj); S.fc.setActiveObject(obj); S.fc.requestRenderAll(); },
      setFormat, setZoom, fit, setTab,
      get root() { return root; },
      zoom: () => S.zoom,
      setEnabled: (k, on) => { const b = root.querySelector(`.st-top [data-r="${k}"]`); if (b) b.disabled = !on; },
      mode: () => S.mode,                                  // 'desk' | 'mobile'
      closeSheet: () => { S.sheet = 'closed'; syncTabs(); queueFit(); },
      toast: (m) => (typeof toast === 'function' ? toast(m) : null),
      destroy,
    };

    /* ---------- DOM ---------- */
    const root = el(`
<section class="studio" aria-label="Estudio de diseño">
  <div class="st-shell" data-sheet="closed" data-tab="plantillas">
    <header class="st-top">
      <label class="st-format" title="Formato del lienzo">
        <span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Formato</span>
        <select data-r="format">${CONFIG.formats.map(f => `<option value="${f.id}">${f.label} (${f.sub.replace(/ /g, '')})</option>`).join('')}</select>
      </label>
      <div class="st-grow"></div>
      <div class="st-group">
        <button class="st-btn" data-r="undo" disabled aria-label="Deshacer" title="Deshacer (Ctrl+Z)">${icon('undo')}</button>
        <button class="st-btn" data-r="redo" disabled aria-label="Rehacer" title="Rehacer (Ctrl+Shift+Z)">${icon('redo')}</button>
      </div>
      <span class="st-sep hide-sm"></span>
      <div class="st-group">
        <button class="st-btn hide-xs" data-r="zoom-out" aria-label="Alejar">${icon('zoomout')}</button>
        <span class="st-zoom-label" data-r="zoom-label" aria-live="polite">100%</span>
        <button class="st-btn hide-xs" data-r="zoom-in" aria-label="Acercar">${icon('zoomin')}</button>
        <button class="st-btn" data-r="fit" aria-label="Ajustar a pantalla" title="Ajustar a pantalla">${icon('fit')}</button>
      </div>
      <span class="st-sep hide-sm"></span>
      <button class="st-btn is-primary" data-r="export" disabled title="Exportar imagen" aria-label="Exportar">${icon('download')}<span class="st-btn-text">Exportar</span></button>
    </header>

    <nav class="st-rail" role="tablist" aria-label="Herramientas">
      ${TABS.map(t => `<button class="st-tab${t.onlySmall ? ' only-sm' : ''}" role="tab" id="st-tab-${t.id}" data-tab="${t.id}" aria-selected="false">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
    </nav>

    <aside class="st-panel st-left" aria-label="Herramientas">
      <div class="st-grip" data-grip aria-hidden="true"></div>
      <div class="st-panel-head"><span data-r="left-title"></span><button class="st-btn st-sheet-close" data-r="close-sheet" aria-label="Cerrar panel">${icon('close')}</button></div>
      <div class="st-panel-body" data-r="left-body">
        ${Object.entries(PANES).map(([id]) => `<div class="st-pane" data-pane="${id}"></div>`).join('')}
      </div>
    </aside>

    <main class="st-stage" data-r="stage" aria-label="Lienzo de trabajo">
      <div class="st-pad" data-r="pad">
        <div class="st-board" data-r="board">
          <canvas data-r="canvas"></canvas>
          <div class="st-loading" data-r="loading"><div class="st-spinner"></div><span>Preparando el lienzo…</span></div>
        </div>
      </div>
      <div class="st-stage-hint">Ctrl + rueda para hacer zoom</div>
    </main>

    <aside class="st-panel st-right" aria-label="Propiedades y capas">
      <div class="st-grip" data-grip aria-hidden="true"></div>
      <div class="st-panel-head"><span>Propiedades</span><button class="st-btn st-sheet-close" data-r="close-sheet" aria-label="Cerrar panel">${icon('close')}</button></div>
      <div class="st-panel-body">
        <section class="st-section"><h3>Selección</h3><div data-r="props"></div></section>
        <section class="st-section"><h3>Capas</h3><ul class="st-layers" data-r="layers"></ul></section>
      </div>
    </aside>
  </div>
</section>`);

    const $ = (k, scope = root) => scope.querySelector(`[data-r="${k}"]`);
    const $$ = (sel) => [...root.querySelectorAll(sel)];
    const shell = root.querySelector('.st-shell');
    const stage = $('stage'), pad = $('pad'), board = $('board'), loading = $('loading');
    $('format').value = S.format.id;
    host.replaceChildren(root);

    /* ---------- Pestañas, paneles y bottom sheet ---------- */
    function renderPanes() {
      for (const [id, def] of Object.entries(PANES)) {
        const body = root.querySelector(`[data-pane="${id}"]`);
        if (typeof def.render === 'function') def.render(body, api);              // Fase 2+: contenido real
        else body.innerHTML = `
          <div class="st-soon">${def.soon}<br><span class="st-chip">Fase ${def.phase}</span></div>
          <div class="st-skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
      }
    }

    function syncTabs() {
      const cur = S.mode === 'desk' ? S.leftTab : S.tab;
      $$('.st-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === cur)));
      $$('.st-pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === S.leftTab));
      $('left-title').textContent = PANES[S.leftTab].title;
      shell.dataset.tab = S.mode === 'desk' ? S.leftTab : S.tab;
      shell.dataset.sheet = S.mode === 'desk' ? 'closed' : S.sheet;
    }

    function setTab(id) {
      if (!TABS.some(t => t.id === id)) return;
      if (S.mode === 'desk') { if (id !== 'props') S.leftTab = id; }
      else {
        if (id !== 'props') S.leftTab = id;
        if (S.sheet !== 'closed' && S.tab === id) S.sheet = 'closed';             // tocar la pestaña activa = cerrar
        else { S.tab = id; if (S.sheet === 'closed') S.sheet = 'half'; }
      }
      syncTabs(); queueFit();
    }
    root.addEventListener('click', (e) => {
      const t = e.target.closest('.st-tab'); if (t) return setTab(t.dataset.tab);
      if (e.target.closest('[data-r="close-sheet"]')) { S.sheet = 'closed'; syncTabs(); queueFit(); }
    });

    /* Arrastrar el «grip» para mover el sheet entre cerrado / medio / completo */
    shell.querySelectorAll('[data-grip]').forEach(grip => {
      let y0 = 0, h0 = 0, panel = null, moved = false;
      grip.addEventListener('pointerdown', (e) => {
        panel = grip.closest('.st-panel'); y0 = e.clientY; h0 = panel.getBoundingClientRect().height; moved = false;
        grip.setPointerCapture(e.pointerId); shell.classList.add('is-dragging');
      });
      grip.addEventListener('pointermove', (e) => {
        if (!panel) return; moved = true;
        const max = shell.clientHeight * 0.85;
        panel.style.height = clamp(h0 + (y0 - e.clientY), 0, max) + 'px';
      });
      const end = () => {
        if (!panel) return;
        const ratio = panel.getBoundingClientRect().height / (root.clientHeight || 1);
        panel.style.height = ''; shell.classList.remove('is-dragging');
        if (moved) S.sheet = ratio < 0.2 ? 'closed' : ratio < 0.6 ? 'half' : 'full';
        else S.sheet = S.sheet === 'half' ? 'full' : 'half';                      // toque simple = alterna
        panel = null; syncTabs(); queueFit();
      };
      grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    });

    /* ---------- Modo (escritorio / celular) según el ancho real del módulo ---------- */
    function setMode(mode) {
      if (S.mode === mode && root.dataset.mode) return;
      S.mode = mode; root.dataset.mode = mode;
      root.style.setProperty('--st-pad', mode === 'desk' ? '40px' : '20px');
      syncTabs();
    }
    // Estimación inicial (antes de que el módulo esté en pantalla) para evitar parpadeo:
    // en escritorio Affari reserva 248 px de menú lateral.
    setMode(innerWidth - (innerWidth > 900 ? 248 : 0) >= CONFIG.deskMinWidth ? 'desk' : 'mobile');

    /* ---------- Lienzo Fabric ---------- */
    const padPx = () => (S.mode === 'desk' ? 40 : 20) * 2;

    function fitZoom() {
      const aw = stage.clientWidth - padPx(), ah = stage.clientHeight - padPx();
      return aw > 0 && ah > 0 ? clamp(Math.min(aw / S.W, ah / S.H), CONFIG.zoom.min, 1.5) : 0;
    }
    function sizeBoard() { board.style.width = Math.round(S.W * S.zoom) + 'px'; board.style.height = Math.round(S.H * S.zoom) + 'px'; }
    function setZoom(z, manual = true) {
      if (S.destroyed || !S.fc || !z) return;
      if (manual) S.autoFit = false;
      S.zoom = clamp(z, CONFIG.zoom.min, CONFIG.zoom.max);
      S.fc.setZoom(S.zoom);
      S.fc.setDimensions({ width: Math.round(S.W * S.zoom), height: Math.round(S.H * S.zoom) });   // tamaño en pantalla
      sizeBoard();
      S.fc.requestRenderAll();
      $('zoom-label').textContent = Math.round(S.zoom * 100) + '%';
      api.emit('zoom', S.zoom);
    }
    function fit() { S.autoFit = true; setZoom(fitZoom(), false); }
    const queueFit = rAF(() => { if (S.autoFit) setZoom(fitZoom(), false); });

    function setFormat(id) {
      const f = CONFIG.formats.find(x => x.id === id); if (!f) return;
      S.format = f; S.W = f.w; S.H = f.h; $('format').value = f.id;
      if (S.fc) { fit(); S.fc.discardActiveObject(); S.fc.requestRenderAll(); } else sizeBoard();
      api.emit('format', f);
    }

    async function initCanvas() {
      try {
        S.fabric = await loadFabric();
        if (S.destroyed) return;
        const fabric = S.fabric;

        /* Apariencia de los controles de selección: cómodos para el dedo */
        fabric.Object.prototype.set({
          transparentCorners: false, cornerStyle: 'circle', cornerColor: '#FFFFFF', cornerStrokeColor: '#10B981',
          borderColor: '#10B981', borderScaleFactor: 2, cornerSize: 12, touchCornerSize: 30, padding: 4,
        });
        S.fc = new fabric.Canvas($('canvas'), {
          width: S.W, height: S.H, backgroundColor: CONFIG.boardColor,
          preserveObjectStacking: true, selection: true, stopContextMenu: true, fireRightClick: false,
        });
        loading.hidden = true;
        setZoom(S.zoom, false);                                  // deja el canvas con el tamaño en pantalla ya
        bindCanvasEvents();
        if (CONFIG.seedDemo) seedDemo();
        fit(); renderSide();
        Studio.plugins.forEach(fn => { try { fn(api); } catch (e) { console.error('[Studio] plugin', e); } });   // Fase 3
        api.emit('ready', S.fc);
      } catch (err) {
        console.error('[Studio]', err);
        loading.innerHTML = `<span>No se pudo cargar el editor.<br>Revisá tu conexión e intentá de nuevo.</span><button class="st-btn" type="button">Reintentar</button>`;
        loading.querySelector('button').onclick = () => { loading.innerHTML = '<div class="st-spinner"></div><span>Preparando el lienzo…</span>'; initCanvas(); };
      }
    }

    /* Objetos de muestra: permiten comprobar arrastre, escala y rotación en la Fase 1 */
    function seedDemo() {
      const { Rect, IText } = S.fabric;
      const card = new Rect({ left: S.W * .14, top: S.H * .30, width: S.W * .72, height: S.H * .40, rx: 36, ry: 36, fill: '#10B981', name: 'Etiqueta' });
      const title = new IText('Tu oferta aquí', { left: S.W * .20, top: S.H * .36, fontSize: 96, fontWeight: 800, fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif', fill: '#052E22', name: 'Título' });
      const price = new IText('$9.999', { left: S.W * .20, top: S.H * .52, fontSize: 170, fontWeight: 800, fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif', fill: '#FFFFFF', name: 'Precio' });
      S.fc.add(card, title, price);
    }

    /* ---------- Panel derecho: selección + capas ---------- */
    function renderProps() {
      const box = $('props'), o = S.fc && S.fc.getActiveObject();
      if (Studio.propsRenderer) return Studio.propsRenderer(box, o, api);      // Fase 2: panel editable (studio-tools.js)
      if (!o) { box.innerHTML = '<div class="st-empty">Tocá un elemento del lienzo para ver sus propiedades.</div>'; return; }
      const r = (n) => Math.round(n || 0);
      box.innerHTML = [['Tipo', typeLabel(o)], ['Posición', `${r(o.left)}, ${r(o.top)}`], ['Tamaño', `${r(o.getScaledWidth())} × ${r(o.getScaledHeight())}`], ['Rotación', `${r(o.angle)}°`]]
        .map(([k, v]) => `<div class="st-kv"><span>${k}</span><b>${v}</b></div>`).join('');
    }
    function renderLayers() {
      const ul = $('layers'); ul.replaceChildren();
      if (!S.fc) return;
      const objs = S.fc.getObjects().slice().reverse(), active = S.fc.getActiveObjects();
      if (!objs.length) { ul.append(el('<li class="st-empty">El lienzo está vacío.</li>')); return; }
      objs.forEach(o => {
        const li = el(`<li><button class="st-layer" type="button">${icon(typeIcon(o), 16)}<span></span></button></li>`);
        const label = o.type && o.type.includes('text') && o.text ? o.text.replace(/\s+/g, ' ').slice(0, 28) : typeLabel(o);
        li.querySelector('span').textContent = label;
        li.firstChild.classList.toggle('is-active', active.includes(o));
        li.firstChild.onclick = () => { S.fc.setActiveObject(o); S.fc.requestRenderAll(); };
        ul.append(li);
      });
    }
    const renderSide = rAF(() => { if (!S.destroyed) { renderProps(); renderLayers(); } });

    function bindCanvasEvents() {
      const fc = S.fc;
      ['object:added', 'object:removed', 'object:modified', 'object:moving', 'object:scaling', 'object:rotating', 'text:changed',
        'selection:created', 'selection:updated', 'selection:cleared'].forEach(ev => fc.on(ev, () => { renderSide(); api.emit(ev); }));
    }

    /* ---------- Zoom y teclado ---------- */
    root.querySelector('.st-top').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      const k = b.dataset.r, s = CONFIG.zoom.step;
      if (k === 'zoom-in') setZoom(S.zoom * s); else if (k === 'zoom-out') setZoom(S.zoom / s); else if (k === 'fit') fit();
      else if (k === 'undo' || k === 'redo' || k === 'export') api.emit('cmd', k);                    // Fase 3: los plugins escuchan el evento 'cmd'
    });
    $('format').addEventListener('change', (e) => setFormat(e.target.value));
    stage.addEventListener('wheel', (e) => {                                      // Ctrl/⌘ + rueda (o pellizco del trackpad)
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); setZoom(S.zoom * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    const onKey = (e) => {
      if (S.destroyed || !root.isConnected || !S.fc) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;   // no interferir al escribir
      const edit = S.fc.getActiveObject();
      if ((e.key === 'Delete' || e.key === 'Backspace') && edit && !edit.isEditing) {
        e.preventDefault(); S.fc.getActiveObjects().forEach(o => S.fc.remove(o)); S.fc.discardActiveObject(); S.fc.requestRenderAll();
      } else if (e.key === 'Escape') { S.fc.discardActiveObject(); S.fc.requestRenderAll(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom(S.zoom * CONFIG.zoom.step); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom(S.zoom / CONFIG.zoom.step); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); fit(); }
    };
    document.addEventListener('keydown', onKey);

    /* ---------- Observador de tamaño: decide el modo y reencuadra ---------- */
    const ro = new ResizeObserver(() => {
      if (!root.clientWidth) return;                                             // todavía no está en pantalla
      setMode(root.clientWidth >= CONFIG.deskMinWidth ? 'desk' : 'mobile');
      queueFit();
    });
    ro.observe(root); ro.observe(stage);

    /* ---------- Limpieza (el router la llama al salir de la vista) ---------- */
    function destroy() {
      if (S.destroyed) return;
      api.emit('destroy'); S.destroyed = true;
      ro.disconnect(); document.removeEventListener('keydown', onKey);
      try { S.fc && S.fc.dispose(); } catch (_) { /* ya liberado */ }
      Object.keys(listeners).forEach(k => delete listeners[k]);
      if (Studio.instance === api) Studio.instance = null;
    }

    S.zoom = 0.35; sizeBoard();                                   // tamaño provisional mientras carga Fabric
    renderPanes(); syncTabs(); renderSide();
    initCanvas();
    return api;
  }

  /* ============================================================ API GLOBAL */
  const Studio = {
    CONFIG, instance: null, propsRenderer: null, kit: {}, plugins: [],
    use(fn) { Studio.plugins.push(fn); },
    mount(host) { Studio.destroy(); return (Studio.instance = mount(host)); },
    destroy() { Studio.instance && Studio.instance.destroy(); },
    /* Fases siguientes: Studio.registerPane('texto', { render(body, api) { … } }) — antes de abrir la vista */
    registerPane(id, def) { PANES[id] = Object.assign(PANES[id] || { title: id }, def); },
  };
  window.Studio = Studio;

  /* ----------------------------------------------- Registro en el router */
  VIEWS.estudio = async function (host) {
    Studio.mount(host);
    const stop = () => { Studio.destroy(); if (state.stop === stop) state.stop = null; };
    state.stop = stop;                                                           // go() lo llama al cambiar de vista
  };
})();
