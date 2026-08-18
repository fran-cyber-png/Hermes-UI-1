import 'dotenv/config';
import { db } from '../db/client.js';
import {
  crearRemitente,
  desactivarRemitente,
  editarRemitente,
  listarRemitentes,
  type FilaRemitente,
} from '../correos/repositorio.js';
import { sinSaltos } from '../correos/remitente.js';
import { dominiosVerificados, ENV_DOMINIOS, puedeSerRemitente } from '../correos/verificado.js';

/**
 * LOS REMITENTES DE CORREO — `npm run correos:remitentes`.
 *
 * ══ 🔴 POR QUÉ EXISTE: EL DÍA DEL DEPLOY NO HAY PANTALLA ════════════════════
 *
 * D1 dice que los remitentes se administran desde una pantalla, y está bien: es
 * config del negocio y no del `.env`. Pero la pantalla y el server **no llegan
 * juntos** — el front sale por N4 y el server por N5, que es un botón (§Deploy).
 * En esa ventana la tabla está creada y vacía, `GET /estado` contesta
 * `sinRemitentes: true` y **no hay ninguna forma de cargar el primero**: la
 * pantalla de administración todavía no existe del otro lado.
 *
 * Sin este script esa ventana se destraba de una sola manera: un `INSERT` a mano
 * contra la base de producción. Y ahí pasa lo mismo que motivó `reparto:rueda` —
 * se escribe `escuela@gobena.us`, la fila queda **válida**, el selector la ofrece
 * y el defecto aparece en el 554 del primer envío, con un lead esperando. Peor
 * acá que allá: el `INSERT` a mano **se saltea `puedeSerRemitente`**, que es el
 * único control de dominio verificado que tiene el frente entero.
 *
 * ⚠️ **No reemplaza a la pantalla, y no debería crecer hasta parecerlo.** Es la
 * puerta de arranque y la de auditoría desde una sesión SSH, igual que
 * `reparto:rueda` convive con `/api/reparto`.
 *
 *   npm run correos:remitentes                                       ← ver (read-only)
 *   npm run correos:remitentes -- --alta escuela@goberna.us --nombre "Escuela Goberna"
 *   npm run correos:remitentes -- --alta … --nombre … --responder-a hola@goberna.us --aplicar
 *   npm run correos:remitentes -- --retirar 3 --aplicar
 *   npm run correos:remitentes -- --reactivar 3 --aplicar
 *
 * **Dry-run por default**, como todo script que escribe en esta casa
 * (`hechos:sembrar`, `reparto:rueda`, `clientes:sincronizar`, `campana`).
 */

function flag(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i < 0) return null;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith('--') ? valor : '';
}

const APLICAR = process.argv.includes('--aplicar');

