const pw = await import(process.env.PLAYWRIGHT_MODULO ?? 'playwright');
const { chromium } = pw.default ?? pw;

/**
 * EVIDENCIA DEL CHIP DE ETAPA EN LA COLA (PR 1.1) — la app REAL, no una galería.
 *
 * Lo que la foto tiene que probar son dos cosas a la vez:
 *   1. las tres filas con gestión asentada llevan su chip con el rótulo de
 *      ADR 0049 («Sabe el precio», «Compró», «Contestó»), y
 *   2. la cuarta —sin gestión— NO lleva ninguno.
 *
 * 🔴 **Y el stub contesta 503 a `/api/dashboard` a propósito**: hasta ayer el
 * chip salía (o más bien NO salía) de ese mapa. Si con el Dashboard caído los
 * chips aparecen igual, es que el dato viaja en la misma respuesta que la fila,
 * que es exactamente lo que este PR afirma.
 *
 *   node scratchpad/api-cola-etapas.mjs &
 *   VITE_API_URL=http://localhost:4199 npx vite --port 5199 &
 *   node scratchpad/capturar-cola-etapas.mjs
 */

const URL_APP = process.env.URL_HERMES ?? 'http://localhost:5199/';
const SALIDA = 'docs/evidencia';

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  const cuerpo = btoa(`luz|${Date.now() + 14 * 24 * 60 * 60 * 1000}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  localStorage.setItem('hermes.token', `${cuerpo}.firma-que-el-front-no-mira`);
});
const pag = await ctx.newPage();
pag.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text()));

// Se anotan los pedidos al dashboard. El contador se PONE EN CERO al entrar a
// Mensajes: arrancar en el Dashboard y pedirlo ahí es lo correcto — lo que este
// PR afirma es que **desde la vista Mensajes no sale ninguno**, que es donde la
// vendedora pasa el día.
let t0 = Date.now();
let alDashboard = [];
pag.on('request', (r) => {
  if (r.url().includes('/api/dashboard')) alDashboard.push(((Date.now() - t0) / 1000).toFixed(1));
});

await pag.goto(URL_APP);
await pag.waitForSelector('button[data-vista="bandeja"]', { timeout: 20_000 });
await pag.click('button[data-vista="bandeja"]');
alDashboard = [];
t0 = Date.now();
// 40 s: más que el latido de 30 s que el hook tenía en la raíz. Si el poll
// siguiera vivo, acá habría por lo menos uno.
await pag.waitForTimeout(40_000);
await pag.screenshot({ path: `${SALIDA}/cola-etapa-en-la-fila.png` });
console.log('✅ la cola con los chips de etapa');
console.log(`   pedidos a /api/dashboard en 40 s de Mensajes: ${alDashboard.length}`);
console.log(`   segundos desde que entró a Mensajes: [${alDashboard.join(', ')}]`);

await navegador.close();
