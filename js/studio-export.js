/* ==========================================================================
   Affari · Estudio de Diseño — FASE 3 · exportar a imagen
   Botón «Exportar» de la barra superior → ventana con vista previa, formato (PNG / JPG),
   tamaño, nombre de archivo, Descargar y Compartir (hoja de compartir del celular: WhatsApp,
   Instagram, «Guardar imagen»…).
   La imagen sale siempre a resolución real (1080 px, etc.) sin importar el zoom de pantalla.
   ========================================================================== */
(() => {
  'use strict';
  const Studio = window.Studio; if (!Studio) return;

  const SIZES = [
    { id: 'lite', label: 'Liviana', scale: 0.5 },
    { id: 'std',  label: 'Original', scale: 1 },
    { id: 'hi',   label: 'Alta (x2)', scale: 2 },
  ];
  const MAX_SIDE = 4096;                    // límite seguro de canvas en celulares
  const FORMATS = { png: { mime: 'image/png', ext: 'png', label: 'PNG' }, jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' } };

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const safeName = (s) => (s || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, '-').slice(0, 80);
  const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; };

  Studio.use((api) => {
    const fc = api.canvas();
    const X = { open: false, fmt: 'png', size: 'std', blob: null, url: '', gen: 0, root: null, name: '', dead: false };

    /* ----------------------------------------------------------- render real */
    function toCanvas(scale) {
      const { w, h } = api.size();
      const k = Math.min(scale, MAX_SIDE / Math.max(w, h));
      const outW = Math.round(w * k), outH = Math.round(h * k);
      // El lienzo está dibujado a w·zoom px; el multiplicador lo lleva exactamente a outW × outH
      const mult = (outW + 0.01) / fc.getWidth();
      const c = fc.toCanvasElement(mult);
      if (c.width !== outW || c.height !== outH) {                       // por redondeo, corrige al tamaño exacto
        const r = document.createElement('canvas'); r.width = outW; r.height = outH;
        r.getContext('2d').drawImage(c, 0, 0, outW, outH); return r;
      }
      return c;
    }
    const toBlob = (canvas, f) => new Promise((ok, fail) => {
      try { canvas.toBlob((b) => b ? ok(b) : fail(new Error('No se pudo generar la imagen.')), f.mime, 0.92); }
      catch (e) { fail(e); }
    });

    async function generate() {
      const my = ++X.gen, box = X.root; if (!box) return;
      const ui = (k) => box.querySelector(`[data-x="${k}"]`);
      ui('status').textContent = 'Generando…'; ui('go').disabled = true; if (ui('share')) ui('share').disabled = true;
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const f = FORMATS[X.fmt], sz = SIZES.find(s => s.id === X.size);
        const canvas = toCanvas(sz.scale);
        const blob = await toBlob(canvas, f);
        if (my !== X.gen || !X.open) return;
        if (X.url) URL.revokeObjectURL(X.url);
        X.blob = blob; X.url = URL.createObjectURL(blob);
        ui('preview').src = X.url;
        ui('status').textContent = `${canvas.width} × ${canvas.height} px · ${f.label} · ${kb(blob.size)}`;
        ui('go').disabled = false; if (ui('share')) ui('share').disabled = false;
      } catch (err) {
        if (my !== X.gen) return;
        console.error('[Studio] exportar', err);
        const tainted = err && (err.name === 'SecurityError' || /tainted|insecure/i.test(err.message || ''));
        ui('status').textContent = tainted
          ? 'Una de las imágenes viene de otro sitio y el navegador no permite exportarla. Subila de nuevo desde tu dispositivo o elegí una foto de tus productos.'
          : 'No se pudo generar la imagen. Probá con un tamaño menor.';
      }
    }

    /* ------------------------------------------------------------------ UI */
    const fileName = () => (safeName(X.root.querySelector('[data-x="name"]').value) || X.name) + '.' + FORMATS[X.fmt].ext;
    const canShareFiles = () => {
      try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'a.png', { type: 'image/png' })] })); }
      catch (_) { return false; }
    };

    function open() {
      if (X.open) return;
      if (!fc.getObjects().length && !(fc.backgroundImage) && !window.confirm('El lienzo está vacío. ¿Exportar igual?')) return;
      const act = fc.getActiveObject(); if (act && act.isEditing) act.exitEditing();
      fc.discardActiveObject(); fc.requestRenderAll();
      X.open = true; X.blob = null;
      const f0 = Studio.CONFIG.formats.find(f => { const s = api.size(); return f.w === s.w && f.h === s.h; });
      X.name = `affari-${f0 ? f0.id : 'placa'}-${today()}`;

      const box = document.createElement('div');
      box.className = 'st-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Exportar imagen');
      box.tabIndex = -1;
      box.innerHTML = `
        <div class="st-modal-card">
          <div class="st-modal-head"><b>Exportar imagen</b><button class="st-btn" type="button" data-x="close" aria-label="Cerrar">${icon('close')}</button></div>
          <div class="st-modal-body">
            <div class="st-prev"><img data-x="preview" alt="Vista previa de la imagen a exportar"></div>
            <div class="st-modal-opts">
              <div class="st-field"><span class="st-lbl">Formato</span>
                <div class="st-seg" data-x="fmt">${Object.entries(FORMATS).map(([k, f]) => `<button type="button" data-v="${k}" aria-pressed="${k === X.fmt}">${f.label}</button>`).join('')}</div></div>
              <div class="st-field"><span class="st-lbl">Tamaño</span>
                <div class="st-seg" data-x="size">${SIZES.map(s => `<button type="button" data-v="${s.id}" aria-pressed="${s.id === X.size}">${s.label}</button>`).join('')}</div></div>
              <label class="st-field"><span class="st-lbl">Nombre del archivo</span><input type="text" class="st-input" data-x="name" value="${esc(X.name)}" maxlength="80" autocomplete="off"></label>
              <p class="st-help" data-x="status" aria-live="polite">Generando…</p>
              <p class="st-help">PNG conserva la máxima calidad; JPG pesa menos y es ideal para WhatsApp e Instagram.</p>
            </div>
          </div>
          <div class="st-modal-foot">
            ${canShareFiles() ? `<button class="st-btn is-outline" type="button" data-x="share" disabled>${icon('upload')}<span>Compartir</span></button>` : ''}
            <button class="st-btn is-primary" type="button" data-x="go" disabled>${icon('download')}<span>Descargar</span></button>
          </div>
        </div>`;
      X.root = box; api.root.append(box);

      box.addEventListener('click', (e) => {
        if (e.target === box || e.target.closest('[data-x="close"]')) return close();
        const seg = e.target.closest('[data-x="fmt"] button, [data-x="size"] button');
        if (seg) {
          const key = seg.parentElement.dataset.x; X[key === 'fmt' ? 'fmt' : 'size'] = seg.dataset.v;
          seg.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === seg)));
          return generate();
        }
        if (e.target.closest('[data-x="go"]')) return download();
        if (e.target.closest('[data-x="share"]')) return share();
      });
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
      box.querySelector('[data-x="name"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); download(); } });
      box.focus(); generate();
    }

    function close() {
      if (!X.open) return;
      X.open = false; X.gen++;
      if (X.url) { URL.revokeObjectURL(X.url); X.url = ''; }
      X.blob = null; if (X.root) { X.root.remove(); X.root = null; }
    }

    function download() {
      if (!X.blob) return;
      const a = document.createElement('a');
      a.href = X.url; a.download = fileName(); a.rel = 'noopener';
      document.body.append(a); a.click(); a.remove();
      api.toast('Imagen descargada');
    }
    async function share() {
      if (!X.blob) return;
      try {
        const file = new File([X.blob], fileName(), { type: X.blob.type });
        await navigator.share({ files: [file], title: 'Placa creada con Affari' });
      } catch (err) { if (err && err.name !== 'AbortError') api.toast('No se pudo abrir el menú de compartir. Usá Descargar.'); }
    }

    /* ------------------------------------------------------------ enganche */
    const offCmd = api.on('cmd', (k) => { if (k === 'export') open(); });
    api.on('destroy', () => { X.dead = true; offCmd(); close(); });
    api.exportImage = open;
    api.setEnabled('export', true);
  });
})();
