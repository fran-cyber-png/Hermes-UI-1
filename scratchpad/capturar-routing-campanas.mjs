const pw = await import(process.env.PLAYWRIGHT_MODULO ?? 'playwright');
const { chromium } = pw.default ?? pw;

/**
 * Evidencia de la pantalla Routing con los datos REALES de producción (las 92
 * llegadas de click-to-WhatsApp de los últimos 30 días, resueltas contra Meta).
 *
 * El token se inyecta firmado en vez de pasar por el login: la sesión es HMAC y
 * el punto de la captura es la pantalla, no el handshake con Cerberus.
 */

const URL = 'http://127.0.0.1:5174/';
const TOKEN = process.env.TOKEN_ALAN;
if (!TOKEN) throw new Error('falta TOKEN_ALAN');

const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(([t]) => {
  localStorage.setItem('hermes.token', t);
}, [TOKEN]);
const pag = await ctx.newPage();

await pag.goto(URL);
await pag.waitForSelector('button[data-vista="routing"]');
await pag.click('button[data-vista="routing"]');
await pag.waitForSelector('select[aria-label^="Quién atiende"]', { timeout: 10_000 });
await pag.waitForTimeout(500);

const filas = await pag.$$eval('li select[aria-label^="Quién atiende"]', (ss) =>
  ss.map((s) => `${s.getAttribute('aria-label')} → ${s.options[s.selectedIndex].textContent}`),
);
console.log(filas.join('\n'));

await pag.screenshot({ path: 'docs/evidencia/routing-campanas.png' });

// Y el momento que importa: elegir a otra persona y que quede.
const select = await pag.$('li select[aria-label^="Quién atiende"]');
await select.selectOption({ label: 'ventas12' });
await pag.waitForTimeout(900);
const despues = await pag.$eval(
  'li select[aria-label^="Quién atiende"]',
  (s) => s.options[s.selectedIndex].textContent,
);
console.log('tras elegir →', despues);
await pag.screenshot({ path: 'docs/evidencia/routing-campana-elegida.png' });

await navegador.close();
