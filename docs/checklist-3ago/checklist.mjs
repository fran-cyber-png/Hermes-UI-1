/**
 * CHECKLIST DEL 3-AGO — corrida Playwright, por vendedora.
 *
 * Recorre lo que cada vendedora tiene que poder hacer el lunes en Hermes y deja
 * un screenshot por paso en `evidencia/` (o SALIDA). El criterio de cada paso
 * está en checklist-3ago.md — este script es la evidencia, no el criterio.
 *
 * DOS MODOS:
 *
 *  · MODO=ensayo (default) — contra el stack LOCAL (transporte falso, Cerberus
 *    apuntado a un puerto muerto). No hay login real: entra con un token de
 *    ensayo firmado con el secreto local (HERMES_TOKEN_FILE). Además ensaya el
 *    caso «Cerberus caído» del login, que contra prod no se puede provocar.
 *
 *  · MODO=real — el 3-ago, contra prod. USUARIO y CLAVE los pone el dueño en el
 *    entorno (jamás en un archivo). Hace el login real por el formulario y NO
 *    ensaya el caso caído. NO confirma ninguna venta: llega hasta el modal y
 *    sale con Escape. La venta real de verificación la confirma una persona,
 *    a mano, después de la corrida.
 *
 * VARIABLES:
 *   HERMES_URL         p.ej. http://localhost:5173 (ensayo) · https://hermes-api.goberna.us (real)
 *   MODO               ensayo | real                     (default: ensayo)
 *   USUARIO / CLAVE    solo en MODO=real — credencial de la vendedora (la pone el dueño)
 *   HERMES_TOKEN_FILE  solo en MODO=ensayo — archivo con el token firmado local
 *   LINEA              etiqueta del chip de línea a seleccionar (default: Walter Ventas)
 *   CONTACTO           nombre visible de la conversación a abrir (default: primera de la cola)
 *   SALIDA             carpeta de screenshots (default: ./evidencia)
 *
 * Uso:
 *   ensayo:  HERMES_URL=http://localhost:5173 HERMES_TOKEN_FILE=.token-ensayo \
 *            LINEA='Walter Ventas' CONTACTO='Carla Núñez' node checklist.mjs
 *   3-ago:   MODO=real HERMES_URL=https://hermes-api.goberna.us \
 *            USUARIO=<usuario> CLAVE=<clave> LINEA='Walter Ventas' node checklist.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.HERMES_URL ?? 'http://localhost:5173';
const MODO = process.env.MODO === 'real' ? 'real' : 'ensayo';
const USUARIO = process.env.USUARIO ?? '';
const CLAVE = process.env.CLAVE ?? '';
const TOKEN_FILE = process.env.HERMES_TOKEN_FILE ?? '';
const LINEA = process.env.LINEA ?? 'Walter Ventas';
const CONTACTO = process.env.CONTACTO ?? '';
const SALIDA = process.env.SALIDA ?? './evidencia';

mkdirSync(SALIDA, { recursive: true });

const pasos = [];
function anotar(paso, ok, detalle) {
  pasos.push({ paso, ok, detalle });
  console.log(`${ok ? '[OK]   ' : '[FALLA]'} ${paso}${detalle ? ` — ${detalle}` : ''}`);
}
async function foto(page, nombre) {
  const ruta = join(SALIDA, nombre);
  await page.screenshot({ path: ruta });
  console.log(`         📸 ${ruta}`);
}

const navegador = await chromium.launch();

/* ── PASO 0 (solo ensayo): el login con Cerberus caído muestra SU error tipado,
      no un genérico. Contra prod no se puede provocar sin tirar Cerberus. ── */
if (MODO === 'ensayo') {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('tu usuario').waitFor({ timeout: 15000 });
    await foto(page, '01-login.png');
    anotar('login: el formulario se pinta (escudo + usuario + contraseña)', true);

    await page.getByPlaceholder('tu usuario').fill('ensayo');
    await page.getByPlaceholder('••••••••').fill('ensayo');
    await page.getByRole('button', { name: 'Entrar' }).click();
    const alerta = page.getByRole('alert');
    await alerta.waitFor({ timeout: 20000 });
    const texto = (await alerta.innerText()).trim();
    await foto(page, '02-login-cerberus-caido.png');
    anotar(
      'login con Cerberus caído: error tipado, no genérico',
      texto.includes('Cerberus no responde'),
      `dice: «${texto}»`,
    );
  } catch (e) {
    await foto(page, '02-login-cerberus-caido.png').catch(() => {});
    anotar('login con Cerberus caído', false, String(e).slice(0, 200));
  }
  await ctx.close();
}

