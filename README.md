# Affari · gestión comercial y financiera para PyMEs (Argentina)

FastAPI + PostgreSQL (Supabase) en el backend, HTML/CSS/JS sin build en el frontend. Incluye un asistente IA con Gemini.

## Iniciar
```bash
cd backend
pip install -r requirements.txt
# el .env va en la carpeta affari-app/ (ya viene cargado con Supabase y las claves de Gemini; ver .env.example)
python app.py                  # http://localhost:8000
```
El esquema se crea y migra solo (en Supabase y en SQLite). Para trabajar sin Supabase poné `DATABASE_URL=sqlite:///affari.db`.

### Pasar datos existentes (SQLite → Supabase)
```bash
cd backend && python migrate_to_supabase.py ruta/a/affari.db     # --force para reemplazar lo que ya haya en Supabase
```
Si al conectar da «Network is unreachable», tu red no tiene IPv6: en Supabase → Connect copiá la cadena **Session pooler** y usala en `DATABASE_URL`.
Todas las tablas se crean con RLS activado (sin políticas): la API pública de Supabase no puede leerlas; solo este backend (rol `postgres`).

## Asistente IA (menú «Asistente IA»)
Chat con Gemini que, mediante herramientas limitadas a tu negocio, puede: **cargar productos** (nombre + stock → arma la descripción y categoría; con fotos adjuntas las mira y las guarda en el producto; también agrega o **reemplaza** las fotos de un producto existente), **editar productos**, **ingresar / descontar / fijar stock** (con variantes), ver **stock bajo**, resumir **ventas** de un período y listar **deudas**. No borra nada. Un producto sin precio queda inactivo en el catálogo hasta que se le cargue uno.

**Claves y cuota:** `GEMINI_API_KEYS` en `.env` (separadas por coma) se usan en orden; si una devuelve 429 (cuota) o es inválida, se aparta un rato y pasa a la siguiente. Cuando se agotan todas, el chat avisa y el usuario puede cargar **su propia clave** en «Claves de IA» (se verifica con Google, se guarda por negocio y se usa solo cuando las del sistema no alcanzan). Modelos: `GEMINI_MODELS` (prueba en orden).
Código: `backend/ai_keys.py` (rotación) · `backend/ai_agent.py` (herramientas + endpoints `/api/ai/*`) · `js/assistant.js`.

## Rendimiento (parte 6)
- **Fotos de productos por URL**: `/api/products` y el catálogo público ya no devuelven el base64 de cada foto; devuelven `/api/img/<id>/<n>?v=<versión>` (archivo con caché de 1 año; la versión cambia si cambia la foto). `products.img_n` / `img_v` se calculan solos (migración automática + `backfill_images`). Al editar un producto el navegador reenvía esas URLs y el backend conserva las fotos guardadas.
- Respuestas con **gzip**, usuario autenticado en **caché de 20 s** (sin traer el logo en cada request) y **dashboard en 3 consultas** (antes ~11).
- IA: `GEMINI_THINKING_BUDGET=0` (por defecto) apaga el «thinking» de Gemini; la foto que ve el modelo se reduce a 768 px (la que se guarda es la original) y no se reenvía una vez asignada a un producto.
- Frontend: scripts con `defer`, animaciones más cortas, sin efectos de hover en pantallas táctiles.

## Celular
Menú de tres rayas (cajón lateral con fondo oscuro, se cierra tocando afuera, con Esc o deslizando), ventanas como hoja desde abajo, tablas con scroll horizontal y el chat de IA ocupa el alto de la pantalla con el cuadro de mensaje siempre visible.

## Estudio de Diseño (menú «Estudio de Diseño»)
Mini-editor tipo Canva para placas y catálogos (Fabric.js 5.3.1, se carga solo al entrar; para servirlo vos copiá `fabric.min.js` a `js/vendor/`). Escritorio: 3 columnas · celular: lienzo + bottom sheet con pestañas.
| Fase | Archivos | Qué hace |
|---|---|---|
| 1 | `studio.js`, `css/studio.css` | Layout responsivo, lienzo, zoom, formatos (1:1, 4:5, 9:16, 16:9), capas |
| 2 | `studio-tools.js`, `studio-templates.js` | Plantillas, formas/etiquetas, textos, fondos, panel de ajustes |
| 3 | `studio-history.js` | Deshacer / rehacer (Ctrl+Z, Ctrl+Shift+Z), 40 pasos, **borrador automático** (se ofrece recuperar al volver) |
| 3 | `studio-products.js` | Productos del inventario: **Agregar a la placa**, **Completar la plantilla** (reemplaza «Nombre del producto» / «$9.999»), **Catálogo** y **Lista de precios** con hasta 8 productos |
| 3 | `studio-export.js` | Exportar PNG/JPG a resolución real (liviana ½x · original · alta 2x), nombre de archivo, Descargar y **Compartir** (hoja nativa del celular) |

