/* ==========================================================================
   Affari · Estudio de Diseño — FASE 2 · herramientas
   Paneles Elementos / Texto / Fondo + panel de propiedades editable.
   Se carga después de studio.js y antes de studio-templates.js.
   Expone Studio.kit: helpers compartidos (texto, formas, fondos, imágenes).
   ========================================================================== */
(() => {
  'use strict';
  const Studio = window.Studio; if (!Studio) return;
  const kit = Studio.kit;
  const F = () => window.fabric;                      // Fabric se carga bajo demanda: se lee siempre en el momento

  /* Íconos nuevos del panel de propiedades */
  Object.assign(ICON_PATHS, {
    copy:    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    up:      '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down:    '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    centerh: '<path d="M12 3v18"/><rect x="5" y="7" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
    centerv: '<path d="M3 12h18"/><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
    upload:  '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  });

  /* ------------------------------------------------------------ constantes */
  const ACCENT = '#10B981';
  kit.PALETTE = ['#FFFFFF', '#0F172A', '#10B981', '#EF4444', '#F59E0B', '#FACC15', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6'];
  const BG_SOLIDS = ['#FFFFFF', '#F8FAFC', '#FEF3C7', '#FFE4E6', '#FCE7F3', '#EDE9FE', '#DBEAFE', '#CCFBF1', '#DCFCE7', '#FFF7ED',
                     '#0F172A', '#1E293B', '#064E3B', '#4C1D95', '#7F1D1D', '#18181B', '#10B981', '#F59E0B'];
  const BG_GRADS = [['#10B981', '#065F46'], ['#F59E0B', '#EF4444'], ['#3B82F6', '#8B5CF6'], ['#EC4899', '#F59E0B'],
                    ['#0F172A', '#334155'], ['#ECFDF5', '#A7F3D0'], ['#FEF3C7', '#FDBA74'], ['#E0E7FF', '#FBCFE8']];
  const FONTS = ['Plus Jakarta Sans', 'Arial', 'Georgia', 'Impact', 'Trebuchet MS', 'Courier New'];

  /* --------------------------------------------------------------- helpers */
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const isText = (o) => !!o && /text/.test(o.type);
  const textOf = (o) => !o ? null : isText(o) ? o : o.type === 'group' ? (o.getObjects().find(isText) || null) : null;
  const shapeOf = (o) => !o ? null : o.type === 'group' ? (o.getObjects().find(x => !isText(x) && x.type !== 'image') || null)
    : (isText(o) || o.type === 'image' || o.type === 'activeSelection') ? null : o;
  const toHex = (c) => { try { return typeof c === 'string' ? '#' + new (F().Color)(c).toHex() : '#000000'; } catch (_) { return '#000000'; } };
  const inst = () => Studio.instance;
  const fcv = () => inst() && inst().canvas();
  const say = (m) => inst() && inst().toast(m);

  /* Fuentes: se espera a que carguen antes de medir el texto (si no, el cuadro queda mal dimensionado) */
  const fontJobs = {};
  kit.ensureFont = (fam, weight = 400) => {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const k = fam + '|' + weight;
    return (fontJobs[k] ||= document.fonts.load(`${weight} 40px "${fam}"`).catch(() => {}));
  };
  function refont(t) {
    kit.ensureFont(t.fontFamily, t.fontWeight).then(() => {
      if (t.initDimensions) { t.initDimensions(); t.dirty = true; if (t.group) t.group.dirty = true; }
      const fc = fcv(); fc && fc.requestRenderAll();
    });
  }

  /* Fábricas de objetos (todas con origen en el centro: left/top = centro del objeto) */
  const C = { originX: 'center', originY: 'center' };
  kit.text = (str, o = {}) => {
    const t = new (F().Textbox)(str, Object.assign({}, C, { fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: 80, fill: '#0F172A',
      textAlign: 'center', lineHeight: 1.08, width: 600 }, o));
    refont(t); return t;
  };
  kit.rect   = (o) => new (F().Rect)(Object.assign({}, C, { fill: ACCENT, width: 400, height: 240 }, o));
  kit.circle = (o) => new (F().Circle)(Object.assign({}, C, { fill: ACCENT, radius: 120 }, o));
  kit.star   = (r, o) => {
    const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? .45 : 1; pts.push({ x: r * k * Math.cos(a), y: r * k * Math.sin(a) }); }
    return new (F().Polygon)(pts, Object.assign({}, C, { fill: '#FACC15' }, o));
  };
  /* Insignia = forma + texto agrupados (se mueve junto; el texto y el color se editan en Ajustes) */
  kit.badge = (shape, label, textOpts, cx, cy, name) => {
    shape.set({ left: cx, top: cy }); const t = kit.text(label, Object.assign({ left: cx, top: cy }, textOpts));
    return new (F().Group)([shape, t], Object.assign({}, C, { left: cx, top: cy, name }));
  };
  kit.grad = (a, b, W, H) => new (F().Gradient)({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: W, y2: H }, colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }] });

  /* Fondo: 'solid' | 'grad' | 'image' — se guarda en kit.bg para recalcularlo si cambia el formato */
  kit.bgValue = (spec, W, H) => spec.type === 'grad' ? kit.grad(spec.a, spec.b, W, H) : spec.color;
  kit.cover = (img, W, H) => {
    const s = Math.max(W / img.width, H / img.height);
    img.set({ scaleX: s, scaleY: s, left: (W - img.width * s) / 2, top: (H - img.height * s) / 2, originX: 'left', originY: 'top', selectable: false, evented: false });
  };
  kit.applyBg = (api, spec) => {
    const fc = api.canvas(), { w, h: hh } = api.size(); if (!fc) return;
    kit.bg = spec;
    if (spec.type === 'image') {
      F().Image.fromURL(spec.url, (img) => { if (kit.bg !== spec) return; kit.cover(img, w, hh); fc.backgroundImage = img; fc.requestRenderAll(); fc.fire('bg:changed'); });
      return;
    }
    fc.backgroundImage = null; fc.backgroundColor = kit.bgValue(spec, w, hh); fc.requestRenderAll(); fc.fire('bg:changed');
  };

  /* Imagen del usuario → dataURL reducido (máx. 2000 px) para no cargar de más al celular */
  kit.readImage = (file, max = 2000) => new Promise((ok, fail) => {
    if (!file || !/^image\//.test(file.type)) return fail(new Error('Elegí un archivo de imagen (JPG, PNG o WebP).'));
    if (file.size > 15 * 1024 * 1024) return fail(new Error('La imagen supera los 15 MB.'));
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .9));
    };
    im.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No se pudo leer esa imagen.')); };
    im.src = url;
  });

  /* Agrega un objeto al centro del lienzo; en celular salta a «Ajustes» para editarlo */
  function place(api, obj, { jitter = true } = {}) {
    const { w, h: hh } = api.size(), j = jitter ? (Math.random() - .5) * 40 : 0;
    obj.set({ left: w / 2 + j, top: hh / 2 + j });
    api.add(obj); obj.setCoords();
    if (api.mode() === 'mobile') api.setTab('props');
  }
  kit.place = place;

  /* Botón «Subir imagen» (input file oculto dentro de un label) */
  const uploadBtn = (label, onFile) => {
    const el = h(`<label class="st-btn is-outline st-upload">${icon('upload')}<span>${label}</span><input type="file" accept="image/*" hidden></label>`);
    el.querySelector('input').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { onFile(await kit.readImage(f)); } catch (err) { say(err.message); }
    };
    return el;
  };
  const section = (title, ...nodes) => { const s = h(`<div class="st-section"><h3>${title}</h3></div>`); nodes.forEach(n => s.append(n)); return s; };

  /* ============================================================== ELEMENTOS */
  const SVG = (inner) => `<svg viewBox="0 0 40 40" width="38" height="38" fill="currentColor" aria-hidden="true">${inner}</svg>`;
  const SHAPES = [
    ['Rectángulo',  SVG('<rect x="5" y="9" width="30" height="22"/>'),            (u) => kit.rect({ width: 480 * u, height: 300 * u, name: 'Forma' })],
    ['Redondeado',  SVG('<rect x="5" y="9" width="30" height="22" rx="8"/>'),     (u) => kit.rect({ width: 480 * u, height: 300 * u, rx: 48 * u, ry: 48 * u, name: 'Forma' })],
    ['Círculo',     SVG('<circle cx="20" cy="20" r="14"/>'),                       (u) => kit.circle({ radius: 150 * u, name: 'Forma' })],
    ['Triángulo',   SVG('<path d="M20 6 36 33H4z"/>'),                             (u) => new (F().Triangle)(Object.assign({}, C, { width: 300 * u, height: 260 * u, fill: ACCENT, name: 'Forma' }))],
    ['Estrella',    SVG('<path d="m20 4 4.7 10 10.8 1.2-8 7.4 2.2 10.7L20 27.7 10.3 33.3l2.2-10.7-8-7.4L15.3 14z"/>'), (u) => kit.star(170 * u, { name: 'Forma' })],
    ['Línea',       SVG('<rect x="4" y="18" width="32" height="4" rx="2"/>'),     (u) => new (F().Line)([0, 0, 420 * u, 0], Object.assign({}, C, { stroke: '#0F172A', strokeWidth: 10 * u, name: 'Línea' }))],
  ];
  const BADGES = [
    ['Precio',     (u) => kit.badge(kit.rect({ width: 520 * u, height: 190 * u, rx: 95 * u, ry: 95 * u, fill: ACCENT }), '$9.999', { fontSize: 110 * u, fill: '#FFFFFF', width: 480 * u }, 0, 0, 'Etiqueta de precio')],
    ['Descuento',  (u) => kit.badge(kit.circle({ radius: 170 * u, fill: '#EF4444' }), '-30%', { fontSize: 124 * u, fill: '#FFFFFF', width: 300 * u }, 0, 0, 'Descuento')],
    ['Oferta',     (u) => kit.badge(kit.rect({ width: 440 * u, height: 120 * u, rx: 18 * u, ry: 18 * u, fill: '#FACC15' }), 'OFERTA', { fontSize: 70 * u, fill: '#0F172A', charSpacing: 120, width: 420 * u }, 0, 0, 'Oferta')],
    ['Nuevo',      (u) => kit.badge(kit.rect({ width: 300 * u, height: 100 * u, rx: 50 * u, ry: 50 * u, fill: '#0F172A' }), 'NUEVO', { fontSize: 54 * u, fill: '#FFFFFF', charSpacing: 120, width: 280 * u }, 0, 0, 'Nuevo')],
  ];
  const unit = (api) => { const { w, h: hh } = api.size(); return Math.min(w, hh) / 1080; };

  Studio.registerPane('elementos', {
    render(body, api) {
      const grid = (items, mk) => { const g = h('<div class="st-tiles"></div>');
        items.forEach(it => { const b = h(`<button class="st-tile" type="button">${it[1] && it[1].startsWith('<svg') ? it[1] : ''}<span>${it[0]}</span></button>`);
          b.onclick = () => place(api, mk(it)); g.append(b); }); return g; };
      body.replaceChildren(
        section('Formas', grid(SHAPES, (it) => it[2](unit(api)))),
        section('Etiquetas', (() => { const g = h('<div class="st-tiles st-tiles-2"></div>');
          BADGES.forEach(([n, mk]) => { const b = h(`<button class="st-tile st-tile-badge" type="button"><span>${n}</span></button>`); b.onclick = () => place(api, mk(unit(api))); g.append(b); }); return g; })()),
        section('Imágenes', uploadBtn('Subir imagen', (url) => F().Image.fromURL(url, (img) => {
          const { w, h: hh } = api.size(), s = Math.min(w * .6 / img.width, hh * .6 / img.height, 1.5);
          img.set(Object.assign({}, C, { scaleX: s, scaleY: s, name: 'Imagen' })); place(api, img, { jitter: false });
        }))),
      );
    },
  });

  /* ================================================================== TEXTO */
  const TEXTS = [
    ['Título',          'Título',               { fontSize: 110, fontWeight: 800 }],
    ['Subtítulo',       'Subtítulo',            { fontSize: 64,  fontWeight: 600 }],
    ['Cuerpo',          'Escribí tu descripción aquí', { fontSize: 44, fontWeight: 400 }],
    ['Nombre de producto', 'Nombre del producto', { fontSize: 84, fontWeight: 800 }],
    ['Precio',          '$9.999',               { fontSize: 240, fontWeight: 800, fill: ACCENT }],
    ['Precio anterior', '$14.999',              { fontSize: 80,  fontWeight: 600, fill: '#64748B', linethrough: true }],
  ];
  Studio.registerPane('texto', {
    render(body, api) {
      const list = h('<div class="st-textlist"></div>');
      TEXTS.forEach(([name, str, o]) => {
        const b = h(`<button class="st-textbtn" type="button"><span></span><small>${name}</small></button>`);
        const pv = b.querySelector('span'); pv.textContent = str;
        pv.style.cssText = `font-weight:${o.fontWeight};font-size:${Math.max(14, Math.min(30, o.fontSize / 5))}px;${o.fill ? 'color:' + o.fill : ''};${o.linethrough ? 'text-decoration:line-through' : ''}`;
        b.onclick = () => { const u = unit(api), { w } = api.size();
          place(api, kit.text(str, Object.assign({ width: w * .8 }, o, { fontSize: o.fontSize * u }))); };
        list.append(b);
      });
      body.replaceChildren(section('Agregar texto', list),
        h('<p class="st-help">Tocá dos veces un texto del lienzo para escribir directo, o editalo desde <b>Ajustes</b>.</p>'));
    },
  });

  /* ================================================================== FONDO */
  Studio.registerPane('fondo', {
    render(body, api) {
      kit.bg = { type: 'solid', color: '#FFFFFF' };
      const solid = h('<div class="st-swatches st-swatches-lg"></div>');
      BG_SOLIDS.forEach(c => { const b = h(`<button class="st-sw" type="button" aria-label="Fondo ${c}" style="background:${c}"></button>`); b.onclick = () => kit.applyBg(api, { type: 'solid', color: c }); solid.append(b); });
      const pick = h('<label class="st-sw st-sw-custom" title="Otro color"><input type="color" value="#FFFFFF" aria-label="Color personalizado"></label>');
      pick.querySelector('input').oninput = (e) => kit.applyBg(api, { type: 'solid', color: e.target.value });
      solid.append(pick);

      const grads = h('<div class="st-tiles st-tiles-4"></div>');
      BG_GRADS.forEach(([a, b2]) => { const b = h(`<button class="st-grad" type="button" aria-label="Degradé ${a} a ${b2}" style="background:linear-gradient(135deg,${a},${b2})"></button>`);
        b.onclick = () => kit.applyBg(api, { type: 'grad', a, b: b2 }); grads.append(b); });

      const clear = h(`<button class="st-btn is-outline" type="button">${icon('close')}<span>Quitar imagen de fondo</span></button>`);
      clear.onclick = () => kit.applyBg(api, { type: 'solid', color: '#FFFFFF' });
      body.replaceChildren(section('Color', solid), section('Degradés', grads),
        section('Imagen', uploadBtn('Subir imagen de fondo', (url) => kit.applyBg(api, { type: 'image', url })), clear));
      api.on('format', () => { if (kit.bg && kit.bg.type !== 'solid') kit.applyBg(api, kit.bg); });   // los degradés/imagen se ajustan al nuevo tamaño
    },
  });

  /* ======================================================= PANEL DE PROPIEDADES */
  /* Cada control: get/set sobre el objeto seleccionado. `show` decide si aplica al tipo de objeto. */
  const num = (id, label, min, max, step, get, set, show) => ({ id, label, kind: 'number', min, max, step, get, set, show });
  const CONTROLS = [
    { id: 'text', label: 'Texto', kind: 'area', show: (o) => !!textOf(o), get: (o) => textOf(o).text, set: (o, v) => textOf(o).set('text', v) },
    { id: 'font', label: 'Tipografía', kind: 'select', options: FONTS, show: (o) => !!textOf(o), get: (o) => textOf(o).fontFamily,
      set: (o, v) => { const t = textOf(o); kit.ensureFont(v, Number(t.fontWeight) || 400).then(() => { t.set('fontFamily', v); o.dirty = true; fcv() && fcv().requestRenderAll(); }); } },
    num('size', 'Tamaño', 8, 800, 2, (o) => Math.round(textOf(o).fontSize), (o, v) => textOf(o).set('fontSize', v), (o) => !!textOf(o)),
    { id: 'tcolor', label: 'Color del texto', kind: 'color', show: (o) => !!textOf(o), get: (o) => textOf(o).fill, set: (o, v) => textOf(o).set('fill', v) },
    { id: 'style', kind: 'toggles', show: (o) => !!textOf(o), items: [
      ['bold', 'B', 'Negrita', (t) => Number(t.fontWeight) >= 700 || t.fontWeight === 'bold', (t, on) => t.set('fontWeight', on ? 800 : 400)],
      ['italic', 'I', 'Cursiva', (t) => t.fontStyle === 'italic', (t, on) => t.set('fontStyle', on ? 'italic' : 'normal')],
      ['underline', 'U', 'Subrayado', (t) => !!t.underline, (t, on) => t.set('underline', on)],
      ['linethrough', 'S', 'Tachado (precio anterior)', (t) => !!t.linethrough, (t, on) => t.set('linethrough', on)]] },
    { id: 'align', kind: 'seg', show: (o) => !!textOf(o), options: [['left', 'Izq.'], ['center', 'Centro'], ['right', 'Der.']], get: (o) => textOf(o).textAlign, set: (o, v) => textOf(o).set('textAlign', v) },
    { id: 'fill', label: 'Relleno', kind: 'color', show: (o) => !!shapeOf(o) && shapeOf(o).type !== 'line', get: (o) => shapeOf(o).fill, set: (o, v) => shapeOf(o).set('fill', v) },
    { id: 'stroke', label: 'Borde', kind: 'color', show: (o) => !!shapeOf(o), get: (o) => shapeOf(o).stroke || '#000000',
      set: (o, v) => { const s = shapeOf(o); s.set('stroke', v); if (!s.strokeWidth) s.set('strokeWidth', 6); } },
    num('sw', 'Grosor del borde', 0, 80, 1, (o) => shapeOf(o).strokeWidth || 0, (o, v) => shapeOf(o).set('strokeWidth', v), (o) => !!shapeOf(o)),
    num('radius', 'Esquinas redondeadas', 0, 400, 2, (o) => Math.round(shapeOf(o).rx || 0), (o, v) => shapeOf(o).set({ rx: v, ry: v }), (o) => !!shapeOf(o) && shapeOf(o).type === 'rect'),
    { id: 'opacity', label: 'Opacidad', kind: 'range', min: 0, max: 100, show: () => true, get: (o) => Math.round((o.opacity ?? 1) * 100), set: (o, v) => o.set('opacity', v / 100) },
  ];

  const ACTIONS = [
    ['dup', 'copy', 'Duplicar'], ['fwd', 'up', 'Traer adelante'], ['back', 'down', 'Enviar atrás'],
    ['ch', 'centerh', 'Centrar horizontal'], ['cv', 'centerv', 'Centrar vertical'], ['del', 'trash', 'Eliminar'],
  ];

  const P = { box: null, key: '', obj: null, specs: [], uid: 0 };
  const touch = (o) => { o.dirty = true; if (o.group) o.group.dirty = true; o.setCoords(); const fc = fcv(); fc && fc.requestRenderAll(); };
  const actionsHtml = (list) => `<div class="st-actions">${list.map(([id, ic, t]) => `<button class="st-btn st-act${id === 'del' ? ' is-danger' : ''}" type="button" data-act="${id}" aria-label="${t}" title="${t}">${icon(ic)}</button>`).join('')}</div>`;

  function controlHtml(c) {
    const L = c.label ? `<span class="st-lbl">${c.label}</span>` : '';
    switch (c.kind) {
      case 'area':   return `<label class="st-field">${L}<textarea data-c="${c.id}" rows="2"></textarea></label>`;
      case 'select': return `<label class="st-field">${L}<select data-c="${c.id}">${c.options.map(o => `<option>${o}</option>`).join('')}</select></label>`;
      case 'number': return `<label class="st-field st-inline">${L}<input type="number" inputmode="decimal" data-c="${c.id}" min="${c.min}" max="${c.max}" step="${c.step}"></label>`;
      case 'range':  return `<label class="st-field">${L}<input type="range" data-c="${c.id}" min="${c.min}" max="${c.max}"></label>`;
      case 'color':  return `<div class="st-field">${L}<div class="st-swatches">${kit.PALETTE.map(k => `<button class="st-sw" type="button" data-c="${c.id}" data-v="${k}" aria-label="${k}" style="background:${k}"></button>`).join('')}<label class="st-sw st-sw-custom" title="Otro color"><input type="color" data-c="${c.id}" aria-label="${c.label}"></label></div></div>`;
      case 'toggles': return `<div class="st-seg st-seg-icons">${c.items.map(([k, t, title]) => `<button type="button" data-c="${c.id}" data-k="${k}" title="${title}" aria-label="${title}" aria-pressed="false">${t}</button>`).join('')}</div>`;
      case 'seg':    return `<div class="st-seg">${c.options.map(([v, t]) => `<button type="button" data-c="${c.id}" data-v="${v}" aria-pressed="false">${t}</button>`).join('')}</div>`;
    }
    return '';
  }

  function build(box, o, api) {
    P.specs = CONTROLS.filter(c => c.show(o));
    box.innerHTML = `<div class="st-kv"><span>Elemento</span><b data-info="name"></b></div>
      <div class="st-kv"><span>Posición / tamaño</span><b data-info="geo"></b></div>
      ${actionsHtml(ACTIONS)}${P.specs.map(controlHtml).join('')}`;
  }

  function sync() {
    const o = P.obj, box = P.box; if (!o || !box) return;
    const r = (n) => Math.round(n || 0);
    box.querySelector('[data-info="name"]').textContent = (isText(o) ? 'Texto' : (o.name || 'Objeto'));
    box.querySelector('[data-info="geo"]').textContent = `${r(o.left)}, ${r(o.top)} · ${r(o.getScaledWidth())}×${r(o.getScaledHeight())}`;
    P.specs.forEach(c => {
      if (c.kind === 'toggles') { const t = textOf(o); c.items.forEach(([k,, , get]) => { const b = box.querySelector(`[data-c="${c.id}"][data-k="${k}"]`); b && b.setAttribute('aria-pressed', String(!!(t && get(t)))); }); return; }
      if (c.kind === 'seg') { const v = c.get(o); box.querySelectorAll(`[data-c="${c.id}"]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); return; }
      const el = box.querySelector(`input[data-c="${c.id}"]:not([type=color]), textarea[data-c="${c.id}"], select[data-c="${c.id}"]`);
      const val = c.get(o);
      if (el && el !== document.activeElement && String(el.value) !== String(val)) el.value = val;
      if (c.kind === 'color') { const ci = box.querySelector(`input[type=color][data-c="${c.id}"]`); if (ci && ci !== document.activeElement) ci.value = toHex(val); }
    });
  }

  /* Aplica un cambio del panel al objeto. `final` = soltó el control → avisa object:modified (para el historial de la Fase 3) */
  function apply(id, raw, final) {
    const o = P.obj, c = P.specs.find(s => s.id === id); if (!o || !c) return;
    if (c.kind === 'number' || c.kind === 'range') {
      raw = parseFloat(raw);
      if (isNaN(raw)) return;                                   // campo vacío mientras escribe
      if (c.kind === 'number' && (raw < c.min || raw > c.max)) { if (final) sync(); return; }
    }
    c.set(o, raw);
    touch(o); sync(); if (final) fcv() && fcv().fire('object:modified', { target: o });
  }

  function act(id, api) {
    const o = P.obj, fc = fcv(); if (!o || !fc) return;
    const { w, h: hh } = api.size();
    if (id === 'del') { (o.type === 'activeSelection' ? fc.getActiveObjects() : [o]).forEach(x => fc.remove(x)); fc.discardActiveObject(); }
    else if (id === 'dup') o.clone((cl) => { cl.set({ left: o.left + 36, top: o.top + 36 }); fc.add(cl); fc.setActiveObject(cl); }, ['name']);
    else if (id === 'fwd') o.bringForward(); else if (id === 'back') o.sendBackwards();
    else if (id === 'ch') o.setPositionByOrigin(new (F().Point)(w / 2, o.getCenterPoint().y), 'center', 'center');
    else if (id === 'cv') o.setPositionByOrigin(new (F().Point)(o.getCenterPoint().x, hh / 2), 'center', 'center');
    o.setCoords && o.setCoords(); fc.requestRenderAll();
    if (id !== 'del') fc.fire('object:modified', { target: o });
  }

  function bind(box, api) {
    box.oninput = (e) => { const id = e.target.dataset.c; if (id && e.target.tagName !== 'BUTTON') apply(id, e.target.value, false); };
    box.onchange = (e) => { const id = e.target.dataset.c; if (id && e.target.tagName !== 'BUTTON') apply(id, e.target.value, true); };
    box.onclick = (e) => {
      const a = e.target.closest('[data-act]'); if (a) return act(a.dataset.act, api);
      const b = e.target.closest('button[data-c]'); if (!b) return;
      const c = P.specs.find(s => s.id === b.dataset.c); if (!c) return;
      if (c.kind === 'toggles') { const t = textOf(P.obj), it = c.items.find(i => i[0] === b.dataset.k);
        kit.ensureFont(t.fontFamily, 800).then(() => { it[4](t, !it[3](t)); touch(P.obj); sync(); fcv().fire('object:modified', { target: P.obj }); }); }
      else apply(c.id, b.dataset.v, true);
    };
  }

  /* Punto de entrada que llama studio.js cada vez que cambia algo: reconstruye solo si cambió el objeto */
  Studio.propsRenderer = function (box, o, api) {
    if (!o) { P.box = box; P.obj = null; P.key = ''; box.innerHTML = '<div class="st-empty">Tocá un elemento del lienzo para editarlo.<br><small>Mantené presionado y arrastrá para moverlo.</small></div>'; return; }
    if (o.type === 'activeSelection') {
      P.box = box; P.obj = o; P.specs = []; P.key = 'multi';
      box.innerHTML = `<div class="st-kv"><span>Selección</span><b>${o.getObjects().length} elementos</b></div>${actionsHtml(ACTIONS.filter(a => a[0] === 'del'))}`;
      bind(box, api); return;
    }
    const key = (o.__uid ||= ++P.uid) + ':' + o.type;
    if (box === P.box && key === P.key && box.firstChild) { P.obj = o; return sync(); }
    P.box = box; P.key = key; P.obj = o;
    build(box, o, api); bind(box, api); sync();
  };
})();
