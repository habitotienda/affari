/* Nueva venta: productos → resumen → pago → comprobante compartible.
   Reemplaza al modal simple de venta (los gastos siguen usando el de views.js). Usa api(), esc(), ars(), icon(), toast(), refresh(), state, waNum(). */
(() => {
  const legacy = openSaleModal;
  openSaleModal = (kind = 'entrada') => kind === 'entrada' ? openSaleFlow() : legacy(kind);

  const PAY = ['Efectivo', 'Transferencia', 'Tarjeta'];
  const n2 = n => Math.round((Number(n) || 0) * 100) / 100;

  async function openSaleFlow() {
    let products, clients;
    try { [products, clients] = await Promise.all([api('/products'), api('/clients')]); } catch (e) { return toast(e.message); }
    const rows = [];
    products.filter(p => p.active && p.stock > 0).forEach(p => {
      if (p.variants && p.variants.length) p.variants.filter(v => v.stock > 0).forEach(v => rows.push({ key: `${p.id}:${v.id}`, pid: p.id, vid: v.id, name: `${p.name} · ${v.name}`, price: v.price || p.price, stock: v.stock, img: p.images && p.images[0] }));
      else rows.push({ key: `${p.id}:0`, pid: p.id, vid: null, name: p.name, price: p.price, stock: p.stock, img: p.images && p.images[0] });
    });
    const S = { step: 1, q: '', cart: new Map(), paid: true, method: 'Efectivo', dtype: '%', dval: 0, client: null, concept: '', note: '', receipt: null, busy: false };
    const sub = () => [...S.cart.values()].reduce((a, i) => a + i.qty * i.price, 0);
    const disc = () => n2(Math.min(sub(), S.dtype === '%' ? sub() * Math.min(S.dval, 100) / 100 : S.dval));
    const total = () => n2(sub() - disc());
    const units = () => [...S.cart.values()].reduce((a, i) => a + i.qty, 0);

    const ov = document.createElement('div'); ov.className = 'sf';
    ov.innerHTML = `<div class="sf-box" role="dialog" aria-modal="true" aria-label="Nueva venta"><header class="sf-head"><button type="button" class="icon-btn" data-back aria-label="Volver"></button><h2 data-ttl></h2><button type="button" class="icon-btn" data-x aria-label="Cerrar">${icon('close')}</button></header>
      <div class="sf-prog" data-prog></div><div class="sf-body" data-body></div><div class="sf-foot" data-foot></div></div>`;
    document.body.appendChild(ov);
    const $ = s => ov.querySelector(s), body = $('[data-body]');
    const onKey = e => { if (e.key === 'Escape' && !ov.querySelector('.sf-sheet')) close(); };
    document.addEventListener('keydown', onKey);
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); if (S.receipt) refresh(); };
    $('[data-x]').onclick = close;
    $('[data-back]').onclick = () => { if (S.step > 1 && S.step < 4) { S.step--; render(); } else close(); };

    const setQty = (key, d) => {
      const r = rows.find(x => x.key === key); if (!r) return; let it = S.cart.get(key);
      if (!it) { if (d > 0) S.cart.set(key, { ...r, qty: 1 }); }
      else { it.qty = Math.max(0, Math.min(r.stock, it.qty + d)); if (!it.qty) S.cart.delete(key); }
      if (S.step === 1) { drawList(); foot(); } else render();
    };

    function drawList() {
      const q = S.q.trim().toLowerCase(), list = body.querySelector('[data-list]'); if (!list) return;
      const r = rows.filter(x => !q || x.name.toLowerCase().includes(q));
      list.innerHTML = r.map(x => { const it = S.cart.get(x.key);
        return `<div class="sf-item ${it ? 'sel' : ''}"><div class="sf-th">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : esc((x.name[0] || '?').toUpperCase())}</div>
        <div class="sf-info"><strong>${esc(x.name)}</strong><span class="sf-tag">${x.stock} disponibles</span><b>${ars(x.price)}</b></div>
        <div class="sf-stp"><button type="button" data-m="${x.key}" aria-label="Quitar uno">−</button><b>${it ? it.qty : 0}</b><button type="button" data-p="${x.key}" aria-label="Agregar uno">+</button></div></div>`; }).join('')
        || `<div class="empty">${rows.length ? 'No hay productos con ese nombre.' : 'No tenés productos con stock. Cargalos en Inventario.'}</div>`;
    }

    function render() {
      const T = { 1: 'Agregar productos', 2: 'Resumen de la venta', 3: 'Datos del pago', 4: 'Comprobante' };
      $('[data-ttl]').textContent = T[S.step];
      $('[data-back]').innerHTML = S.step > 1 && S.step < 4 ? icon('arrow-left') || '←' : '';
      $('[data-back]').style.visibility = S.step > 1 && S.step < 4 ? '' : 'hidden';
      $('[data-prog]').innerHTML = [1, 2, 3, 4].map(i => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('');
      if (S.step === 1) {
        body.innerHTML = `<input class="sf-in" type="search" data-q placeholder="Buscar producto…" aria-label="Buscar producto" value="${esc(S.q)}"><div data-list></div>`;
        const q = body.querySelector('[data-q]'); q.oninput = () => { S.q = q.value; drawList(); };
        body.querySelector('[data-list]').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.p) setQty(b.dataset.p, 1); if (b.dataset.m) setQty(b.dataset.m, -1); };
        drawList();
      }
      if (S.step === 2) {
        body.innerHTML = [...S.cart.values()].map(i => `<div class="sf-item col"><div class="sf-r"><strong>${esc(i.name)}</strong><button type="button" class="btn btn-sm btn-danger" data-rm="${i.key}">Quitar</button></div>
          <div class="sf-r"><div class="sf-stp"><button type="button" data-m="${i.key}" aria-label="Quitar uno">−</button><b>${i.qty}</b><button type="button" data-p="${i.key}" aria-label="Agregar uno">+</button></div>
          <label class="sf-price">$<input class="sf-in" type="number" min="0" step="any" inputmode="decimal" value="${i.price}" data-pr="${i.key}" aria-label="Precio unitario"></label></div>
          <small class="muted">${i.qty} × ${ars(i.price)} = <b data-line="${i.key}">${ars(i.qty * i.price)}</b></small></div>`).join('')
          + `<button type="button" class="btn btn-block" data-more>${icon('plus')}Agregar más productos</button><p class="muted sf-hint">Al crear la venta se descuentan las unidades de tu inventario.</p>`;
        body.onclick = e => { const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.p) setQty(b.dataset.p, 1); if (b.dataset.m) setQty(b.dataset.m, -1);
          if (b.dataset.rm) { S.cart.delete(b.dataset.rm); S.cart.size ? render() : (S.step = 1, render()); }
          if (b.hasAttribute('data-more')) { S.step = 1; render(); } };
        body.oninput = e => { const k = e.target.dataset.pr; if (!k) return; const it = S.cart.get(k); it.price = Math.max(0, Number(e.target.value) || 0); body.querySelector(`[data-line="${k}"]`).textContent = ars(it.qty * it.price); foot(); };
      }
      if (S.step === 3) {
        const cl = S.client;
        body.innerHTML = `<div class="sf-seg"><button type="button" class="${S.paid ? 'on' : ''}" data-paid="1">Pagado</button><button type="button" class="${S.paid ? '' : 'on'}" data-paid="0">Deuda (fiado)</button></div>
          ${S.paid ? `<div class="sf-lab">Forma de pago</div><div class="sf-chips">${PAY.map(m => `<button type="button" class="${S.method === m ? 'on' : ''}" data-m="${m}">${m}</button>`).join('')}</div>` : '<p class="muted sf-hint">Queda anotada como deuda del cliente y no entra a caja hasta que cobres.</p>'}
          <div class="sf-lab">Descuento</div><div class="sf-r"><div class="sf-seg sm"><button type="button" class="${S.dtype === '%' ? 'on' : ''}" data-dt="%">%</button><button type="button" class="${S.dtype === '$' ? 'on' : ''}" data-dt="$">$</button></div>
          <input class="sf-in" type="number" min="0" step="any" inputmode="decimal" placeholder="0" value="${S.dval || ''}" data-dv aria-label="Descuento"></div>
          <div class="sf-lab">Cliente${S.paid ? ' (opcional)' : ''}</div><button type="button" class="sf-pick" data-cl>${cl ? `<strong>${esc(cl.name)}</strong>${cl.phone ? ` <span class="muted">· ${esc(cl.phone)}</span>` : ''}` : '<span class="muted">Elegir o agregar cliente</span>'}<span>▾</span></button>
          <div class="sf-lab">Concepto</div><input class="sf-in" data-cc maxlength="120" placeholder="Dale un nombre a tu venta" value="${esc(S.concept)}">
          <div class="sf-lab">Nota en el comprobante</div><textarea class="sf-in" rows="3" data-nt maxlength="300" placeholder="Agregar nota…">${esc(S.note)}</textarea>
          <div class="sf-sum" data-sum></div>`;
        sum();
        body.onclick = e => { const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.paid) { S.paid = b.dataset.paid === '1'; render(); }
          if (b.dataset.m) { S.method = b.dataset.m; render(); }
          if (b.dataset.dt) { S.dtype = b.dataset.dt; S.dval = 0; render(); }
          if (b.hasAttribute('data-cl')) pickClient(); };
        body.oninput = e => { const t = e.target;
          if (t.matches('[data-dv]')) { S.dval = Math.max(0, Number(t.value) || 0); sum(); foot(); }
          if (t.matches('[data-cc]')) S.concept = t.value; if (t.matches('[data-nt]')) S.note = t.value; };
      }
      if (S.step === 4) drawReceipt();
      foot();
    }
    function sum() { const e = body.querySelector('[data-sum]'); if (e) e.innerHTML = `<div><span>Subtotal</span><span>${ars(sub())}</span></div><div><span>Descuento</span><span>− ${ars(disc())}</span></div><div class="t"><span>Total</span><span>${ars(total())}</span></div>`; }
    function foot() {
      const f = $('[data-foot]');
      if (S.step === 4) { f.innerHTML = `<button type="button" class="btn btn-primary btn-block" data-new>Nueva venta</button>`; f.querySelector('[data-new]').onclick = () => { ov.remove(); document.removeEventListener('keydown', onKey); refresh(); openSaleFlow(); }; return; }
      const lab = { 1: 'Ver resumen', 2: 'Continuar al pago', 3: S.paid ? 'Crear venta' : 'Anotar deuda' }[S.step];
      f.innerHTML = `<button type="button" class="sf-go" ${S.cart.size && !S.busy ? '' : 'disabled'}><span>${units()} · ${lab}</span><span>${ars(total())} ›</span></button>`;
      f.querySelector('.sf-go').onclick = () => S.step < 3 ? (S.step++, render(), body.scrollTo(0, 0)) : create();
    }

    async function create() {
      if (!S.paid && !S.client) { toast('Elegí un cliente para anotar la deuda'); return pickClient(); }
      S.busy = true; foot();
      try {
        const cl = S.client, r = await api('/sales/cart', { method: 'POST', body: {
          items: [...S.cart.values()].map(i => ({ product_id: i.pid, variant_id: i.vid, qty: i.qty, price: i.price })), method: S.method, paid: S.paid, discount: disc(),
          client_id: cl && cl.id || null, client_name: cl && !cl.id ? cl.name : '', client_phone: cl ? cl.phone || '' : '', concept: S.concept.trim(), note: S.note.trim() } });
        const d = new Date();
        S.receipt = { number: r.number, date: d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          business: state.user.business, seller: state.user.name, client: r.client, concept: S.concept.trim(), note: S.note.trim(), items: r.items, subtotal: r.subtotal, discount: r.discount, total: r.total, paid: S.paid, method: S.method };
        S.step = 4; S.busy = false; render(); body.scrollTo(0, 0); toast('Venta registrada');
      } catch (e) { S.busy = false; foot(); toast(e.message); }
    }

    /* ---- selector de cliente ---- */
    function pickClient() {
      const sh = document.createElement('div'); sh.className = 'sf-sheet';
      sh.innerHTML = `<div class="sf-sheet-box"><div class="sf-r"><h3>Cliente</h3><button type="button" class="icon-btn" data-sx aria-label="Cerrar">${icon('close')}</button></div>
        <input class="sf-in" type="search" data-sq placeholder="Buscar cliente…"><div class="sf-clist" data-cl></div>
        <div class="sf-lab">Agregar manualmente</div><input class="sf-in" data-nn placeholder="Nombre" maxlength="100"><input class="sf-in" data-np type="tel" inputmode="tel" placeholder="WhatsApp (ej. 351 555 0123)${S.paid ? ' · opcional' : ''}" style="margin-top:8px">
        <div class="sf-r" style="margin-top:10px"><button type="button" class="btn" data-imp style="flex:1">Importar de contactos</button><button type="button" class="btn btn-primary" data-add style="flex:1">Usar cliente</button></div>
        ${S.client ? '<button type="button" class="btn btn-block" data-none>Quitar cliente</button>' : ''}</div>`;
      ov.appendChild(sh);
      const done = c => { S.client = c; sh.remove(); render(); };
      const list = () => { const q = sh.querySelector('[data-sq]').value.trim().toLowerCase();
        sh.querySelector('[data-cl]').innerHTML = clients.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 40).map(c => `<button type="button" class="sf-c" data-id="${c.id}">${esc(c.name)} <span class="muted">${esc(c.phone || '')}</span>${c.balance > 0 ? ` <span class="sf-debt">debe ${ars(c.balance)}</span>` : ''}</button>`).join('') || '<p class="muted">Sin coincidencias.</p>'; };
      list();
      sh.querySelector('[data-sq]').oninput = list;
      sh.querySelector('[data-cl]').onclick = e => { const b = e.target.closest('[data-id]'); if (b) done(clients.find(c => c.id == b.dataset.id)); };
      sh.querySelector('[data-sx]').onclick = () => sh.remove();
      sh.onclick = e => { if (e.target === sh) sh.remove(); };
      const none = sh.querySelector('[data-none]'); if (none) none.onclick = () => done(null);
      sh.querySelector('[data-add]').onclick = () => {
        const name = sh.querySelector('[data-nn]').value.trim(), phone = sh.querySelector('[data-np]').value.trim();
        if (!name) return toast('Escribí el nombre del cliente');
        const ex = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
        done(ex ? { ...ex, phone: phone || ex.phone } : { id: null, name, phone });
      };
      sh.querySelector('[data-imp]').onclick = async () => {
        try { if (!navigator.contacts || !navigator.contacts.select) throw 0;
          const r = await navigator.contacts.select(['name', 'tel'], { multiple: false });
          if (r.length) { sh.querySelector('[data-nn]').value = (r[0].name || [''])[0] || ''; sh.querySelector('[data-np]').value = (r[0].tel || [''])[0] || ''; }
        } catch { toast('Tu navegador no abre la agenda. Cargá el nombre y el número a mano o copialos desde WhatsApp.'); } };
    }

    /* ---- comprobante ---- */
    function drawReceipt() {
      const r = S.receipt;
      body.innerHTML = `<div class="sf-rc"><img data-img alt="Comprobante N.º ${r.number}"></div>
        <p class="muted sf-hint">Compartilo como imagen por WhatsApp o guardalo en tu teléfono.</p>
        <div class="sf-acts"><button type="button" class="btn btn-primary" data-share>Compartir</button><button type="button" class="btn btn-wa" data-wa>WhatsApp</button><button type="button" class="btn" data-dl>${icon('download', 16)}Guardar</button></div>`;
      const cv = receiptCanvas(r); body.querySelector('[data-img]').src = cv.toDataURL('image/png');
      const blob = () => new Promise(ok => cv.toBlob(ok, 'image/png')), fname = `comprobante-${r.number}.png`, text = receiptText(r);
      body.querySelector('[data-dl]').onclick = async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(await blob()); a.download = fname; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
      body.querySelector('[data-share]').onclick = async () => {
        const f = new File([await blob()], fname, { type: 'image/png' });
        try { if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: `Comprobante ${r.number}`, text: `${r.business} · Total ${ars(r.total)}` }); else if (navigator.share) await navigator.share({ title: `Comprobante ${r.number}`, text }); else body.querySelector('[data-dl]').click(); } catch {} };
      body.querySelector('[data-wa]').onclick = () => { const ph = r.client && r.client.phone ? waNum(r.client.phone) : ''; window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); };
    }
    const receiptText = r => `*${r.business}* · Comprobante N.º ${r.number}\n${r.date}\n${r.client ? 'Cliente: ' + r.client.name + '\n' : ''}${r.concept ? r.concept + '\n' : ''}\n` + r.items.map(i => `• ${i.qty} × ${i.name} — ${ars(i.qty * i.unit)}`).join('\n')
      + `\n\nSubtotal: ${ars(r.subtotal)}${r.discount ? '\nDescuento: − ' + ars(r.discount) : ''}\n*Total: ${ars(r.total)}*\n${r.paid ? 'Pagado con ' + r.method : 'Pendiente de pago'}${r.note ? '\n\n' + r.note : ''}\n\n¡Gracias por tu compra!`;

    render();
  }

  /* Dibuja el comprobante en un canvas (imagen PNG lista para compartir) */
  function receiptCanvas(r) {
    const W = 760, P = 56, F = '"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', INK = '#0F172A', MUT = '#64748B', G = '#059669', LINE = '#CBD5E1';
    const m = document.createElement('canvas').getContext('2d');
    const wrap = (t, font, max) => { m.font = font; const out = []; String(t).split('\n').forEach(par => { let line = ''; par.split(' ').forEach(w => { const x = line ? line + ' ' + w : w; if (m.measureText(x).width > max && line) { out.push(line); line = w; } else line = x; }); out.push(line); }); return out; };
    const meta = [['Cliente', r.client ? r.client.name : 'Consumidor final'], ['Fecha', r.date], ['Vendedor', r.seller], [r.paid ? 'Pago' : 'Estado', r.paid ? r.method : 'Pendiente de pago']];
    const itemLines = r.items.map(i => ({ l: wrap(`${i.qty} × ${i.name}`, `600 26px ${F}`, W - 2 * P - 190), amt: ars(i.qty * i.unit) }));
    const noteLines = r.note ? wrap(r.note, `500 24px ${F}`, W - 2 * P) : [];
    const conceptLines = r.concept ? wrap(r.concept, `700 28px ${F}`, W - 2 * P) : [];
    const H = 150 + 200 + conceptLines.length * 38 + 30 + meta.length * 46 + 40 + itemLines.reduce((a, i) => a + i.l.length * 36 + 14, 0) + 40 + (r.discount ? 100 : 60) + 90 + (noteLines.length ? 70 + noteLines.length * 34 : 0) + 110;
    const cv = document.createElement('canvas'), s = 2; cv.width = W * s; cv.height = Math.round(H) * s; const x = cv.getContext('2d'); x.scale(s, s);
    x.fillStyle = '#ECFDF5'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.fillRect(24, 24, W - 48, H - 48);
    x.fillStyle = G; x.fillRect(24, 24, W - 48, 14);
    let y = 110; x.textBaseline = 'alphabetic';
    x.fillStyle = INK; x.font = `800 40px ${F}`; x.fillText(r.business.slice(0, 28), P, y);
    x.fillStyle = MUT; x.font = `600 24px ${F}`; y += 40; x.fillText(`Comprobante N.º ${r.number}`, P, y);
    const tag = r.paid ? 'PAGADO' : 'DEUDA', col = r.paid ? G : '#BE123C'; x.font = `800 26px ${F}`; const tw = x.measureText(tag).width + 36;
    x.save(); x.translate(W - P - tw / 2, 92); x.rotate(.1); x.strokeStyle = col; x.lineWidth = 4; x.strokeRect(-tw / 2, -28, tw, 52); x.fillStyle = col; x.textAlign = 'center'; x.fillText(tag, 0, 8); x.restore(); x.textAlign = 'left';
    y += 44; dash(); y += 50;
    x.fillStyle = MUT; x.font = `600 24px ${F}`; x.fillText('Total', P, y); y += 70; x.fillStyle = INK; x.font = `800 68px ${F}`; x.fillText(ars(r.total), P, y);
    y += 20; conceptLines.forEach(t => { y += 38; x.font = `700 28px ${F}`; x.fillStyle = INK; x.fillText(t, P, y); });
    y += 34; dash(); y += 44;
    meta.forEach(([k, v]) => { x.font = `500 24px ${F}`; x.fillStyle = MUT; x.fillText(k, P, y); x.font = `700 24px ${F}`; x.fillStyle = INK; x.textAlign = 'right'; x.fillText(String(v).slice(0, 34), W - P, y); x.textAlign = 'left'; y += 46; });
    y -= 6; dash(); y += 46;
    itemLines.forEach(i => { i.l.forEach((t, k) => { x.font = `600 26px ${F}`; x.fillStyle = INK; x.fillText(t, P, y); if (!k) { x.font = `700 26px ${F}`; x.textAlign = 'right'; x.fillText(i.amt, W - P, y); x.textAlign = 'left'; } y += 36; }); y += 14; });
    y -= 4; dash(); y += 46;
    const row = (k, v, big) => { x.font = `${big ? 800 : 500} ${big ? 32 : 24}px ${F}`; x.fillStyle = big ? INK : MUT; x.fillText(k, P, y); x.fillStyle = INK; x.textAlign = 'right'; x.fillText(v, W - P, y); x.textAlign = 'left'; y += big ? 0 : 42; };
    if (r.discount) { row('Subtotal', ars(r.subtotal)); row('Descuento', '− ' + ars(r.discount)); y += 6; }
    row('Total', ars(r.total), true); y += 40;
    if (noteLines.length) { dash(); y += 44; x.font = `600 22px ${F}`; x.fillStyle = MUT; x.fillText('Nota', P, y); noteLines.forEach(t => { y += 34; x.font = `500 24px ${F}`; x.fillStyle = INK; x.fillText(t, P, y); }); y += 30; }
    x.fillStyle = G; x.font = `700 24px ${F}`; x.textAlign = 'center'; x.fillText('¡Gracias por tu compra!', W / 2, y + 40);
    function dash() { x.strokeStyle = LINE; x.lineWidth = 2; x.setLineDash([10, 8]); x.beginPath(); x.moveTo(P, y); x.lineTo(W - P, y); x.stroke(); x.setLineDash([]); }
    return cv;
  }
})();
