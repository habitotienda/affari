/* Affari · Service Worker
   - Shell (HTML, CSS, JS): precacheado y servido desde caché, actualizado en segundo plano.
   - /api/*: siempre a la red (nunca se cachean datos de negocio ni sesiones).
   - Sin conexión: se abre la app y se muestra la pantalla de reintento.
   Al publicar cambios, subí el número de VERSION para que todos reciban la versión nueva. */
const VERSION = 'v30';
const CACHE = `affari-${VERSION}`;
/* Fotos de productos (/api/img/<id>/<n>?v=<versión>&w=<ancho>): la URL lleva la versión, así que la copia guardada nunca queda vieja
   (si cambia la foto, cambia la URL). Caché aparte y SIN versión del SW para que sobreviva a las actualizaciones; se recorta a IMG_MAX. */
const IMG_CACHE = 'imgs-v1', IMG_MAX = 400;
const PRECACHE = [
  '/',
  '/css/styles.css',
  '/css/auth.css',
  '/css/landing.css',
  '/css/storefront.css',
  '/css/views.css',
  '/css/reports.css',
  '/css/ops.css',
  '/css/assistant.css',
  '/css/studio.css',
  '/css/hours.css',
  '/css/billing.css',
  '/css/sale-flow.css',
  '/js/datastore.js',
  '/js/icons.js',
  '/js/store/utils.js',
  '/js/store/hours.js',
  '/js/store/effects.js',
  '/js/store/cart.js',
  '/js/store/gallery.js',
  '/js/store/imageguard.js',
  '/js/store/storefront.js',
  '/js/landing.js',
  '/js/auth.js',
  '/js/google-auth.js',
  '/js/store/designs.js',
  '/js/builder.js',
  '/js/views.js',
  '/js/sale-flow.js',
  '/js/treinta-import.js',
  '/js/hours-ui.js',
  '/js/reports.js',
  '/js/ops.js',
  '/js/ops-docs.js',
  '/js/assistant.js',
  '/js/studio.js',
  '/js/studio-tools.js',
  '/js/studio-templates.js',
  '/js/studio-history.js',
  '/js/studio-products.js',
  '/js/studio-export.js',
  '/js/back.js',
  '/js/billing.js',
  '/js/app.js',
  '/assets/icons/logo.svg',
  '/assets/icons/icon-192.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(PRECACHE.map(u => c.add(u))))   // un archivo que falle no rompe la instalación
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('affari-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // fuentes de Google, etc.: que las maneje el navegador
  if (/^\/api\/img\/\d+\/\d+$/.test(url.pathname) && url.searchParams.has('v')) {   // fotos: caché primero (instantáneas al volver)
    event.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && !res.redirected && !url.searchParams.has('_r') && !url.searchParams.has('_g')) {   // ni redirecciones (versión vieja) ni reintentos con marca
        await c.put(req, res.clone());
        c.keys().then(ks => { if (ks.length > IMG_MAX) ks.slice(0, ks.length - IMG_MAX).forEach(k => c.delete(k)); });
      }
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;                  // datos: siempre en vivo

  // Páginas: red primero (para ver siempre lo último); sin red, la copia guardada.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        if (url.pathname === '/') caches.open(CACHE).then(c => c.put('/', res.clone()));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('/')))
    );
    return;
  }

  // CSS, JS, imágenes: caché primero y se refresca de fondo (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.ok && /^\/(css|js|assets)\/|^\/manifest\.json$/.test(url.pathname)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
