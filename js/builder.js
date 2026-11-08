/* Editor visual del catálogo (panel del comercio). Genera las tarjetas de configuración
   y lee el formulario completo hacia el objeto `theme`. Depende de esc() y de js/store/*. */
const BD = (() => {
  const SOLIDS = ['#FFFFFF', '#F8FAFC', '#F1F5F9', '#FEF3C7', '#FFE4E6', '#FCE7F3', '#EDE9FE', '#DBEAFE', '#CCFBF1', '#DCFCE7', '#0F172A', '#1E293B', '#064E3B', '#4C1D95', '#7F1D1D', '#18181B'];
  /* [nombre, fondo, acento, texto, patrón, color del patrón] */
  const PRESETS = [
    ['Esmeralda', '#F8FAFC', '#10B981', '#0F172A', 'none', ''], ['Noche', '#0F172A', '#10B981', '#F8FAFC', 'none', ''],
    ['Cálido', '#FFF7ED', '#EA580C', '#431407', 'dots', ''], ['Industrial', '#F4F4F5', '#FACC15', '#18181B', 'diagonal', '#18181B'],
    ['Burbujas menta', '#ECFDF5', '#10B981', '#064E3B', 'bubbles', ''], ['Aurora noche', '#0B1220', '#38BDF8', '#F8FAFC', 'aurora', ''],
    ['Rosa pastel', '#FFF1F2', '#E11D48', '#4C0519', 'scales', ''], ['Papel', '#FAF7F0', '#B45309', '#292524', 'grain', '#78350F'],
  ];
  const seg = (name, opts, val, cls = '') => `<div class="seg ${cls}">${opts.map(([o, l]) => `<label><input type="radio" name="${name}" value="${o}" ${String(o) === String(val) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const card = (title, body) => `<div class="card"><div class="section-title">${title}</div><div class="cfg-body">${body}</div></div>`;
  /* Color opcional: sin tocar = automático (se guarda ''). */
  const opt = (name, label, val, fallback) => `<label class="opt">${label}<span><input type="color" name="${name}" data-opt ${val ? 'data-set="1"' : ''} value="${val || fallback}"><button type="button" class="btn btn-sm" data-auto="${name}" ${val ? '' : 'hidden'}>Auto</button></span></label>`;
  const tile = (p, label, t) => `<label class="fx-tile"><input type="radio" name="pattern" value="${p}" ${t.pattern === p ? 'checked' : ''}><span><b style="background:${t.bg}"><u data-pat="${p}"></u></b><em>${label}</em></span></label>`;
  /* Pinta la miniatura de cada efecto con los colores actuales (se anima al pasar el mouse) */
  const paint = (form, t) => form.querySelectorAll('[data-pat]').forEach(u => {
    u.parentNode.style.background = t.bg;
    sfFx(u, { pattern: u.dataset.pat, patColor: t.patColor, accent: t.accent, patOpacity: Math.max(t.patOpacity, 34), patAnimate: true, patSpeed: 3 });
  });

  /* ---- Imágenes propias (Canva, etc.) ---- */
  const slot = (key, label, hint, t) => `<div class="mslot" data-slot="${key}"><div class="mprev" data-mprev="${key}"></div><div class="minfo"><strong>${label}</strong><small>${hint}</small>
    <div class="mbtn"><label class="btn btn-sm" for="up_${key}">Subir imagen</label><input id="up_${key}" type="file" accept="image/*" hidden data-up="${key}"><button type="button" class="btn btn-sm btn-danger" data-rmimg="${key}" hidden>Quitar</button></div></div></div>`;
  const rng = (name, label, min, max, val) => `<label class="rng">${label}<input type="range" name="${name}" min="${min}" max="${max}" step="5" value="${val}"></label>`;
  const gal = (kind, title, hint) => `<div class="field"><label>${title} <small class="muted">${hint}</small></label><div class="dgal ${kind}">${SF_DESIGNS.filter(d => d.kind === kind).map(d =>
    `<button type="button" class="dg" data-design="${d.id}" title="${esc(d.name)}"><img src="${d.url}" alt="${esc(d.name)}" loading="lazy"><span>${esc(d.name)}</span></button>`).join('')}</div></div>`;
  function media(t) {
    return card('Diseños listos para usar', `<p class="hint" style="margin:0 0 12px">Elegí uno con un toque. Los fondos se mueven solos y ajustan los colores para que todo se lea bien.</p>
      ${gal('cover', 'Portadas', '· cabecera de la tienda')}${gal('bg', 'Fondos animados', '· se mueven solos')}${gal('promo', 'Banners promocionales', '· hasta 5')}`)
    + card('Imágenes propias (Canva y más)', `<p class="hint" style="margin:0 0 14px">Diseñalas en Canva, descargalas como <b>JPG o PNG</b> y subilas acá. Se reducen solas para que la tienda cargue rápido.</p>
      ${slot('coverImg', 'Portada de la cabecera', 'Horizontal · 1600 × 500 px aprox.', t)}
      <div class="field" data-need="coverImg">${rng('coverDim', 'Oscurecer portada (para que se lea el nombre)', 0, 70, t.coverDim)}</div>
      <hr class="msep">
      ${slot('bgImg', 'Imagen de fondo de la tienda', 'Vertical 1080 × 1920 o horizontal 1920 × 1080', t)}
      <div class="mopts" data-need="bgImg"><div class="field"><label>Cómo se acomoda</label>${seg('bgImgMode', [['cover', 'Cubrir la pantalla'], ['tile', 'Repetir en mosaico']], t.bgImgMode)}</div>
        <div class="field">${rng('bgImgDim', 'Velo claro sobre la imagen (más velo = texto más legible)', 0, 85, t.bgImgDim)}</div></div>
      <hr class="msep">
      <div class="field"><label>Banners promocionales <small class="muted">(hasta 5 · se deslizan solos)</small></label><p class="hint" style="margin:0 0 8px">Horizontal · 1200 × 400 px aprox. Aparecen debajo de la cabecera.</p>
        <div class="gal-ed promos-ed" data-promos-ed></div><input id="up_promos" type="file" accept="image/*" multiple hidden data-up="promos"></div>`);
  }
  /* Achica la imagen hasta que entre en el límite del servidor (≈1,2 MB) */
  async function fit(file) {
    if (!/^image\//.test(file.type)) throw new Error('Ese archivo no es una imagen.');
    for (const [m, q] of [[1920, .82], [1600, .72], [1280, .64], [1000, .55]]) { const d = await imgToData(file, m, 'image/jpeg', q); if (d.length <= 1_500_000) return d; }
    throw new Error('La imagen es demasiado pesada. Probá con una más chica.');
  }
  const drawMedia = (form, t) => {
    for (const k of ['coverImg', 'bgImg']) {
      form.querySelector(`[data-mprev=${k}]`).innerHTML = t[k] ? `<img src="${esc(t[k])}" alt="">` : '<span>Sin imagen</span>';
      form.querySelector(`[data-rmimg=${k}]`).hidden = !t[k];
      form.querySelectorAll(`[data-need=${k}]`).forEach(x => { x.hidden = !t[k]; });
    }
    const ps = t.promos || [];
    form.querySelector('[data-promos-ed]').innerHTML = ps.map((src, i) => `<div class="gal-it"><img src="${esc(src)}" alt="Banner ${i + 1}"><button type="button" data-rmpromo="${i}" aria-label="Quitar banner ${i + 1}">×</button></div>`).join('')
      + (ps.length < SF_MAX_PROMOS ? '<label class="gal-add" for="up_promos" title="Agregar banner">+</label>' : '');
  };
  function mediaBind(form, t, sync, toast) {
    drawMedia(form, t);
    form.addEventListener('change', async e => {
      const inp = e.target.closest && e.target.closest('[data-up]'); if (!inp) return;
      const files = [...inp.files]; inp.value = ''; if (!files.length) return;
      try {
        if (inp.dataset.up === 'promos') { for (const f of files.slice(0, SF_MAX_PROMOS - (t.promos || []).length)) (t.promos ||= []).push(await fit(f)); }
        else t[inp.dataset.up] = await fit(files[0]);
        drawMedia(form, t); sync();
      } catch (err) { toast(err.message); }
    });
    form.addEventListener('click', e => {
      const dg = e.target.closest('[data-design]');
      if (dg) {
        const d = SF_DESIGNS.find(x => x.id === dg.dataset.design); if (!d) return;
        const setv = (n, v) => { const f = form.querySelector(`[name=${n}]`); if (f) f.value = v; };
        if (d.kind === 'cover') t.coverImg = d.url;
        else if (d.kind === 'promo') { t.promos ||= []; if (t.promos.includes(d.url)) return toast('Ese banner ya está agregado.'); if (t.promos.length >= SF_MAX_PROMOS) return toast('Máximo 5 banners.'); t.promos.push(d.url); }
        else {
          t.bgImg = d.url; const m = form.querySelector('[name=bgImgMode][value=cover]'); if (m) m.checked = true; setv('bgImgDim', 0);
          const none = form.querySelector('[name=pattern][value=none]'); if (none) none.checked = true;
          for (const k of ['bg', 'text', 'accent']) setv(k, d.theme[k]);
        }
        drawMedia(form, t); return sync();
      }
      const r = e.target.closest('[data-rmimg]'), p = e.target.closest('[data-rmpromo]');
      if (r) { t[r.dataset.rmimg] = ''; drawMedia(form, t); sync(); }
      else if (p) { t.promos.splice(+p.dataset.rmpromo, 1); drawMedia(form, t); sync(); }
    });
  }

  /* Tarjetas nuevas: fondo, colores, tarjetas/logo, textos extra */
  function cards(t) {
    const fondo = card('Fondo de la tienda', `
      <div class="field"><label>Color sólido</label><div class="swatches">${SOLIDS.map(c => `<button type="button" class="sw" data-solid="${c}" style="background:${c}" aria-label="Fondo ${c}"></button>`).join('')}<label class="sw sw-pick" title="Elegir otro color"><input type="color" name="bg" value="${t.bg}"></label></div></div>
      <div class="field"><label>Efecto decorativo</label><div class="fx-tiles">${SF_PATTERNS.map(([p, l]) => tile(p, l, t)).join('')}</div></div>
      <div class="fx-ctl" data-fxctl>${opt('patColor', 'Color del efecto', t.patColor, t.accent)}
        <label class="rng">Intensidad<input type="range" name="patOpacity" min="8" max="60" step="2" value="${t.patOpacity}"></label>
        <div class="field" style="margin:0"><label>Velocidad de la animación</label>${seg('patSpeed', [[1, 'Lenta'], [2, 'Normal'], [3, 'Rápida']], t.patSpeed, 'seg3')}</div>
        <label class="check"><input type="checkbox" name="patAnimate" ${t.patAnimate ? 'checked' : ''}>Animar el fondo</label>
        <p class="hint" style="margin:0">Quien tenga activado «reducir movimiento» en su celular o computadora verá el fondo quieto.</p></div>`);
    const colores = card('Colores y combinaciones', `<div class="presets">${PRESETS.map(([n, a, b, c, p, pc], i) => `<button type="button" class="preset" data-preset="${i}"><i style="background:linear-gradient(135deg,${a} 50%,${b} 50%)"></i>${n}</button>`).join('')}</div>
      <div class="colors"><label>Acento / botones<input type="color" name="accent" value="${t.accent}"></label><label>Texto<input type="color" name="text" value="${t.text}"></label></div>
      <div class="colors opts">${opt('headColor', 'Títulos', t.headColor, t.text)}${opt('priceColor', 'Precios', t.priceColor, t.text)}${opt('cardColor', 'Fondo de tarjetas', t.cardColor, '#FFFFFF')}</div>
      <p class="hint" data-contrast></p>`);
    const forma = card('Tarjetas, logo y cabecera', `<div class="field"><label>Estilo de tarjeta</label>${seg('cardStyle', [['solid', 'Sólida'], ['glass', 'Vidrio'], ['outline', 'Borde'], ['soft', 'Suave']], t.cardStyle, 'seg4')}</div>
      <div class="field"><label>Forma del logo</label>${seg('logoShape', [['rounded', 'Redondeado'], ['circle', 'Círculo'], ['square', 'Cuadrado']], t.logoShape, 'seg3')}</div>
      <div class="field"><label>Cabecera</label>${seg('heroAlign', [['left', 'A la izquierda'], ['center', 'Centrada']], t.heroAlign)}</div>`);
    const textos = `<div class="field"><label for="bdAdd">Texto del botón de compra</label><div class="input"><input id="bdAdd" name="addLabel" maxlength="16" value="${esc(t.addLabel)}" placeholder="Agregar"></div></div>
      <div class="field"><label for="bdFoot">Pie de página</label><div class="input"><input id="bdFoot" name="footer" maxlength="160" value="${esc(t.footer)}" placeholder="Lun a Sáb 9 a 18 hs · Av. Siempreviva 742"></div></div>`;
    return { fondo, colores, forma, textos };
  }

  /* Lee TODOS los campos con name="" del formulario hacia el tema */
  function collect(form, theme) {
    const NUM = ['cols', 'patOpacity', 'patSpeed', 'bgImgDim', 'coverDim'];
    form.querySelectorAll('[name]').forEach(f => {
      const k = f.name; if (f.type === 'radio') { if (f.checked) theme[k] = NUM.includes(k) ? Number(f.value) : f.value; return; }
      if (f.type === 'checkbox') theme[k] = f.checked;
      else if (f.hasAttribute('data-opt')) theme[k] = f.dataset.set ? f.value : '';
      else theme[k] = NUM.includes(k) ? Number(f.value) : f.value;
    });
    return theme;
  }

  /* Eventos propios (swatches, presets, botón Auto, aviso de contraste). `sync` relee el formulario y redibuja. */
  function bind(form, theme, sync) {
    const set = (n, v) => { const el = form.querySelector(`[name=${n}]`); if (el) el.value = v; };
    const radio = (n, v) => { const el = form.querySelector(`[name=${n}][value="${v}"]`); if (el) el.checked = true; };
    const hint = () => {
      const c = sfContrast(theme.text, theme.bg), el = form.querySelector('[data-contrast]');
      el.textContent = c < 4.5 ? `⚠ El texto casi no se distingue del fondo (contraste ${c.toFixed(1)}:1). Probá un color más oscuro o más claro.` : '';
      el.classList.toggle('warn', c < 4.5);
    };
    // En captura: debe marcar el color como "elegido" ANTES de que el editor relea el formulario
    form.addEventListener('input', e => { if (e.target.hasAttribute && e.target.hasAttribute('data-opt')) { e.target.dataset.set = '1'; form.querySelector(`[data-auto=${e.target.name}]`).hidden = false; } }, true);
    form.addEventListener('click', e => {
      const sw = e.target.closest('[data-solid]'), pr = e.target.closest('[data-preset]'), au = e.target.closest('[data-auto]');
      if (sw) { set('bg', sw.dataset.solid.toLowerCase()); radio('pattern', 'none'); sync(); }
      else if (pr) {
        const [, bg, ac, tx, pat, pc] = PRESETS[+pr.dataset.preset];
        set('bg', bg.toLowerCase()); set('accent', ac.toLowerCase()); set('text', tx.toLowerCase()); radio('pattern', pat);
        const p = form.querySelector('[name=patColor]'); if (pc) { p.value = pc.toLowerCase(); p.dataset.set = '1'; } else delete p.dataset.set;
        form.querySelector('[data-auto=patColor]').hidden = !pc; sync();
      } else if (au) { const el = form.querySelector(`[name=${au.dataset.auto}]`); delete el.dataset.set; au.hidden = true; sync(); }
    });
    return { hint };
  }
  return { cards: t => ({ ...cards(t), media: media(t) }), collect, bind, paint, mediaBind };
})();
