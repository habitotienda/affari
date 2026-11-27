/* Presupuestos: se arman como una venta (productos o ítems libres con su precio) → resumen → datos → imagen para compartir / WhatsApp.
   No descuentan stock ni tocan la caja. Backend: backend/quotes.py. Reutiliza los estilos .sv-* de sale-flow.css.
   Usa api(), esc(), ars(), icon(), toast(), refresh(), state, waNum(), head(), sfThumb(), Back. */
(() => {
  const n2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
  const longDate = s => new Date(String(s).replace(' ', 'T')).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  const ST = { pendiente: 'Pendiente', aceptado: 'Aceptado', rechazado: 'Rechazado' };
  const VALID = [[7, '7 días'], [15, '15 días'], [30, '30 días'], [0, 'Sin vencimiento']];

  /* ---------- imagen del presupuesto (canvas PNG) ---------- */
  function quoteCanvas(q) {
    const W = 760, P = 56, F = '"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', INK = '#0F172A', MUT = '#64748B', A = '#4F46E5', LINE = '#CBD5E1';
    const probe = document.createElement('canvas').getContext('2d');
    const wrap = (t, font, max) => { probe.font = font; const out = []; String(t).split('\n').forEach(par => { let line = ''; par.split(' ').forEach(w => { const x = line ? line + ' ' + w : w; if (probe.measureText(x).width > max && line) { out.push(line); line = w; } else line = x; }); out.push(line); }); return out; };
    const business = (state.user && state.user.business) || '', seller = (state.user && state.user.name) || '';
    const meta = [['Cliente', q.client_name || 'Sin nombre'], ['Fecha', longDate(q.created_at)], [q.valid_until ? 'Válido hasta' : 'Validez', q.valid_until ? dmy(q.valid_until) : 'Sin vencimiento'], ['Preparado por', seller]];
    const noteLines = q.note ? wrap(q.note, `500 24px ${F}`, W - 2 * P) : [];
    const paint = (x, H) => {
      if (H) { x.fillStyle = '#EEF2FF'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.fillRect(24, 24, W - 48, H - 48); x.fillStyle = A; x.fillRect(24, 24, W - 48, 14); }
      const dash = () => { x.strokeStyle = LINE; x.lineWidth = 2; x.setLineDash([10, 8]); x.beginPath(); x.moveTo(P, y); x.lineTo(W - P, y); x.stroke(); x.setLineDash([]); };
      let y = 110; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
      x.fillStyle = INK; x.font = `800 40px ${F}`; x.fillText(business.slice(0, 26), P, y);
      x.fillStyle = MUT; x.font = `600 24px ${F}`; y += 40; x.fillText(`Presupuesto N.º ${q.number}`, P, y);
      const tag = 'PRESUPUESTO'; x.font = `800 22px ${F}`; const tw = x.measureText(tag).width + 32;
      x.save(); x.translate(W - P - tw / 2, 92); x.rotate(.08); x.strokeStyle = A; x.lineWidth = 4; x.strokeRect(-tw / 2, -26, tw, 48); x.fillStyle = A; x.textAlign = 'center'; x.fillText(tag, 0, 7); x.restore(); x.textAlign = 'left';
      y += 44; dash(); y += 50;
      x.fillStyle = MUT; x.font = `600 24px ${F}`; x.fillText('Total', P, y); y += 70; x.fillStyle = INK; x.font = `800 68px ${F}`; x.fillText(ars(q.total), P, y);
      y += 34; dash(); y += 44;
      meta.forEach(([k, v]) => { x.font = `500 24px ${F}`; x.fillStyle = MUT; x.fillText(k, P, y); x.font = `700 24px ${F}`; x.fillStyle = INK; x.textAlign = 'right'; x.fillText(String(v).slice(0, 34), W - P, y); x.textAlign = 'left'; y += 46; });
      y -= 6; dash(); y += 46;
      q.items.forEach(i => {
        wrap(`${i.qty} × ${i.name}`, `600 26px ${F}`, W - 2 * P - 190).forEach((t, k) => {
          x.font = `600 26px ${F}`; x.fillStyle = INK; x.fillText(t, P, y);
          if (!k) { x.font = `700 26px ${F}`; x.textAlign = 'right'; x.fillText(ars(i.qty * i.unit), W - P, y); x.textAlign = 'left'; }
          y += 36; });
        if (i.qty > 1) { x.font = `500 22px ${F}`; x.fillStyle = MUT; x.fillText(`${ars(i.unit)} c/u`, P, y - 4); y += 30; }
        y += 14; });
      y -= 4; dash(); y += 46;
      const row = (k, v, big) => { x.font = `${big ? 800 : 500} ${big ? 32 : 24}px ${F}`; x.fillStyle = big ? INK : MUT; x.fillText(k, P, y); x.fillStyle = INK; x.textAlign = 'right'; x.fillText(v, W - P, y); x.textAlign = 'left'; y += big ? 0 : 42; };
      if (q.discount) { row('Subtotal', ars(q.subtotal)); row('Descuento', '− ' + ars(q.discount)); y += 6; }
      row('Total', ars(q.total), true); y += 40;
      if (noteLines.length) { dash(); y += 44; x.font = `600 22px ${F}`; x.fillStyle = MUT; x.fillText('Nota', P, y); noteLines.forEach(t => { y += 34; x.font = `500 24px ${F}`; x.fillStyle = INK; x.fillText(t, P, y); }); y += 30; }
      x.fillStyle = A; x.font = `700 24px ${F}`; x.textAlign = 'center'; x.fillText('¡Gracias por consultarnos!', W / 2, y + 40); y += 40;
      if (q.valid_until) { x.fillStyle = MUT; x.font = `500 20px ${F}`; x.fillText('Los precios pueden cambiar después de la fecha de vencimiento.', W / 2, y + 36); y += 36; }
      x.textAlign = 'left';
      return y;
    };
    const H = Math.round(paint(probe) + 70), s = 2, cv = document.createElement('canvas'); cv.width = W * s; cv.height = H * s;
    const x = cv.getContext('2d'); x.scale(s, s); paint(x, H); return cv;
  }

  /* Imagen + botones Compartir / WhatsApp / Guardar (mismo mecanismo que el comprobante de venta) */
  function drawQuote(body, q) {
    body.innerHTML = `<div class="sv-rc"><img data-img alt="Presupuesto N.º ${q.number}"></div>
      <p class="muted sv-hint">Compartilo como imagen por WhatsApp o guardalo en tu teléfono.</p>
      <div class="sv-acts"><button type="button" class="btn btn-primary" data-share>Compartir</button><button type="button" class="btn btn-wa" data-wa>WhatsApp</button><button type="button" class="btn" data-dl>${icon('download', 16)}Guardar</button></div>`;
    const cv = quoteCanvas(q); body.querySelector('[data-img]').src = cv.toDataURL('image/png');
    const fname = `presupuesto-${q.number}.png`, caption = `${state.user.business} · Presupuesto N.º ${q.number} · Total ${ars(q.total)}${q.valid_until ? ' · Válido hasta ' + dmy(q.valid_until) : ''}`;
    let file = null; cv.toBlob(b => { if (b) file = new File([b], fname, { type: 'image/png' }); }, 'image/png');       // se genera de antemano: navigator.share exige llamarse justo al tocar
    const canShareFile = () => !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    const save = () => { if (!file) return; const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const share = async () => { try { await navigator.share({ files: [file], title: `Presupuesto ${q.number}`, text: caption }); } catch {} };
    body.querySelector('[data-dl]').onclick = save;
    body.querySelector('[data-share]').onclick = () => canShareFile() ? share() : save();
    body.querySelector('[data-wa]').onclick = async () => {
      if (canShareFile()) return share();
      let copied = false; try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]); copied = true; } catch {}
      if (!copied) save();
      window.open(`https://wa.me/${q.client_phone ? waNum(q.client_phone) : ''}?text=${encodeURIComponent(caption)}`, '_blank', 'noopener');
      toast(copied ? 'Imagen copiada: pegala en el chat de WhatsApp (Ctrl+V)' : 'Imagen guardada: adjuntala en el chat de WhatsApp'); };
  }

  /* ---------- armar un presupuesto ---------- */
  async function openQuoteFlow() {
    let products, clients;
    try { [products, clients] = await Promise.all([api('/products'), api('/clients')]); } catch (e) { return toast(e.message); }
    const rows = [];
    products.filter(p => p.active).forEach(p => {                           // los presupuestos no dependen del stock
      if (p.variants && p.variants.length) p.variants.forEach(v => rows.push({ key: `${p.id}:${v.id}`, pid: p.id, name: `${p.name} · ${v.name}`, price: v.price || p.price, img: p.images && p.images[0] }));
      else rows.push({ key: `${p.id}:0`, pid: p.id, name: p.name, price: p.price, img: p.images && p.images[0] });
    });
    let seq = 0;
    const S = { step: 1, q: '', cart: new Map(), dtype: '%', dval: 0, client: null, days: 7, note: '', quote: null, busy: false };
    const thumb = x => `<div class="sv-th">${x.img ? `<img src="${esc(sfThumb(x.img, 160))}" alt="" loading="lazy">` : esc((x.name[0] || '?').toUpperCase())}</div>`;
    const sub = () => [...S.cart.values()].reduce((a, i) => a + i.qty * i.price, 0);
    const disc = () => n2(Math.min(sub(), S.dtype === '%' ? sub() * Math.min(S.dval, 100) / 100 : S.dval));
    const total = () => n2(sub() - disc());
    const units = () => [...S.cart.values()].reduce((a, i) => a + i.qty, 0);

    const ov = document.createElement('div'); ov.className = 'sv';
    ov.innerHTML = `<div class="sv-box" role="dialog" aria-modal="true" aria-label="Nuevo presupuesto"><header class="sv-head"><button type="button" class="icon-btn" data-back aria-label="Volver"></button><h2 data-ttl></h2><button type="button" class="icon-btn" data-x aria-label="Cerrar">${icon('close')}</button></header>
      <div class="sv-prog" data-prog></div><div class="sv-body" data-body></div><div class="sv-foot" data-foot></div></div>`;
    document.body.appendChild(ov);
    const $ = s => ov.querySelector(s), body = $('[data-body]');
    const onKey = e => { if (e.key === 'Escape' && !ov.querySelector('.sv-sheet')) close(); };
    document.addEventListener('keydown', onKey);
    const bh = Back.open({ onBack: () => {
      const sh = ov.querySelector('.sv-sheet'); if (sh) { sh.remove(); return true; }
      if (S.step > 1 && S.step < 4) { S.step--; render(); return true; }
      close(); } });
    const close = () => { document.removeEventListener('keydown', onKey); Back.release(bh); ov.remove(); if (S.quote) refresh(); };
    $('[data-x]').onclick = close;
    $('[data-back]').onclick = () => { if (S.step > 1 && S.step < 4) { S.step--; render(); } else close(); };

    const setQty = (key, d) => {
      let it = S.cart.get(key);
      if (!it) { const r = rows.find(x => x.key === key); if (r && d > 0) S.cart.set(key, { ...r, qty: 1 }); }
      else { it.qty = Math.max(0, Math.min(100000, it.qty + d)); if (!it.qty) S.cart.delete(key); }
      if (S.step === 1) { drawList(); foot(); } else render();
    };
    function drawList() {
      const q = S.q.trim().toLowerCase(), list = body.querySelector('[data-list]'); if (!list) return;
      const custom = [...S.cart.values()].filter(i => !i.pid), r = rows.filter(x => !q || x.name.toLowerCase().includes(q));
      list.innerHTML = [...custom, ...r].map(x => { const it = S.cart.get(x.key);
        return `<div class="sv-item ${it ? 'sel' : ''}">${thumb(x)}<div class="sv-info"><strong>${esc(x.name)}</strong>${x.pid ? '' : '<span class="sv-tag">Ítem libre</span>'}<b>${ars(x.price)}</b></div>
        <div class="sv-stp"><button type="button" data-m="${x.key}" aria-label="Quitar uno">−</button><b>${it ? it.qty : 0}</b><button type="button" data-p="${x.key}" aria-label="Agregar uno">+</button></div></div>`; }).join('')
        || `<div class="empty">${rows.length ? 'No hay productos con ese nombre.' : 'Todavía no cargaste productos. Podés agregar un ítem libre.'}</div>`;
    }
    /* Ítem libre: algo que no está en el inventario (un servicio, un trabajo, un producto a pedido) con su precio */
    function addCustom() {
      const sh = document.createElement('div'); sh.className = 'sv-sheet';
      sh.innerHTML = `<div class="sv-sheet-box"><div class="sv-r"><h3>Ítem libre</h3><button type="button" class="icon-btn" data-sx aria-label="Cerrar">${icon('close')}</button></div>
        <div class="sv-lab">Descripción</div><input class="sv-in" data-n maxlength="150" placeholder="Ej: Instalación, flete, diseño de logo">
        <div class="sv-r" style="align-items:flex-start;gap:10px"><div style="flex:1"><div class="sv-lab">¿Cuánto vale? (c/u)</div><input class="sv-in" data-pr type="number" min="0" step="any" inputmode="decimal" placeholder="0"></div>
        <div style="width:96px"><div class="sv-lab">Cantidad</div><input class="sv-in" data-qt type="number" min="1" step="1" inputmode="numeric" value="1"></div></div>
        <button type="button" class="btn btn-primary btn-block" data-ok>Agregar al presupuesto</button></div>`;
      ov.appendChild(sh); sh.querySelector('[data-n]').focus();
      sh.querySelector('[data-sx]').onclick = () => sh.remove(); sh.onclick = e => { if (e.target === sh) sh.remove(); };
      sh.querySelector('[data-ok]').onclick = () => {
        const name = sh.querySelector('[data-n]').value.trim(), price = Number(sh.querySelector('[data-pr]').value), qty = Math.max(1, Math.floor(Number(sh.querySelector('[data-qt]').value) || 1));
        if (!name) return toast('Escribí qué es el ítem'); if (!(price >= 0) || sh.querySelector('[data-pr]').value === '') return toast('Indicá cuánto vale');
        const key = `c${++seq}`; S.cart.set(key, { key, pid: null, name, price, qty }); sh.remove(); S.step === 1 ? (drawList(), foot()) : render(); };
    }

    function render() {
      const T = { 1: 'Agregar productos', 2: 'Resumen del presupuesto', 3: 'Datos del presupuesto', 4: 'Presupuesto' };
      $('[data-ttl]').textContent = T[S.step];
      $('[data-back]').innerHTML = S.step > 1 && S.step < 4 ? icon('arrow-left') || '←' : '';
      $('[data-back]').style.visibility = S.step > 1 && S.step < 4 ? '' : 'hidden';
      $('[data-prog]').innerHTML = [1, 2, 3, 4].map(i => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('');
      if (S.step === 1) {
        body.innerHTML = `<input class="sv-in" type="search" data-q placeholder="Buscar producto…" aria-label="Buscar producto" value="${esc(S.q)}"><button type="button" class="btn btn-block" data-custom style="margin-bottom:10px">${icon('plus')}Agregar ítem libre (poné vos el precio)</button><div data-list></div>`;
        const q = body.querySelector('[data-q]'); q.oninput = () => { S.q = q.value; drawList(); };
        body.querySelector('[data-custom]').onclick = addCustom;
        body.querySelector('[data-list]').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.p) setQty(b.dataset.p, 1); if (b.dataset.m) setQty(b.dataset.m, -1); };
        body.onclick = null; body.oninput = null; drawList();
      }
      if (S.step === 2) {
        body.innerHTML = [...S.cart.values()].map(i => `<div class="sv-item col"><div class="sv-r">${thumb(i)}<strong class="sv-nm">${esc(i.name)}</strong><button type="button" class="btn btn-sm btn-danger" data-rm="${i.key}">Quitar</button></div>
          <div class="sv-r"><div class="sv-stp"><button type="button" data-m="${i.key}" aria-label="Quitar uno">−</button><b>${i.qty}</b><button type="button" data-p="${i.key}" aria-label="Agregar uno">+</button></div>
          <label class="sv-price">$<input class="sv-in" type="number" min="0" step="any" inputmode="decimal" value="${i.price}" data-pr="${i.key}" aria-label="Precio unitario"></label></div>
          <small class="muted">${i.qty} × ${ars(i.price)} = <b data-line="${i.key}">${ars(i.qty * i.price)}</b></small></div>`).join('')
          + `<button type="button" class="btn btn-block" data-more>${icon('plus')}Agregar más productos</button><p class="muted sv-hint">Podés cambiar el precio de cada línea: el presupuesto usa el valor que dejes acá.</p>`;
        body.onclick = e => { const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.p) setQty(b.dataset.p, 1); if (b.dataset.m) setQty(b.dataset.m, -1);
          if (b.dataset.rm) { S.cart.delete(b.dataset.rm); S.cart.size ? render() : (S.step = 1, render()); }
          if (b.hasAttribute('data-more')) { S.step = 1; render(); } };
        body.oninput = e => { const k = e.target.dataset.pr; if (!k) return; const it = S.cart.get(k); it.price = Math.max(0, Number(e.target.value) || 0); body.querySelector(`[data-line="${k}"]`).textContent = ars(it.qty * it.price); foot(); };
      }
      if (S.step === 3) {
        const cl = S.client;
        body.innerHTML = `<div class="sv-lab">Descuento (opcional)</div><div class="sv-r"><div class="sv-seg sm"><button type="button" class="${S.dtype === '%' ? 'on' : ''}" data-dt="%">%</button><button type="button" class="${S.dtype === '$' ? 'on' : ''}" data-dt="$">$</button></div>
          <input class="sv-in" type="number" min="0" step="any" inputmode="decimal" placeholder="0" value="${S.dval || ''}" data-dv aria-label="Descuento"></div>
          <div class="sv-lab">Cliente (opcional)</div><button type="button" class="sv-pick" data-cl>${cl ? `<strong>${esc(cl.name)}</strong>${cl.phone ? ` <span class="muted">· ${esc(cl.phone)}</span>` : ''}` : '<span class="muted">Elegir o escribir cliente</span>'}<span>▾</span></button>
          <div class="sv-lab">Validez del presupuesto</div><div class="sv-chips">${VALID.map(([d, l]) => `<button type="button" class="${S.days === d ? 'on' : ''}" data-vd="${d}">${l}</button>`).join('')}</div>
          <div class="sv-lab">Nota en el presupuesto</div><textarea class="sv-in" rows="3" data-nt maxlength="300" placeholder="Ej: Incluye flete. Se paga 50% por adelantado.">${esc(S.note)}</textarea>
          <div class="sv-sum" data-sum></div>`;
        sum();
        body.onclick = e => { const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.dt) { S.dtype = b.dataset.dt; S.dval = 0; render(); }
          if (b.dataset.vd) { S.days = Number(b.dataset.vd); render(); }
          if (b.hasAttribute('data-cl')) pickClient(); };
        body.oninput = e => { const t = e.target; if (t.matches('[data-dv]')) { S.dval = Math.max(0, Number(t.value) || 0); sum(); foot(); } if (t.matches('[data-nt]')) S.note = t.value; };
      }
      if (S.step === 4) { body.onclick = null; body.oninput = null; drawQuote(body, S.quote); }
      foot();
    }
    function sum() { const e = body.querySelector('[data-sum]'); if (e) e.innerHTML = `<div><span>Subtotal</span><span>${ars(sub())}</span></div><div><span>Descuento</span><span>− ${ars(disc())}</span></div><div class="t"><span>Total</span><span>${ars(total())}</span></div>`; }
    function foot() {
      const f = $('[data-foot]');
      if (S.step === 4) { f.innerHTML = `<button type="button" class="btn btn-primary btn-block" data-new>Nuevo presupuesto</button>`; f.querySelector('[data-new]').onclick = () => { ov.remove(); document.removeEventListener('keydown', onKey); Back.release(bh); refresh(); openQuoteFlow(); }; return; }
      const lab = { 1: 'Ver resumen', 2: 'Continuar', 3: 'Crear presupuesto' }[S.step];
      f.innerHTML = `<button type="button" class="sv-go" ${S.cart.size && !S.busy ? '' : 'disabled'}><span>${units()} · ${lab}</span><span>${ars(total())} ›</span></button>`;
      f.querySelector('.sv-go').onclick = () => S.step < 3 ? (S.step++, render(), body.scrollTo(0, 0)) : create();
    }
    async function create() {
      S.busy = true; foot();
      try {
        const cl = S.client;
        S.quote = await api('/quotes', { method: 'POST', body: {
          items: [...S.cart.values()].map(i => ({ name: i.name, qty: i.qty, price: i.price, product_id: i.pid })), discount: disc(),
          client_id: cl && cl.id || null, client_name: cl ? cl.name : '', client_phone: cl ? cl.phone || '' : '', valid_days: S.days, note: S.note.trim() } });
        S.step = 4; S.busy = false; render(); body.scrollTo(0, 0); toast('Presupuesto creado');
      } catch (e) { S.busy = false; foot(); toast(e.message); }
    }
    function pickClient() {
      const sh = document.createElement('div'); sh.className = 'sv-sheet';
      sh.innerHTML = `<div class="sv-sheet-box"><div class="sv-r"><h3>Cliente</h3><button type="button" class="icon-btn" data-sx aria-label="Cerrar">${icon('close')}</button></div>
        <input class="sv-in" type="search" data-sq placeholder="Buscar cliente…"><div class="sv-clist" data-cl></div>
        <div class="sv-lab">O escribilo a mano</div><input class="sv-in" data-nn placeholder="Nombre" maxlength="100"><input class="sv-in" data-np type="tel" inputmode="tel" placeholder="WhatsApp (ej. 351 555 0123) · opcional">
        <button type="button" class="btn btn-primary btn-block" data-add>Usar cliente</button>${S.client ? '<button type="button" class="btn btn-block" data-none style="margin-top:8px">Quitar cliente</button>' : ''}</div>`;
      ov.appendChild(sh);
      const done = c => { S.client = c; sh.remove(); render(); };
      const list = () => { const q = sh.querySelector('[data-sq]').value.trim().toLowerCase();
        sh.querySelector('[data-cl]').innerHTML = clients.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 40).map(c => `<button type="button" class="sv-c" data-id="${c.id}">${esc(c.name)} <span class="muted">${esc(c.phone || '')}</span></button>`).join('') || '<p class="muted">Sin coincidencias.</p>'; };
      list();
      sh.querySelector('[data-sq]').oninput = list;
      sh.querySelector('[data-cl]').onclick = e => { const b = e.target.closest('[data-id]'); if (b) done(clients.find(c => c.id == b.dataset.id)); };
      sh.querySelector('[data-sx]').onclick = () => sh.remove(); sh.onclick = e => { if (e.target === sh) sh.remove(); };
      const none = sh.querySelector('[data-none]'); if (none) none.onclick = () => done(null);
      sh.querySelector('[data-add]').onclick = () => {
        const name = sh.querySelector('[data-nn]').value.trim(), phone = sh.querySelector('[data-np]').value.trim();
        if (!name) return toast('Escribí el nombre del cliente');
        const ex = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
        done(ex ? { ...ex, phone: phone || ex.phone } : { id: null, name, phone }); };
    }
    render();
  }

  /* ---------- ver un presupuesto ya creado: reenviar, cambiar estado, eliminar ---------- */
  async function openQuote(id) {
    let q; try { q = await api('/quotes/' + id); } catch (e) { return toast(e.message); }
    const ov = document.createElement('div'); ov.className = 'sv';
    ov.innerHTML = `<div class="sv-box" role="dialog" aria-modal="true" aria-label="Presupuesto N.º ${q.number}"><header class="sv-head"><span style="width:36px"></span><h2>Presupuesto N.º ${q.number}</h2><button type="button" class="icon-btn" data-x aria-label="Cerrar">${icon('close')}</button></header>
      <div class="sv-body" data-body></div><div class="sv-foot"><div class="sv-lab" style="margin-top:0">Estado</div><div class="sv-chips" data-st></div><button type="button" class="btn btn-block btn-danger" data-del style="margin-top:10px">Eliminar presupuesto</button></div></div>`;
    document.body.appendChild(ov);
    const onKey = e => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', onKey);
    const bh = Back.open({ onBack: () => { close(); } });
    let changed = false;
    const close = () => { document.removeEventListener('keydown', onKey); Back.release(bh); ov.remove(); if (changed) refresh(); };
    ov.querySelector('[data-x]').onclick = close;
    drawQuote(ov.querySelector('[data-body]'), q);
    const chips = () => { ov.querySelector('[data-st]').innerHTML = Object.entries(ST).map(([k, l]) => `<button type="button" class="${q.status === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join(''); };
    chips();
    ov.querySelector('[data-st]').onclick = async e => { const b = e.target.closest('[data-s]'); if (!b || b.dataset.s === q.status) return;
      try { await api(`/quotes/${q.id}/status`, { method: 'PUT', body: { status: b.dataset.s } }); q.status = b.dataset.s; changed = true; chips(); toast('Estado: ' + ST[q.status]); } catch (err) { toast(err.message); } };
    ov.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`¿Eliminar el presupuesto N.º ${q.number}? No se puede deshacer.`)) return;
      try { await api('/quotes/' + q.id, { method: 'DELETE' }); changed = true; close(); toast('Presupuesto eliminado'); } catch (err) { toast(err.message); } };
  }

  /* ---------- lista ---------- */
  VIEWS.presupuestos = async function (el) {
    const qs = await api('/quotes'), pend = qs.filter(q => q.status === 'pendiente' && !q.expired);
    el.innerHTML = head('Presupuestos', qs.length ? `${qs.length} en total · ${pend.length} pendientes por ${ars(pend.reduce((s, q) => s + q.total, 0))}` : 'Armá un presupuesto y mandáselo al cliente por WhatsApp.',
      `<button class="btn btn-primary" data-new>${icon('plus')}Nuevo presupuesto</button>`) + `
      <div class="card q-list">${qs.length ? `<ul>${qs.map(q => `<li class="q-row" data-id="${q.id}" tabindex="0" role="button" aria-label="Abrir presupuesto ${q.number}">
        <div class="q-main"><div class="q-top"><strong>N.º ${q.number} · ${esc(q.client_name || 'Sin cliente')}</strong><b>${ars(q.total)}</b></div>
        <div class="q-sub"><span>${dmy(q.created_at)} · ${q.n_items} ${q.n_items === 1 ? 'ítem' : 'ítems'}${q.valid_until ? ` · vence ${dmy(q.valid_until)}` : ''}</span>
        <span class="q-st ${q.expired ? 'exp' : q.status}">${q.expired ? 'Vencido' : ST[q.status]}</span></div></div></li>`).join('')}</ul>` : '<div class="empty">Todavía no hiciste ningún presupuesto. Tocá «Nuevo presupuesto»: elegís los productos, ponés cuánto vale y se lo mandás al cliente.</div>'}</div>`;
    el.querySelector('[data-new]').onclick = openQuoteFlow;
    el.querySelectorAll('.q-row').forEach(r => { const open = () => openQuote(r.dataset.id); r.onclick = open; r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }; });
  };
  window.openQuoteFlow = openQuoteFlow;
})();
