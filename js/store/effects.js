/* Catálogo · fondos decorativos.
   Solo CSS/HTML controlado: el comercio elige un patrón de la lista (y opcionalmente una imagen suya), nunca escribe CSS.
   Estructura que arma sfFx dentro de <div class="sf-bgfx">:
     <div class="fx-img">   imagen de fondo (Canva, etc.) + velo para que el texto se lea
     <div class="fx-pat …"> patrón / animación                                                       */
const SF_PATTERNS = [
  ['none', 'Liso'], ['dots', 'Puntos'], ['grid', 'Cuadrícula'], ['diagonal', 'Rayas'], ['scales', 'Escamas'], ['grain', 'Textura'],
  ['bubbles', 'Burbujas'], ['aurora', 'Aurora'], ['mesh', 'Degradado'], ['sparkles', 'Destellos'], ['waves', 'Ondas'],
];
const SF_ANIMATED = ['dots', 'grid', 'diagonal', 'scales', 'bubbles', 'aurora', 'mesh', 'sparkles', 'waves'];

/* Elementos internos de cada patrón. Posiciones fijas (sin azar) para que la vista previa no "salte" al editar. */
function sfFxInner(pat) {
  if (pat === 'bubbles') return Array.from({ length: 18 }, (_, i) => {
    const s = 22 + (i * 29) % 64, x = (i * 37 + 9) % 94, y = (i * 53 + 7) % 88, d = 14 + (i * 7) % 12, dl = -((i * 5) % d), sw = 10 + (i * 11) % 26;
    return `<i style="--s:${s}px;--x:${x}%;--y:${y}%;--d:${d}s;--dl:${dl}s;--sw:${sw}px"></i>`;
  }).join('');
  if (pat === 'aurora') return '<i class="a1"></i><i class="a2"></i><i class="a3"></i>';
  if (pat === 'sparkles') return Array.from({ length: 34 }, (_, i) => {
    const s = 4 + (i * 7) % 9, x = (i * 41 + 5) % 97, y = (i * 59 + 13) % 95, d = 2.6 + (i * 3) % 40 / 10, dl = -((i * 13) % 30) / 10;
    return `<i style="--s:${s}px;--x:${x}%;--y:${y}%;--d:${d}s;--dl:${dl}s"></i>`;
  }).join('');
  if (pat === 'waves') {
    const w = 'M0 60 C200 0 400 0 600 60 S1000 120 1200 60 V120 H0Z';
    return [1, 2, 3].map(n => `<svg class="w${n}" viewBox="0 0 2400 120" preserveAspectRatio="none" aria-hidden="true"><path d="${w}"/><path d="${w}" transform="translate(1200 0)"/></svg>`).join('');
  }
  return '';
}

/* box = <div class="sf-bgfx">. t = { pattern, patColor, patOpacity, patAnimate, patSpeed, accent, bgImg, bgImgMode, bgImgDim }.
   Se llama en cada cambio del diseño, así que solo reescribe el DOM si cambió algo. */
function sfFx(box, t) {
  const pat = SF_PATTERNS.some(([k]) => k === t.pattern) ? t.pattern : 'none';
  const img = t.bgImg || '', mode = t.bgImgMode === 'tile' ? 'tile' : 'cover';
  const key = [pat, img, mode].join('|');
  if (box.dataset.k !== key) {
    box.dataset.k = key;
    box.innerHTML = `${img ? `<div class="fx-img ${mode}"></div>` : ''}<div class="fx-pat fx-${pat}">${sfFxInner(pat)}</div>`;
    if (img) box.querySelector('.fx-img').style.backgroundImage = `url("${String(img).replace(/["\\\n]/g, '')}")`;
  }
  box.className = `sf-bgfx${t.patAnimate && SF_ANIMATED.includes(pat) ? ' anim' : ''}`;
  const sp = { 1: 1.7, 2: 1, 3: .55 }[t.patSpeed] || 1;       // multiplicador de duración: más chico = más rápido
  box.style.setProperty('--pc', t.patColor || t.accent);
  box.style.setProperty('--fxo', t.patOpacity || 24);
  box.style.setProperty('--sp', sp);
  box.style.setProperty('--dim', (t.bgImgDim ?? 35) / 100);
}
