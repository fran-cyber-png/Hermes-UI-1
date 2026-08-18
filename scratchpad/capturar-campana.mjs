const pw = await import(process.env.PLAYWRIGHT_MODULO ?? 'playwright');
const { chromium } = pw.default ?? pw;

/**
 * EVIDENCIA DE LA FRONTERA DE CAMPAÑA — la mirada de un supervisor de VENTAS.
 *
 * Dos fotos, y la segunda es la que importa:
 *   1. el selector de línea, ya sin «Betto»
 *   2. el hilo de una conversación de campaña: dice por qué y **no** ofrece
 *      reintentar (un 403 permanente no mejora insistiendo)
 *
 * El token se siembra en vez de pasar por el login: el stub contesta 200 en
 * `/api/auth/yo`, así que la firma no se mira (molde de `capturar-routing-*`).
 */

const URL_APP = process.env.URL_HERMES ?? 'http://localhost:5199/';
const SALIDA = 'docs/evidencia';

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  const cuerpo = btoa(`alex|${Date.now() + 14 * 24 * 60 * 60 * 1000}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  localStorage.setItem('hermes.token', `${cuerpo}.firma-que-el-front-no-mira`);
});
const pag = await ctx.newPage();
pag.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text()));

await pag.goto(URL_APP);
await pag.waitForSelector('button[data-vista="bandeja"]', { timeout: 20_000 });
await pag.click('button[data-vista="bandeja"]');
await pag.waitForTimeout(1200);
await pag.screenshot({ path: `${SALIDA}/campana-selector-sin-betto.png` });
console.log('✅ selector sin la línea de campaña');

await pag.click('text=Lead de la campaña');
await pag.waitForTimeout(1200);
await pag.screenshot({ path: `${SALIDA}/campana-hilo-403.png` });
console.log('✅ el hilo de la campaña: 403 leído, sin botón de reintentar');

await navegador.close();
