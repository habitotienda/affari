/* Landing pública (antes de iniciar sesión) */
const LP_FEATURES = [
  ['cash', 'Caja y ventas', 'Registrá una venta en segundos, en efectivo o por transferencia, y mirá el total del día.'],
  ['book', 'Cuaderno de fiados', 'Anotá quién te debe, cuánto y desde cuándo. Se acabaron las libretas perdidas.'],
  ['box', 'Inventario y stock', 'Cada venta descuenta stock y te avisamos antes de quedarte sin mercadería.'],
  ['store', 'Catálogo digital', 'Compartí tus productos con precios al día en un solo link.'],
  ['whatsapp', 'Recordatorios por WhatsApp', 'Mandá el recordatorio de cobro con un toque, con el saldo ya escrito.'],
  ['trend', 'Ganancia a la vista', 'Mirá cuánto ganás de verdad: ventas menos costo, todos los días.']
];
const LP_BENEFITS = [
  ['shop', 'Hecho para comercios argentinos', 'Todo en pesos, con efectivo, transferencia y fiado como los usás todos los días.'],
  ['phone', 'Funciona desde el celu', 'Cobrá y consultá tu caja desde el mostrador, la feria o el local.'],
  ['check', 'Listo en un minuto', 'Creás tu cuenta, cargás tu primer producto y ya estás vendiendo.']
];
const LP_PLANS = [
  { name: 'Gratis', price: '$0', per: '', note: 'Después de tus 7 días de prueba con todo incluido', items: ['Caja básica', 'Cuaderno de fiados', 'Hasta 50 productos'], cta: 'Empezar gratis' },
  { name: 'Pro', price: '$9.900', per: '/mes', hot: true, plan: 'pro', items: ['Productos ilimitados', 'Catálogo digital', 'Recordatorios por WhatsApp', 'Reportes avanzados', 'Asistente IA', 'Estudio de Diseño'], cta: 'Probar Pro' },
  { name: 'Negocio', price: '$19.900', per: '/mes', plan: 'negocio', items: ['Todo lo de Pro', 'Varios usuarios', 'Varias sucursales', 'Soporte prioritario'], cta: 'Elegir Negocio' }
];

