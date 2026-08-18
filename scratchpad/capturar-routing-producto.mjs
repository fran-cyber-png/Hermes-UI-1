const pw = await import(process.env.PLAYWRIGHT_MODULO ?? 'playwright');
const { chromium } = pw.default ?? pw;

/**
 * EVIDENCIA DE LA HOJA DE PRODUCTO (ADR 0060) — con los datos REALES de prod.
 *
 * ⚠️ Sirve los 22 cursos y las 2 campañas tal como están hoy, **incluidos los
 * cuatro formularios mal enlazados**: una galería con el caso ideal ya escondió
 * tres defectos una vez.
 *
 * El token se siembra en vez de pasar por el login (molde de
 * `capturar-routing-campanas.mjs`): acá el server es un stub que contesta 200 en
 * `/api/auth/yo`, así que la firma no se mira — el front solo decodifica el
 * cuerpo y comprueba que no venció (`features/auth/sesion.ts:quienDiceSer`).
 */

const URL = process.env.URL_HERMES ?? 'http://localhost:5199/';
const SALIDA = 'docs/evidencia';

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  const cuerpo = btoa(`Usuario1|${Date.now() + 14 * 24 * 60 * 60 * 1000}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  localStorage.setItem('hermes.token', `${cuerpo}.firma-que-el-front-no-mira`);
});
const pag = await ctx.newPage();
pag.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text()));

await pag.goto(URL);
await pag.waitForSelector('button[data-vista="routing"]', { timeout: 15_000 });
await pag.click('button[data-vista="routing"]');

// El chip «Formularios»: ahí viven los cuatro mal enlazados.
await pag.waitForSelector('text=Formularios', { timeout: 10_000 });
await pag.click('text=Formularios');
await pag.waitForTimeout(400);
await pag.screenshot({ path: `${SALIDA}/routing-producto-lista.png` });
console.log('✅ lista de formularios');

// La hoja de la pieza mal enlazada: el ChatGPT Pro que cae en Consultor Político.
const botones = await pag.$$('button[aria-label^="A qué producto pertenece"]');
console.log(`botones de producto en la lista: ${botones.length}`);

const elChatGpt = await pag.$('button[aria-label*="ChatGPT"]');
if (!elChatGpt) throw new Error('no encontré el renglón del ChatGPT Pro');
await elChatGpt.click();
await pag.waitForSelector('text=Mandarla a otro producto', { timeout: 10_000 });
await pag.waitForTimeout(600);

const porQue = await pag.$eval('aside[aria-label="Producto de esta pieza"]', (n) => n.innerText);
console.log('── lo que dice la hoja ──');
console.log(porQue.split('\n').slice(0, 12).map((l) => `   ${l}`).join('\n'));

await pag.screenshot({ path: `${SALIDA}/routing-producto-hoja.png` });
console.log('✅ hoja abierta sobre la pieza mal enlazada');

// Y una campaña resuelta por SKU, que es el caso que NO hay que tocar.
await pag.keyboard.press('Escape');
await pag.waitForTimeout(300);
await pag.click('text=Campañas');
await pag.waitForTimeout(400);
const primera = await pag.$('button[aria-label^="A qué producto pertenece"]');
if (primera) {
  await primera.click();
  await pag.waitForSelector('text=Mandarla a otro producto', { timeout: 10_000 });
  await pag.waitForTimeout(600);
  await pag.screenshot({ path: `${SALIDA}/routing-producto-campana.png` });
  console.log('✅ hoja sobre una campaña');
}

await navegador.close();
