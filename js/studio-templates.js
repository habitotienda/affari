/* ==========================================================================
   Affari · Estudio de Diseño — FASE 2 · plantillas
   Cada plantilla es una función build(W, H, u) → { bg, objects } que se adapta al formato
   elegido (u = escala relativa a 1080 px). Las miniaturas se dibujan con la misma función
   sobre un StaticCanvas, así que siempre coinciden con lo que se va a aplicar.
   Requiere studio.js y studio-tools.js (Studio.kit).
   ========================================================================== */
(() => {
  'use strict';
  const Studio = window.Studio; if (!Studio || !Studio.kit.text) return;
  const kit = Studio.kit, F = () => window.fabric;
  const T = (str, o) => kit.text(str, o);

  /* ------------------------------------------------------------ catálogo */
  const TEMPLATES = [
    { id: 'oferta', name: 'Oferta del día', build: (W, H, u) => ({
      bg: { type: 'solid', color: '#0F172A' },
      objects: [
        kit.circle({ left: W * .88, top: H * .1, radius: 280 * u, fill: '#10B981', opacity: .22, name: 'Decoración' }),
        kit.circle({ left: W * .06, top: H * .92, radius: 210 * u, fill: '#10B981', opacity: .14, name: 'Decoración' }),
        T('OFERTA DEL DÍA', { left: W / 2, top: H * .2, fontSize: 54 * u, fontWeight: 700, fill: '#34D399', charSpacing: 300, width: W * .85 }),
        T('Nombre del producto', { left: W / 2, top: H * .36, fontSize: 96 * u, fill: '#FFFFFF', width: W * .8 }),
        T('$9.999', { left: W / 2, top: H * .56, fontSize: 280 * u, fill: '#10B981', width: W * .9 }),
        T('$14.999', { left: W / 2, top: H * .73, fontSize: 76 * u, fontWeight: 600, fill: '#94A3B8', linethrough: true, width: W * .6 }),
        T('Tu negocio · WhatsApp 000 000-0000', { left: W / 2, top: H * .91, fontSize: 38 * u, fontWeight: 600, fill: '#CBD5E1', width: W * .88 }),
      ] }) },

    { id: 'lanzamiento', name: 'Lanzamiento', build: (W, H, u) => ({
      bg: { type: 'grad', a: '#ECFDF5', b: '#A7F3D0' },
      objects: [
        kit.badge(kit.rect({ width: 300 * u, height: 100 * u, rx: 50 * u, ry: 50 * u, fill: '#0F172A' }), 'NUEVO',
          { fontSize: 54 * u, fill: '#FFFFFF', charSpacing: 120, width: 280 * u }, W / 2, H * .22, 'Nuevo'),
        T('Ya llegó', { left: W / 2, top: H * .38, fontSize: 150 * u, fill: '#064E3B', width: W * .85 }),
        T('Descubrí lo nuevo de nuestra colección', { left: W / 2, top: H * .53, fontSize: 56 * u, fontWeight: 600, fill: '#065F46', width: W * .75 }),
        kit.badge(kit.rect({ width: 560 * u, height: 200 * u, rx: 100 * u, ry: 100 * u, fill: '#10B981' }), '$9.999',
          { fontSize: 120 * u, fill: '#FFFFFF', width: 520 * u }, W / 2, H * .72, 'Etiqueta de precio'),
        T('Tu negocio · @usuario', { left: W / 2, top: H * .92, fontSize: 40 * u, fontWeight: 600, fill: '#047857', width: W * .85 }),
      ] }) },

    { id: 'lista', name: 'Lista de precios', build: (W, H, u) => {
      const rows = ['Producto uno', 'Producto dos', 'Producto tres', 'Producto cuatro', 'Producto cinco'];
      const y0 = H * .3, step = (H * .6) / rows.length, objs = [
        T('Lista de precios', { left: W / 2, top: H * .13, fontSize: 112 * u, fill: '#7C2D12', width: W * .85 }),
        kit.rect({ left: W / 2, top: H * .2, width: 160 * u, height: 10 * u, rx: 5, ry: 5, fill: '#F97316', name: 'Línea' }),
      ];
      rows.forEach((r, i) => {
        const y = y0 + step * i + step / 2;
        objs.push(T(r, { left: W * .09, top: y, originX: 'left', textAlign: 'left', fontSize: 54 * u, fontWeight: 600, fill: '#431407', width: W * .55 }));
        objs.push(T('$0.000', { left: W * .91, top: y, originX: 'right', textAlign: 'right', fontSize: 62 * u, fill: '#EA580C', width: W * .3 }));
        if (i < rows.length - 1) objs.push(kit.rect({ left: W / 2, top: y + step / 2, width: W * .82, height: 3, fill: '#FDBA74', name: 'Divisor' }));
      });
      return { bg: { type: 'solid', color: '#FFF7ED' }, objects: objs };
    } },

    { id: 'descuento', name: 'Descuento %', build: (W, H, u) => ({
      bg: { type: 'solid', color: '#10B981' },
      objects: [
        kit.circle({ left: W * .5, top: H * .46, radius: 400 * u, fill: '#FFFFFF', opacity: .12, name: 'Decoración' }),
        T('30%', { left: W / 2, top: H * .4, fontSize: 480 * u, fill: '#FFFFFF', width: W * .95 }),
        T('DE DESCUENTO', { left: W / 2, top: H * .63, fontSize: 92 * u, fill: '#052E22', charSpacing: 120, width: W * .9 }),
        T('En toda la tienda · Solo por hoy', { left: W / 2, top: H * .76, fontSize: 52 * u, fontWeight: 600, fill: '#ECFDF5', width: W * .8 }),
        T('Tu negocio', { left: W / 2, top: H * .92, fontSize: 44 * u, fontWeight: 700, fill: '#052E22', width: W * .8 }),
      ] }) },

    { id: 'simple', name: 'Simple y limpia', build: (W, H, u) => ({
      bg: { type: 'solid', color: '#F8FAFC' },
      objects: [
        kit.rect({ left: W * .5, top: H * .08, width: W, height: 16 * u, fill: '#10B981', name: 'Franja' }),
        T('Título de tu placa', { left: W / 2, top: H * .36, fontSize: 120 * u, fill: '#0F172A', width: W * .8 }),
        T('Escribí acá una descripción corta de tu producto o promoción.', { left: W / 2, top: H * .56, fontSize: 48 * u, fontWeight: 400, fill: '#475569', width: W * .7 }),
        T('$0.000', { left: W / 2, top: H * .76, fontSize: 200 * u, fill: '#10B981', width: W * .8 }),
      ] }) },
  ];

  /* ------------------------------------------------------------- aplicar */
  const unit = (W, H) => Math.min(W, H) / 1080;
  const warm = () => Promise.all([400, 600, 700, 800].map(w => kit.ensureFont('Plus Jakarta Sans', w)));   // fuentes listas antes de medir

  async function applyTemplate(api, tpl) {
    const fc = api.canvas(); if (!fc) return;
    if (fc.getObjects().length && !window.confirm('Esto reemplaza todo lo que hay en el lienzo. ¿Continuar?')) return;
    await warm();
    const { w, h } = api.size(), { bg, objects } = tpl.build(w, h, unit(w, h));
    fc.getObjects().slice().forEach(o => fc.remove(o));
    fc.discardActiveObject();
    kit.applyBg(api, bg);
    objects.forEach(o => fc.add(o));
    fc.requestRenderAll();
    api.emit('template', tpl);
    if (api.mode() === 'mobile') api.closeSheet();                 // en celular, mostrar el resultado
  }

  /* ---------------------------------------------------------- miniaturas */
  async function thumbs(api) {
    await warm();
    const { w, h } = api.size(), out = {};
    for (const tpl of TEMPLATES) {
      try {
        const { bg, objects } = tpl.build(w, h, unit(w, h));
        const sc = new (F().StaticCanvas)(null, { width: w, height: h, renderOnAddRemove: false });
        sc.backgroundColor = kit.bgValue(bg, w, h);
        objects.forEach(o => sc.add(o));
        sc.renderAll();
        out[tpl.id] = sc.toDataURL({ format: 'jpeg', quality: .72, multiplier: Math.min(1, 300 / Math.max(w, h)) });
        sc.dispose();
      } catch (e) { console.warn('[Studio] miniatura', tpl.id, e); }
      await new Promise(r => setTimeout(r));                       // cede el hilo: no traba el celular
    }
    return out;
  }

  /* --------------------------------------------------------------- panel */
  Studio.registerPane('plantillas', {
    render(body, api) {
      const draw = (imgs = {}) => {
        const { w, h } = api.size();
        body.innerHTML = `<div class="st-section"><h3>Placas listas para editar</h3>
          <div class="st-tpls">${TEMPLATES.map(t => `<button class="st-tpl" type="button" data-id="${t.id}">
            <span class="st-tpl-img" style="aspect-ratio:${w}/${h}">${imgs[t.id] ? `<img alt="" src="${imgs[t.id]}">` : '<i class="st-skel-i"></i>'}</span><small>${t.name}</small></button>`).join('')}</div></div>
          <p class="st-help">Se adaptan al formato que elijas arriba. Después editá textos, colores y fondo.</p>`;
      };
      draw();
      body.onclick = (e) => { const b = e.target.closest('.st-tpl'); if (b) applyTemplate(api, TEMPLATES.find(t => t.id === b.dataset.id)); };
      let gen = 0;
      const refresh = async () => { const my = ++gen; const imgs = await thumbs(api); if (my === gen && body.isConnected) draw(imgs); };
      api.on('ready', refresh);                                    // Fabric ya cargó
      api.on('format', refresh);                                   // otro formato → otras proporciones
    },
  });
})();