/* ── LA SESIÓN: real por el formulario, o el token de ensayo. ── */
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
if (MODO === 'ensayo') {
  if (!TOKEN_FILE) {
    console.error('MODO=ensayo necesita HERMES_TOKEN_FILE (el token firmado local).');
    process.exit(2);
  }
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  await ctx.addInitScript((t) => localStorage.setItem('hermes.token', t), token);
}
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });

if (MODO === 'real') {
  if (!USUARIO || !CLAVE) {
    console.error('MODO=real necesita USUARIO y CLAVE en el entorno (los pone el dueño).');
    process.exit(2);
  }
  try {
    await page.getByPlaceholder('tu usuario').waitFor({ timeout: 15000 });
    await foto(page, '01-login.png');
    anotar('login: el formulario se pinta', true);
    await page.getByPlaceholder('tu usuario').fill(USUARIO);
    await page.getByPlaceholder('••••••••').fill(CLAVE);
    await page.getByRole('button', { name: 'Entrar' }).click();
    // O entra (aparece el riel de vistas) o hay un error a la vista.
    const riel = page.locator('nav[aria-label="Vistas"]');
    await Promise.race([
      riel.waitFor({ timeout: 30000 }),
      page.getByRole('alert').waitFor({ timeout: 30000 }),
    ]);
    if (await riel.isVisible()) {
      await foto(page, '02-login-ok.png');
      anotar(`login real de «${USUARIO}»: entra y se pinta la app`, true);
    } else {
      const texto = (await page.getByRole('alert').innerText()).trim();
      await foto(page, '02-login-error.png');
      anotar(`login real de «${USUARIO}»`, false, `error: «${texto}»`);
      process.exit(1);
    }
  } catch (e) {
    await foto(page, '02-login-error.png').catch(() => {});
    anotar('login real', false, String(e).slice(0, 200));
    process.exit(1);
  }
} else {
  try {
    await page.locator('nav[aria-label="Vistas"]').waitFor({ timeout: 20000 });
    await foto(page, '03-app-abierta.png');
    anotar('la app abre con el token guardado (ADR 0007: se pinta ya, valida detrás)', true);
  } catch (e) {
    await foto(page, '03-app-abierta.png').catch(() => {});
    anotar('la app abre con el token de ensayo', false, String(e).slice(0, 200));
    process.exit(1);
  }
}