Extensión: `Studio.use(api => { … })` registra un plugin que corre una vez por editor con el lienzo listo (así están hechos historial y exportación); `Studio.registerPane(id, { render(body, api) })` rellena un panel.
Las fotos de productos se exportan sin problema porque salen del mismo origen (`/api/img/…`). Si servís la API desde otro dominio, tiene que enviar `Access-Control-Allow-Origin` o el navegador bloqueará la exportación.

## Catálogo Digital · parte 8 (editor, escritorio, fondos e imágenes propias)
- **Editor por secciones** (Marca · Imágenes · Fondo · Estilo), botón **Descartar** y vista previa fija mientras se edita.
- **Vista de escritorio real**: el selector «Escritorio» dibuja la tienda a 1280 px dentro de un marco de navegador 16:10. La tienda pública ahora usa el ancho completo: cabecera tipo portada, buscador + categorías en una fila y grilla de 4–5 columnas (3 en tablet, 2 en celular).
- **Fondos animados reescritos** (todo con `transform`/`opacity`, sin repintar): Puntos, Cuadrícula, Rayas, Escamas (se desplazan), Burbujas (suben), Aurora, Degradado, Destellos y Ondas, con **velocidad** Lenta/Normal/Rápida. Con «reducir movimiento» activado en el sistema, la tienda pública los deja quietos (el editor siempre los anima para poder elegirlos).
- **Imágenes propias (Canva)**: *Portada* de la cabecera (1600×500), *imagen de fondo* (cubrir o mosaico, con velo) y hasta 5 *banners promocionales* (1200×400) que se deslizan solos. Se reducen en el navegador (≤ 1,2 MB) y se sirven como archivo cacheable en `/api/media/<tienda>/<bgImg|coverImg|p0..p4>?v=…` (no viajan dentro del JSON).
Código: `js/store/effects.js` (fondos) · `js/store/gallery.js` (`sfPromos`) · `js/builder.js` (editor) · `css/storefront.css` (parte 8) · `backend/app.py` (`clean_theme`, `theme_view`, `store_media`).

### Parte 8b
- **Galería de diseños incluida** (`assets/designs/*.svg` + `js/store/designs.js`): 6 portadas, 6 banners con texto y 7 fondos **animados** (aurora, burbujas, confeti, estrellas, ondas…; SVG con animación propia). Un toque los aplica y ajusta colores. El backend solo acepta rutas `/assets/designs/<nombre>.svg`.
- **Filtros** en la tienda: ordenar (precio/nombre), precio mínimo y máximo, solo disponibles; contador y «Quitar filtros». Las **categorías** van debajo del buscador.
- Cabecera **centrada** con portada corregida. El fondo animado ya no se congela con «reducir movimiento»: hay un botón **Pausar fondo**.
- No hay conexión con Canva: si conectás el conector de Canva en claude.ai se pueden exportar diseños propios y subirlos en Imágenes.

## Parte 9 · Velocidad, ingreso con Google y horarios
**Velocidad entre secciones** (`js/datastore.js`, `js/app.js`, `js/auth.js`): los GET del panel pasan por una caché en memoria *stale-while-revalidate*.
Una pestaña ya visitada se dibuja al instante con lo que hay; si los datos tienen más de 30 s se revalidan de fondo y la vista se redibuja sola **solo si cambiaron**
(y nunca mientras hay un diálogo abierto o se está escribiendo). Cualquier escritura (POST/PUT/DELETE, incluido el asistente IA) vacía la caché. Los datos se precargan
al pasar el mouse/dedo por el menú y en tiempo libre tras el login. Reportes, flujo de caja y chat IA no se cachean (se actualizan en vivo).
Para medir: `localStorage.affariPerf = 1` en la consola del navegador y cada cambio de sección imprime su tiempo; las respuestas llevan la cabecera `Server-Timing`.

**Ingreso con Google** (`backend/google_auth.py`, `js/google-auth.js`): botón oficial de Google Identity Services; el backend verifica el ID token (firma, audiencia, email verificado).
Cuenta existente (o mismo email ya registrado) → entra directo. Cuenta nueva → paso rápido de un solo pantallazo con **nombre del negocio + teléfono**. Requiere `GOOGLE_CLIENT_ID` en `.env`
(sin esa variable el botón no aparece y todo sigue andando con email/contraseña).

**Horarios de atención** (`backend/hours.py`, `js/hours-ui.js`, `js/store/hours.js`): Configuración → «Horarios de atención» (hasta 3 franjas por día, soporta cruce de medianoche).
Se guardan en `stores.hours` y la tienda pública muestra «Abierto ahora · cierra 20:00 hs» / «Cierra pronto» / «Cerrado · abre mañana 09:00 hs», con el horario semanal desplegable.
El cálculo usa la zona horaria del negocio (`APP_TZ`) y la hora del servidor, no la del visitante.

Pruebas: `node tests/js/datastore.test.js` · `node tests/js/navigation.test.js` · `node tests/js/hours.test.js` · `python tests/hours_test.py` · `python tests/google_flow_test.py`.