/** El `--retirar 3` que no es un id. `null` = no lo pidieron; `NaN` = lo pidieron mal. */
function idDeFlag(nombre: string): number | null {
  const crudo = flag(nombre);
  if (crudo === null) return null;
  const n = Number(crudo);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

/**
 * LA FOTO. Es lo que corre sin flags y es la mitad que más se va a usar: un
 * remitente se mira justo cuando alguien pregunta «¿por qué salió con ese
 * nombre?», y para eso hace falta ver **los retirados también**.
 *
 * ⚠️ Imprime `responder_a` y si tiene firma **sin mostrar la firma entera**: en
 * una sesión SSH compartida el bloque de tres renglones tapa la tabla y lo que
 * se venía a mirar es el sobre, no el pie.
 */
function imprimir(filas: readonly FilaRemitente[]): void {
  if (filas.length === 0) {
    console.log('\nNo hay ningún remitente dado de alta.');
    console.log('Mientras esté así, Correos sale por el buzón de compatibilidad (`SMTP_FROM`)');
    console.log('y la respuesta del lead cae en un buzón que Hermes no lee — que es el agujero');
    console.log('que esta tabla vino a tapar. Dá de alta el primero con `--alta`.\n');
    return;
  }

  console.log(`\n${filas.length} remitente(s):\n`);
  for (const f of filas) {
    const estado = f.activo ? '  ' : '🚫';
    const responde = f.responderA ? ` · responde a ${f.responderA}` : '';
    const firma = f.firma ? ' · con firma' : '';
    console.log(`${estado} #${f.id}  ${f.nombre} <${f.direccion}>${responde}${firma}`);
    console.log(`      alta: ${f.creadoPor} · ${f.creadoAt.toISOString().slice(0, 10)}`);
  }
  console.log('');
}

/**
 * DAR DE ALTA.
 *
 * 🔴 **`puedeSerRemitente` se pregunta ANTES de escribir, igual que en la ruta, y
 * por el mismo motivo.** Es la razón entera por la que este script existe en vez
 * de un `INSERT`: SES contesta **554** a un `From` de un dominio que no verificó,
 * la fila mal cargada no se ve mal en ningún lado, y el defecto aparece días
 * después en el correo de otra persona. Acá hay alguien mirando la config; allá
 * hay un lead esperando una cotización.
 *
 * ⚠️ **Es la MISMA función que usa la ruta, no una copia.** Dos scripts que
 * decidan por su cuenta qué dominio vale son #37, y se notaría tarde: cuando la
 * pantalla rechace un alta que el script aceptó.
 */
async function alta(direccionCruda: string): Promise<void> {
  // Los tres van a una CABECERA, así que pasan por `sinSaltos`: un retorno de
  // carro adentro del nombre es inyección de cabeceras (ver `remitente.ts`). La
  // firma NO, que es cuerpo y tiene renglones a propósito.
  const direccion = sinSaltos(direccionCruda);
  const nombre = sinSaltos(flag('nombre') ?? '');
  const responderA = flag('responder-a');
  const firmaCruda = flag('firma');

  if (nombre === '') {
    console.error('\n🔴 Falta `--nombre "…"`: es lo que va a ver quien reciba el correo.\n');
    process.exitCode = 1;
    return;
  }

  const dominios = dominiosVerificados(process.env);
  if (!puedeSerRemitente(direccion, dominios)) {
    console.error(`\n🔴 «${direccion}» no puede ser remitente.`);
    console.error(`   Amazon SES sólo acepta: ${dominios.join(' · ')}`);
    console.error(`   (se configuran en \`${ENV_DOMINIOS}\`, y esa lista es una PROMESA sobre lo`);
    console.error('    que SES ya aceptó: agregarla acá sin verificar el dominio allá cambia el');
    console.error('    rechazo de ahora por un 554 en el primer envío.)\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\n${APLICAR ? 'Dando de alta' : 'DRY-RUN — se daría de alta'}:\n`);
  console.log(`   ${nombre} <${direccion}>`);
  console.log(`   responder a: ${responderA || '(el de quien escriba, si su usuario es un correo)'}`);
  console.log(`   firma: ${firmaCruda ? `${firmaCruda.split('\n').length} renglón(es)` : '(sin firma)'}`);

  if (!APLICAR) {
    console.log('\nAgregá `--aplicar` para escribirlo.\n');
    return;
  }

  const r = await crearRemitente(db, {
    direccion,
    nombre,
    responderA: responderA ? sinSaltos(responderA) : null,
    firma: firmaCruda ? firmaCruda.trim() : null,
    // 🔴 **La grafía queda como rastro, no como llave**: acá no hay sesión de
    // Cerberus de donde sacar un `vendedora_id`, y poner uno inventado ensuciaría
    // la única columna que dice quién configuró el canal. `script:` como prefijo
    // hace que la pantalla de administración muestre la verdad —«esto lo cargó
    // una consola»— en vez de atribuírselo a una persona que no lo hizo.
    creadoPor: `script:${process.env.USER ?? 'desconocido'}`,
  });

  if (!r.ok) {
    console.error('\n🔴 Ese buzón ya está dado de alta (las mayúsculas no lo hacen distinto:');
    console.error('   el índice va sobre `lower(direccion)`). Si no lo ves en la lista, está');
    console.error('   retirado — reactivalo con `--reactivar <id>` en vez de crearlo de nuevo.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ Alta #${r.remitente.id}.\n`);
}

/**
 * RETIRAR Y REACTIVAR.
 *
 * ⚠️ Retirar es **baja lógica** y por eso reactivar existe: con un `DELETE` los
 * correos que ya salieron por ese buzón se quedarían con un `remitente_id` que no
 * apunta a nada, y la auditoría perdería de dónde salió un correo viejo justo
 * cuando alguien pregunta por él.
 */
async function retirar(id: number, activo: boolean): Promise<void> {
  const filas = await listarRemitentes(db, { incluirInactivos: true });
  const fila = filas.find((f) => f.id === id);
  if (!fila) {
    console.error(`\n🔴 No hay ningún remitente #${id}.\n`);
    process.exitCode = 1;
    return;
  }

  const verbo = activo ? 'reactivar' : 'retirar';
  console.log(`\n${APLICAR ? `Vas a ${verbo}` : `DRY-RUN — se ${verbo}ía`}: ${fila.nombre} <${fila.direccion}>`);
  if (!activo) {
    console.log('   Lo que ya salió por él no cambia: la baja es lógica y se deshace con `--reactivar`.');
  }

  if (!APLICAR) {
    console.log('\nAgregá `--aplicar` para escribirlo.\n');
    return;
  }

  // Los dos caminos NO son simétricos a propósito: retirar tiene su propia
  // función —la que la ruta usa— y reactivar es un `PATCH` de `activo`. Escribir
  // acá un `update` propio para el primero sería una segunda implementación de la
  // baja lógica, que es exactamente lo que #37 cobra caro.
  if (activo) await editarRemitente(db, id, { activo: true });
  else await desactivarRemitente(db, id);

  console.log(`\n✅ #${id} ${activo ? 'reactivado' : 'retirado'}.\n`);
}

async function main(): Promise<void> {
  const direccion = flag('alta');
  const aRetirar = idDeFlag('retirar');
  const aReactivar = idDeFlag('reactivar');

  if (Number.isNaN(aRetirar) || Number.isNaN(aReactivar)) {
    console.error('\n🔴 `--retirar` y `--reactivar` esperan un id (el número que imprime la lista).\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n══ Remitentes de correo ═══════════════════════════════════════');
  console.log(`Dominios verificados en SES (${ENV_DOMINIOS}): ${dominiosVerificados(process.env).join(' · ')}`);

  if (direccion) {
    await alta(direccion);
  } else if (aRetirar !== null) {
    await retirar(aRetirar, false);
  } else if (aReactivar !== null) {
    await retirar(aReactivar, true);
  } else {
    // Sin flags: la foto, con los retirados incluidos. Es read-only por
    // construcción — mirar la config no puede cambiarla (mismo criterio que
    // `routing:refrescar`, que es POST justo para no mutar dentro de un GET).
    imprimir(await listarRemitentes(db, { incluirInactivos: true }));
  }
}

await main();
process.exit(process.exitCode ?? 0);
