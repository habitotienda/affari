/* node tests/js/imageguard.test.js — sfImageGuard: detecta fotos principales sin cargar y carga las cercanas; las lejanas esperan (DOM simulado) */
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../../js/store/imageguard.js', 'utf8');

let inflight = 0, maxInflight = 0; const requested = [];
class Img {
  constructor(attrs, top) {
    this.attrs = { ...attrs }; this.dataset = {}; this.top = top; this.complete = !attrs.src; this.naturalWidth = 0; this.isConnected = true;
    const cls = new Set(attrs.broken ? ['sf-broken'] : []); delete this.attrs.broken;
    this.classList = { contains: c => cls.has(c), add: c => cls.add(c), remove: c => cls.delete(c) };
    if (attrs['data-first']) { this.dataset.first = attrs['data-first']; }
    if (attrs.src && attrs.done) { this.complete = true; this.naturalWidth = 100; } else if (attrs.src) { this.complete = true; }
    delete this.attrs.done;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  set src(u) { this.attrs.src = u; this.load(u); }
  getBoundingClientRect() { return { top: this.top, bottom: this.top + 100 }; }
  load(u) {                                   // simula la red: URLs con "dead" no existen
    this.complete = false; requested.push(u); inflight++; maxInflight = Math.max(maxInflight, inflight);
    setTimeout(() => { inflight--; this.complete = true; this.naturalWidth = /dead/.test(u) ? 0 : 100; this.classList.remove('sf-broken'); }, 20);
  }
}
const mkCard = img => ({ isConnected: true, querySelector: () => img });
const events = [];
global.window = global; global.HTMLImageElement = Img; global.innerHeight = 800;
global.navigator = { onLine: true }; global.addEventListener = () => {};
global.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o.detail; } };
global.document = { hidden: false, addEventListener: () => {}, dispatchEvent: e => events.push(e.detail) };
new Function(src)();

(async () => {
  const imgs = [
    new Img({ src: '/api/img/1/0?v=a&w=640', done: true }, 0),                 // ya cargada
    ...Array.from({ length: 12 }, (_, i) => new Img({ 'data-first': `/api/img/${i + 10}/0?v=a&w=640` }, 3000 - i * 200)),   // sin iniciar, lejanas
    new Img({}, 100),                                                           // sin src (pero se le conocía)
    new Img({ src: '/api/img/99/0?v=a&w=640', broken: true }, 50),              // rota: agotó los reintentos de utils.js
    new Img({ src: '/api/img/dead/0?v=a&w=640', broken: true }, 60),            // rota para siempre
  ];
  const lost = imgs[13]; lost.dataset.src0 = '/api/img/50/0?v=a&w=640';
  // la "perdida" se conocía: se registra como si se hubiera visto con src
  lost.attrs.src = '/api/img/50/0?v=a&w=640'; lost.complete = true; lost.naturalWidth = 100;

  const g = window.sfImageGuard; assert(g, 'se registra window.sfImageGuard');
  g.watch(imgs.map(mkCard));
  let s = g.status(); assert(!s.done);
  const far = imgs.slice(1, 13).filter(i => i.top > 800 + 900);                 // más de 900 px fuera de la pantalla
  const near = imgs.slice(1, 13).filter(i => i.top <= 800 + 900);
  assert(far.length > 0 && near.length > 0, 'el escenario tiene cercanas y lejanas');
  assert.strictEqual(s.total, 16 - far.length, 'las lejanas todavía no cuentan');
  const retried = []; window.sfImgRetry = i => { retried.push(i); i.classList.remove('sf-broken'); i.src = i.dataset.src0 || i.getAttribute('src'); };
  await new Promise(r => setTimeout(r, 9000));
  s = g.status();
  assert(maxInflight <= 4 + 1, 'concurrencia limitada: ' + maxInflight);
  assert.strictEqual(near.filter(i => i.naturalWidth > 0).length, near.length, 'las cercanas cargaron');
  assert(far.every(i => i.hasAttribute('data-first') && i.naturalWidth === 0), 'las lejanas NO se descargaron');
  assert(!requested.some(u => far.some(i => i.dataset.first === u)), 'ni se pidieron');
  assert(imgs[14].naturalWidth > 0, 'la rota recuperable se recupera');
  assert.strictEqual(s.failed, 1, 'la inexistente queda como fallida tras 3 rondas'); assert(s.done, 'termina aunque una sea imposible');
  // el visitante se acerca (scroll): las lejanas pasan a cercanas y se cargan
  far.forEach(i => { i.top = 300; }); g.watch(imgs.map(mkCard));
  await new Promise(r => setTimeout(r, 3000));
  assert(far.every(i => i.naturalWidth > 0), 'al acercarse se cargan');
  // orden: la más cercana a la pantalla primero
  assert(requested.length && !/dead/.test(requested[0]), 'arranca por las cercanas');
  // desde la 2.ª ronda se pide la original sin w=
  assert(requested.some(u => u.includes('dead') && /w=320/.test(u)), 'cae a una miniatura más chica');
  assert(requested.every(u => /w=\d+/.test(u)), 'nunca pide la foto completa desde la grilla');
  assert(events.length > 1 && events[events.length - 1].done, 'emite eventos de estado');
  g.stop();
  console.log('imageguard.test.js OK  (pedidos:', requested.length, ', máx. simultáneas:', maxInflight + ')');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