## Estructura
```
backend/
  app.py            API principal (auth, caja, productos, reportes, catálogo público)
  operations.py     PARTE 5 · variantes, clientes, proveedores, deudas, flujo de caja, fiscal, comprobantes
  afip.py           PARTE 5 · estructura AFIP: validación de CUIT, payload FECAESolicitar, QR oficial, punto de integración WSAA/WSFE
  invoice_pdf.py    PARTE 5 · PDF del comprobante (con CAE y QR si está autorizado)
  reports.py / exporters.py   estadísticas y exportación PDF/Excel (parte 4)
  schema.sql / database.py    esquema y migraciones automáticas; database.py traduce el SQL a Postgres
  ai_keys.py / ai_agent.py    asistente IA con Gemini y rotación de claves
  migrate_to_supabase.py      copia una affari.db a Supabase
css/ ops.css        estilos de la parte 5
js/  ops.js         clientes, proveedores, deudas, flujo de caja
     ops-docs.js    inventario con variantes, comprobantes, datos fiscales
```

## Parte 5: qué incluye
| Módulo | Dónde |
|---|---|
| Medios de pago: Efectivo, Transferencia, Tarjeta (+ Fiado) | `methodSeg()` en views.js, `PAY_METHODS` en operations.py |
| Variantes + descuento automático de stock + alertas rojas | Inventario, venta, fiado y comprobantes |
| Clientes y proveedores (ficha completa, CUIT validado, WhatsApp) | menús Clientes / Proveedores |
| Cuenta corriente de proveedores (compras a crédito, vencimientos, pagos) | Proveedores |
| Deudas por cobrar / por pagar y posición neta | menú Deudas |
| Flujo de caja diario por medio de pago + cierre con diferencia | menú Flujo de caja |
| Comprobantes X / A / B / C con numeración, IVA, PDF y anulación | menú Comprobantes |

## Reglas contables
- Efectivo, Transferencia y Tarjeta mueven caja. **Fiado** no mueve caja hasta que se cobra.
- Pagar a un proveedor es salida de caja pero **no es gasto del período** (la mercadería ya cuenta como costo al vender). Así el balance de Estadísticas no duplica costos.
- Si un producto tiene variantes, su stock total es la suma de ellas.
- Un comprobante con CAE no se anula (correspondería nota de crédito: pendiente).

## AFIP: estado real
Los comprobantes **X** (no fiscales) funcionan completos. Los **A/B/C** se numeran, calculan IVA y arman el payload oficial, pero quedan *pendientes de CAE*:
falta implementar `request_cae()` en `backend/afip.py` (WSAA + WSFE) con el certificado digital del comercio. El encabezado de ese archivo lista los pasos.

## Planes, prueba de 7 días y cobros (Mercado Pago)
- **Estado de acceso** (`backend/billing.py`): VIP (`ADMIN_VIP_EMAILS`) → plan Negocio permanente · pago vigente (`users.plan` + `plan_expires_at`) · prueba de 7 días (`trial_ends_at`, todo desbloqueado) · gratis (caja, fiados, 50 productos).
- **Bloqueo**: el servidor responde `402` en las rutas de `GATES` (IA, reportes, diseño del catálogo, flujo de caja, proveedores, deudas, comprobantes), apaga el catálogo público de quien está en plan gratis y limita a 50 productos. El navegador (`js/billing.js`) muestra el panel/modal de planes al recibir ese 402.
- **Pagos**: `POST /api/billing/checkout` crea la preferencia (Checkout Pro) y devuelve `init_point`; `POST /api/billing/webhook` consulta el pago a Mercado Pago y, si está aprobado, pone `plan` y suma 30 días. En Mercado Pago > Tus integraciones > Webhooks cargá `https://TU-DOMINIO/api/billing/webhook` (evento *Pagos*).
- Variables nuevas en `.env.example`. SQL para Supabase: `backend/supabase_billing.sql`.

## Despliegue en Render (gratis) + keep-alive
1. Subí `affari-app/` a GitHub (el `.env` está en `.gitignore`: no se sube).
2. Render > New > Blueprint > tu repo (usa `render.yaml`), o New > Web Service con: Build `pip install -r requirements.txt` · Start `gunicorn -k uvicorn.workers.UvicornWorker -w 1 --chdir backend app:app --bind 0.0.0.0:$PORT --timeout 120 --forwarded-allow-ips="*"` · Health check `/ping`.
3. Cargá las variables (ver `.env.example`). `DATABASE_URL` debe ser la cadena **Session pooler** de Supabase. No uses SQLite en Render: el disco gratis se borra en cada reinicio.
4. Mercado Pago: webhook `https://TU-APP.onrender.com/api/billing/webhook`.
5. Keep-alive (elegí uno): **UptimeRobot** (monitor HTTP a `https://TU-APP.onrender.com/ping`, intervalo ≤ 10 min) · **GitHub Actions** (`.github/workflows/keep-alive.yml` + secret `RENDER_URL`) · `python keep_alive.py URL` en una PC siempre encendida.

