/* Affari · Service Worker
   - Shell (HTML, CSS, JS): precacheado y servido desde caché, actualizado en segundo plano.
   - /api/*: siempre a la red (nunca se cachean datos de negocio ni sesiones).
   - Sin conexión: se abre la app y se muestra la pantalla de reintento.
   Al publicar cambios, subí el número de VERSION para que todos reciban la versión nueva. */
const VERSION = 'v16';
const CACHE = `affari-${VERSION}`;
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
  '/js/datastore.js',
  '/js/icons.js',
  '/js/store/utils.js',
  '/js/store/hours.js',
  '/js/store/effects.js',
  '/js/store/cart.js',
  '/js/store/gallery.js',
  '/js/store/storefront.js',
  '/js/landing.js',
  '/js/auth.js',
  '/js/google-auth.js',
  '/js/store/designs.js',
  '/js/builder.js',
  '/js/views.js',
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