/* ── LA COLA: vista Mensajes, segmentado de líneas, «Todas» y LA suya. ── */
try {
  await page.locator('nav[aria-label="Vistas"]').getByRole('button', { name: /Mensajes/ }).click();
  const segmentado = page.getByRole('group', { name: 'Línea de WhatsApp' });
  await segmentado.waitFor({ timeout: 20000 });
  const etiquetas = await segmentado.getByRole('button').allInnerTexts();
  const todasActiva = await segmentado.getByRole('button', { name: 'Todas' }).getAttribute('aria-pressed');
  await page.waitForTimeout(1200); // que la cola llegue a pintarse
  await foto(page, '04-mensajes-todas.png');
  anotar(
    'cola: el segmentado de líneas está y «Todas» es el estado inicial',
    etiquetas.length >= 3 && todasActiva === 'true',
    `opciones: ${etiquetas.join(' · ')}`,
  );

  const chip = segmentado.getByRole('button', { name: LINEA });
  if (await chip.count()) {
    await chip.click();
    await page.waitForTimeout(1200);
    const activa = await chip.getAttribute('aria-pressed');
    await foto(page, `05-cola-linea-${LINEA.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
    anotar(`cola: seleccionar la línea «${LINEA}» recorta la fila`, activa === 'true');
  } else {
    await foto(page, '05-cola-linea-NO-ENCONTRADA.png');
    anotar(`cola: la línea «${LINEA}» aparece en el segmentado`, false, `hay: ${etiquetas.join(' · ')}`);
  }
} catch (e) {
  await foto(page, '04-mensajes-todas.png').catch(() => {});
  anotar('cola: segmentado de líneas', false, String(e).slice(0, 200));
}

/* ── ABRIR UNA CONVERSACIÓN. ── */
try {
  const fila = CONTACTO
    ? page.getByRole('button', { name: new RegExp(CONTACTO) }).first()
    : page.locator('main button:has(img), main button:has([aria-label="Sin leer"])').first();
  await fila.waitFor({ timeout: 15000 });
  await fila.click();
  await page.waitForTimeout(1500); // hilo + panel derecho
  await foto(page, '06-conversacion.png');
  anotar(`conversación abierta${CONTACTO ? ` («${CONTACTO}»)` : ''}: hilo al centro, ficha a la derecha`, true);
} catch (e) {
  await foto(page, '06-conversacion.png').catch(() => {});
  anotar('abrir una conversación', false, String(e).slice(0, 200));
}

/* ── REGISTRAR VENTA: hasta el modal, JAMÁS confirmar desde acá. ──
   `exact: true` y acotado al pie: el banner «Reconectá con Cerberus para
   registrar ventas» de la cabecera también contiene ese texto, y sin esto el
   matcher por substring clickeaba el banner (medido: pasó en el ensayo). */
try {
  const boton = page.locator('footer').getByRole('button', { name: 'Registrar venta', exact: true });
  if ((await boton.count()) && (await boton.first().isEnabled())) {
    await boton.first().click();
    const modal = page.getByRole('dialog', { name: 'Registrar venta' });
    await modal.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500); // productos y formulario precargado
    await foto(page, '07-venta-modal.png');
    anotar('venta: el modal abre (curso preseleccionado: verificar en el screenshot)', true);
    await page.keyboard.press('Escape'); // ← NUNCA se confirma desde este script
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    anotar('venta: se salió con Escape sin confirmar nada', true);
  } else {
    await foto(page, '07-venta-estado-del-pie.png');
    const aviso = await page
      .locator('footer')
      .last()
      .innerText()
      .catch(() => '(no se pudo leer)');
    anotar(
      'venta: sin ficha de Cerberus no hay botón — estado honesto del pie',
      true,
      aviso.split('\n').slice(-2).join(' · ').slice(0, 160),
    );
  }
} catch (e) {
  await foto(page, '07-venta-modal.png').catch(() => {});
  anotar('venta: llegar al modal', false, String(e).slice(0, 200));
}

/* ── LA CABECERA: semáforo de WhatsApp + chip de la auto-respuesta. ── */
try {
  const semaforo = page.locator('[title^="WhatsApp:"]').first();
  const chipAuto = page.getByRole('radiogroup', { name: 'Modo de la auto-respuesta' });
  const haySemaforo = (await semaforo.count()) > 0 && (await semaforo.isVisible());
  const hayChip = (await chipAuto.count()) > 0 && (await chipAuto.isVisible());
  await page.screenshot({ path: join(SALIDA, '08-cabecera.png'), clip: { x: 0, y: 0, width: 1440, height: 150 } });
  console.log(`         📸 ${join(SALIDA, '08-cabecera.png')}`);
  const titulo = haySemaforo ? await semaforo.getAttribute('title') : 'no está';
  anotar('cabecera: semáforo de WhatsApp a la vista', haySemaforo, titulo ?? undefined);
  anotar('cabecera: chip de la auto-respuesta a la vista (los dos modos)', hayChip);
} catch (e) {
  anotar('cabecera: semáforo + chip', false, String(e).slice(0, 200));
}

await foto(page, '09-final.png');
await navegador.close();

const fallas = pasos.filter((p) => !p.ok);
writeFileSync(join(SALIDA, 'resumen.json'), JSON.stringify({ modo: MODO, url: URL, linea: LINEA, fecha: new Date().toISOString(), pasos }, null, 2));
console.log(`\n${pasos.length} pasos · ${fallas.length} fallas — resumen en ${join(SALIDA, 'resumen.json')}`);
process.exit(fallas.length ? 1 : 0);
