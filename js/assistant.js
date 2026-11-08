/* Asistente IA (Gemini): chat para cargar productos, controlar stock y consultar el negocio. Usa api(), esc(), icon(), toast(), openModal(), imgToData() */
const AI_SUGGEST = [
  'Agregá 20 remeras negras a $15000',
  '¿Qué productos tengo con stock bajo?',
  '¿Cuánto vendí este mes y qué fue lo más vendido?',
  '¿Quién me debe plata?'
];

function aiFmt(text) {
  const lines = esc(text).split('\n'), out = []; let list = false;
  for (const raw of lines) {
    const b = raw.match(/^\s*(?:[-*•])\s+(.*)$/), html = (b ? b[1] : raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (b) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${html}</li>`); }
    else { if (list) { out.push('</ul>'); list = false; } out.push(html.trim() ? `<p>${html}</p>` : ''); }
  }
  if (list) out.push('</ul>');
  return out.join('');
}

const AI_IMG_OK = f => /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);
/* Achica la foto en el celular antes de subirla (la IA y el catálogo no necesitan 12 megapíxeles): decodifica una sola vez y prueba tamaños hasta que pese poco */
async function aiPrepareImage(file) {
  let bmp = null;
  if (window.createImageBitmap) { try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cae al método clásico */ } }
  try {
    for (const [max, q] of [[1024, .78], [900, .7], [760, .62], [600, .55]]) {
      let d;
      if (bmp) {
        const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
        d = c.toDataURL('image/jpeg', q);
      } else d = await imgToData(file, max, 'image/jpeg', q);
      if (d.length <= 330000) return d;
    }
  } catch (err) {
    if (/heic|heif/i.test(file.type + file.name)) throw new Error('Esa foto está en formato HEIC y el navegador no la lee. Sacala en JPG o mandá una captura.');
    throw err;
  } finally { bmp && bmp.close && bmp.close(); }
  throw new Error('Esa foto es demasiado pesada. Probá con otra.');
}

function openAiKeysModal(onChange) {
  api('/ai/status').then(st => {
    const { form, close } = openModal({ title: 'Claves de IA', submit: 'Agregar mi clave', wide: true,
      html: `<p class="hint ai-keys-info">Claves del sistema disponibles: <strong>${st.server_available} de ${st.server_total}</strong>. Cuando se agoten todas, el asistente usa tus propias claves.
        Conseguí una gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>.</p>
        ${st.own_keys.length ? `<ul class="ai-keys">${st.own_keys.map(k => `<li><span>${icon('key', 16)}<code>${esc(k.masked)}</code>${k.label ? ` · ${esc(k.label)}` : ''}${k.cooling ? ' <em>(en espera por cuota)</em>' : ''}</span><button type="button" class="btn btn-sm" data-del="${k.id}" aria-label="Quitar clave">${icon('trash', 14)}</button></li>`).join('')}</ul>` : '<div class="empty">Todavía no cargaste claves propias.</div>'}
        ${fld('Clave de Gemini', '<input id="aik" autocomplete="off" spellcheck="false" placeholder="Pegá tu clave (AIza… o AQ.…)" required>', 'aik')}
        ${fld('Nombre (opcional)', '<input id="ail" maxlength="40" placeholder="Ej: Mi cuenta">', 'ail')}`,
      onSubmit: async (f, close) => {
        await api('/ai/keys', { method: 'POST', body: { key: f.querySelector('#aik').value.trim(), label: f.querySelector('#ail').value.trim() } });
        close(); toast('Clave agregada'); onChange && onChange();
      } });
    form.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await api(`/ai/keys/${b.dataset.del}`, { method: 'DELETE' }); close(); toast('Clave eliminada'); onChange && onChange();
    });
  }).catch(e => toast(e.message));
}

VIEWS.asistente = async function (el) {
  const [hist, st] = await Promise.all([api('/ai/history'), api('/ai/status')]);
  let images = [], pending = 0, busy = false, ready = st.ready;
  el.innerHTML = `<header class="page-head ai-head"><div><h1>Asistente IA</h1><p class="ai-page-sub">Pedile que cargue productos, controle el stock o te cuente cómo viene el negocio. Podés mandarle fotos.</p></div>
      <div class="toolbar"><button class="btn" data-keys aria-label="Claves de IA">${icon('key')}<span class="lbl">Claves de IA</span></button><button class="btn" data-clear aria-label="Nueva charla">${icon('trash')}<span class="lbl">Nueva charla</span></button></div></header>
    <div class="card ai-wrap">
      <div class="ai-banner ${ready ? 'hidden' : ''}" data-banner role="status"><span>${icon('alert', 18)} Se agotó la cuota de IA del sistema.</span><button class="btn btn-sm btn-primary" data-keys>Agregar mi clave</button></div>
      <div class="ai-msgs" data-msgs aria-live="polite"></div>
      <div class="ai-previews hidden" data-prev></div>
      <form class="ai-composer" data-form>
        <input type="file" id="ai-file" accept="image/*" multiple class="sr-only" data-file tabindex="-1">
        <label for="ai-file" class="icon-btn ai-attach" role="button" aria-label="Adjuntar fotos" title="Adjuntar fotos">${icon('clip', 22)}</label>
        <textarea rows="1" data-text placeholder="Escribí o adjuntá una foto…" maxlength="4000" aria-label="Mensaje" enterkeyhint="send"></textarea>
        <button class="btn btn-primary" data-send aria-label="Enviar">${icon('send', 18)}</button>
      </form>
    </div>`;
  // Se capturan ahora: al terminar, la app mueve estos nodos fuera de `el`, y después ya no se los encuentra con el.querySelector
  const $ = s => el.querySelector(s), msgs = $('[data-msgs]'), ta = $('[data-text]'), prev = $('[data-prev]'), wrap = $('.ai-wrap'),
    sendBtn = $('[data-send]'), banner = $('[data-banner]'), fileIn = $('[data-file]'), clearBtn = $('[data-clear]'), form = $('[data-form]');
  const keyBtns = [...el.querySelectorAll('[data-keys]')];
  const toBottom = () => { msgs.scrollTop = msgs.scrollHeight; };
  const updateSend = () => { sendBtn.disabled = busy || pending > 0; };
  const chips = acts => (acts || []).length ? `<div class="ai-chips">${acts.map(a => `<span class="ai-chip ${a.ok ? 'ok' : 'bad'}">${icon(a.ok ? 'check' : 'alert', 14)}${esc(a.text)}</span>`).join('')}</div>` : '';
  const mk = (role, html, extra = '', cls = '') => { const d = document.createElement('div'); d.className = `ai-msg ${role} ${cls}`; d.innerHTML = `<div class="ai-bubble">${html}</div>${extra}`; return d; };
  const bubble = (...a) => { const d = mk(...a); msgs.appendChild(d); toBottom(); return d; };
  const welcome = () => { msgs.innerHTML = `<div class="ai-empty"><div class="ai-orb">${icon('spark', 28)}</div><h2>¿Qué hacemos hoy?</h2><p>Escribime o mandame una foto del producto.</p>\n    <div class="ai-suggest">${AI_SUGGEST.map(t => `<button type="button" class="btn btn-sm" data-sg>${esc(t)}</button>`).join('')}</div></div>`;
    msgs.querySelectorAll('[data-sg]').forEach(b => b.onclick = () => { ta.value = b.textContent; send(); }); };

  if (hist.length) {                                   // se arma todo junto y se baja una sola vez (menos trabajo para el celular)
    const frag = document.createDocumentFragment();
    hist.forEach(m => frag.appendChild(mk(m.role === 'user' ? 'user' : 'bot', m.role === 'user' ? `<p>${esc(m.content).replace(/\n/g, '<br>')}</p>` : aiFmt(m.content), m.role === 'model' ? chips(m.actions) : '')));
    msgs.appendChild(frag);
  } else welcome();
  toBottom();

  const drawPrev = () => {
    prev.classList.toggle('hidden', !images.length && !pending);
    prev.innerHTML = images.map((d, i) => `<div class="ai-thumb"><img src="${d}" alt="Foto ${i + 1}"><button type="button" data-rm="${i}" aria-label="Quitar foto">${icon('close', 12)}</button></div>`).join('')
      + '<div class="ai-thumb load" aria-label="Preparando foto"><i></i></div>'.repeat(pending);
    prev.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { images.splice(+b.dataset.rm, 1); drawPrev(); });
  };
  async function addFiles(list) {
    const all = [...list], valid = all.filter(AI_IMG_OK), room = Math.max(0, 5 - images.length - pending), files = valid.slice(0, room);
    if (!valid.length) return toast('Elegí una imagen (JPG, PNG o WebP).');
    if (files.length < valid.length) toast('Máximo 5 fotos por mensaje');
    if (!files.length) return;
    pending += files.length; drawPrev(); updateSend();
    for (const f of files) {
      try { images.push(await aiPrepareImage(f)); } catch (err) { toast(err.message); }
      pending--; drawPrev(); updateSend();
    }
  }
  fileIn.onchange = e => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs); };
  ta.onpaste = e => { const fs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); addFiles(fs); } };
  wrap.ondragover = e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  wrap.ondrop = e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  const openKeys = () => openAiKeysModal(() => { state.view === 'asistente' && go('asistente'); });
  keyBtns.forEach(b => b.onclick = openKeys);
  clearBtn.onclick = async () => { if (busy) return; await api('/ai/history', { method: 'DELETE' }); welcome(); };
  form.onsubmit = e => { e.preventDefault(); send(); };

  async function send() {
    const text = ta.value.trim(), imgs = images.slice();
    if (busy || pending || (!text && !imgs.length)) return;
    busy = true; updateSend();
    msgs.querySelector('.ai-empty')?.remove();
    bubble('user', (text ? `<p>${esc(text).replace(/\n/g, '<br>')}</p>` : '') + (imgs.length ? `<div class="ai-sent">${imgs.map(d => `<img src="${d}" alt="">`).join('')}</div>` : ''));
    ta.value = ''; ta.style.height = 'auto'; images = []; drawPrev();
    const typing = bubble('bot', imgs.length ? `<span class="ai-dots"><i></i><i></i><i></i></span> <small class="ai-wait">Mirando ${imgs.length > 1 ? 'las fotos' : 'la foto'}…</small>` : '<span class="ai-dots"><i></i><i></i><i></i></span>', '', 'typing');
    try {
      const r = await api('/ai/chat', { method: 'POST', body: { message: text, images: imgs }, timeout: 100000 });
      typing.remove();
      bubble('bot', aiFmt(r.reply), chips(r.actions), r.code ? 'warn' : '');
      if (r.code === 'no_keys') { ready = false; banner.classList.remove('hidden'); }
    } catch (err) {
      typing.remove();
      if (err.status === 401) return logout();
      bubble('bot', `<p>${esc(err.message)}</p>`, '', 'warn');
      if (!err.status || err.status >= 500) { ta.value = text; images = imgs; drawPrev(); ta.oninput(); }     // no se pierde lo escrito ni las fotos: se puede reintentar
    }
    busy = false; updateSend(); ta.focus({ preventScroll: true });
  }
};