function renderLanding(root, { onLogin, onRegister }) {
  const reveal = (i = 0) => `data-reveal style="--d:${i * 80}ms"`;
  root.innerHTML = `
  <header class="lp-head" id="lpHead"><div class="lp-bar">
    <a class="lp-brand" href="#inicio">${LOGO_SVG}AFFARI</a>
    <nav class="lp-nav" aria-label="Secciones"><a href="#funcionalidades">Funcionalidades</a><a href="#catalogo">Catálogo</a><a href="#precios">Precios</a></nav>
    <div class="lp-cta"><button class="btn btn-ghost" data-auth="login">Iniciar sesión</button><button class="btn btn-primary" data-auth="register">Registrarse gratis</button></div>
  </div></header>
  <main id="inicio">
    <section class="hero"><div class="wrap">
      <div class="hero-copy">
        <h1>Cobrá, fiá y controlá tu stock desde un solo lugar</h1>
        <p class="lead">Affari ordena la caja, los fiados y el inventario de tu comercio. Sin planillas y sin libretas.</p>
        <div class="hero-actions"><button class="btn btn-primary btn-lg" data-auth="register">Crear cuenta gratis</button><a class="btn btn-lg" href="#funcionalidades">Ver funcionalidades</a></div>
        <small>Sin tarjeta de crédito. Empezás en un minuto.</small>
      </div>
      <div class="mock-wrap" aria-hidden="true">
        <div class="card mock">
          <div class="mock-top"><span>Ventas de hoy</span><span class="pill">Caja abierta</span></div>
          <strong class="big">$ 128.400</strong>
          <div class="bars">${[38, 52, 44, 70, 58, 82, 100].map((h, i) => `<i style="--h:${h}%;--i:${i}"></i>`).join('')}</div>
          <ul class="mock-rows">
            <li><span>Venta mostrador</span><b class="pos">+ $12.400</b></li>
            <li><span>Fiado: Rosa Fernández</span><b>$18.500</b></li>
            <li><span>Stock bajo: Yerba 1kg</span><b>3 u.</b></li>
          </ul>
        </div>
        <div class="chip">${icon('check', 18)}Transferencia recibida <b class="pos">+ $7.800</b></div>
      </div>
    </div></section>

    <section class="lp-sec" id="funcionalidades"><div class="wrap">
      <h2 ${reveal()}>Todo lo que necesita tu negocio, en una sola app</h2>
      <p class="sub" ${reveal(1)}>Menos tiempo anotando y más tiempo vendiendo.</p>
      <div class="grid3">${LP_FEATURES.map(([ic, t, d], i) => `<article class="card lp-card" ${reveal(i % 3)}><div class="ico-box">${icon(ic, 22)}</div><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
    </div></section>

    <section class="lp-sec" id="catalogo"><div class="wrap cat-split">
      <div><h2 ${reveal()}>Tu tienda online lista para compartir por WhatsApp</h2>
        <p class="sub" ${reveal(1)}>Cargá tus productos, copiá el enlace o descargá el QR y tus clientes arman el pedido desde el celular.</p>
        <ul class="ticks" ${reveal(2)}><li>${icon('check', 18)}Precios y stock siempre al día</li><li>${icon('check', 18)}Enlace propio y código QR</li><li>${icon('check', 18)}El pedido te llega por WhatsApp</li></ul>
        <button class="btn btn-primary btn-lg" data-auth="register">Crear mi catálogo</button></div>
      <div class="card sf-mini" ${reveal(1)} aria-hidden="true"><div class="mini-head"><div class="mini-logo">A</div><div><h3>Almacén Don Pepe</h3><small>Catálogo</small></div></div>
        <div class="mini-item"><div><b>Yerba mate 1kg</b><small>Disponible</small></div><span class="mini-price">$4.200</span></div>
        <div class="mini-item"><div><b>Aceite girasol 900ml</b><small>Disponible</small></div><span class="mini-price">$2.900</span></div>
        <div class="mini-item"><div><b>Fideos tirabuzón 500g</b><small>Últimas unidades</small></div><span class="mini-price">$1.300</span></div></div>
    </div></section>

    <section class="lp-sec alt" id="beneficios"><div class="wrap">
      <h2 ${reveal()}>Pensado para cómo trabajás vos</h2>
      <p class="sub" ${reveal(1)}>Simple de usar el primer día y útil todos los días.</p>
      <div class="grid3">${LP_BENEFITS.map(([ic, t, d], i) => `<article class="card lp-card" ${reveal(i)}><div class="ico-box">${icon(ic, 22)}</div><h3>${t}</h3><p>${d}</p></article>`).join('')}</div>
    </div></section>

    <section class="lp-sec" id="precios"><div class="wrap">
      <h2 ${reveal()}>Un plan para cada etapa de tu negocio</h2>
      <p class="sub" ${reveal(1)}>Probá todo gratis durante 7 días. Después seguís gratis con lo básico o elegís un plan.</p>
      <div class="grid3">${LP_PLANS.map((p, i) => `<article class="card plan lp-card ${p.hot ? 'hot' : ''}" ${reveal(i)}>
        ${p.hot ? '<span class="tag">Más elegido</span>' : ''}<h3>${p.name}</h3>
        <div class="price">${p.price}<small>${p.per}</small></div>${p.note ? `<p class="plan-note">${p.note}</p>` : ''}
        <ul>${p.items.map(it => `<li>${icon('check', 18)}${it}</li>`).join('')}</ul>
        <button class="btn ${p.hot ? 'btn-primary' : ''}" data-auth="register" ${p.plan ? `data-plan="${p.plan}"` : ''}>${p.cta}</button></article>`).join('')}</div>
    </div></section>

    <div class="wrap"><div class="card cta-band" data-reveal>
      <h2>Ordená tu negocio hoy y dejá de perseguir cuentas</h2>
      <button class="btn btn-primary btn-lg" data-auth="register">Registrarse gratis</button>
    </div></div>
  </main>
  <footer class="lp-foot"><div class="wrap"><a class="lp-brand" href="#inicio">${LOGO_SVG}AFFARI</a><span>Gestión comercial y financiera para micronegocios y PyMEs de Argentina.</span></div></footer>`;

  root.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => {
    if (b.closest('.plan')) try { b.dataset.plan ? sessionStorage.setItem('affariPlan', b.dataset.plan) : sessionStorage.removeItem('affariPlan'); } catch {}   // «Probar Pro» / «Elegir Negocio»: al registrarse va directo a pagar
    (b.dataset.auth === 'login' ? onLogin : onRegister)();
  });
  const head = root.querySelector('#lpHead');
  const onScroll = () => head.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const items = root.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
    items.forEach(el => io.observe(el));
  } else items.forEach(el => el.classList.add('in'));
}
