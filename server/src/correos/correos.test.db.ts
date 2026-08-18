import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import postgres from 'postgres';
import { firmarSesion } from '../auth/sesion.js';
import { cargarRol } from '../equipo/cargarRol.js';
import { guardarAntiProd, TEMPLATE, URL_ADMIN, urlDeBase } from '../pruebas/base.js';

/**
 * LOS CANDADOS DE CORREOS **EN LA COSTURA** — la ruta de verdad, contra una base
 * de verdad.
 *
 * ══ POR QUÉ ESTE ARCHIVO EXISTE SI YA HAY UNO ══════════════════════════════
 *
 * `repositorio.test.db.ts` prueba el SEAM: le pasa su `db` a `listarCorreos`,
 * `conteosDeRitmo` y compañía. Acá se prueba lo único que ese archivo no puede
 * ver: **que la ruta USE el seam**. Y no es una precaución de manual — es
 * exactamente dónde vivían dos de los siete huecos medidos el 17-ago-2026:
 *
 *   · 🔴 **H4 no estaba en ninguna función: estaba en el handler.**
 *     `correosRouter.get('/')` hacía `db.select().from(correos)` a secas, o sea
 *     las nueve columnas —**el cuerpo de todos los correos del equipo**— al
 *     navegador de las nueve. No había seam que testear: el defecto ERA la
 *     costura. Un test que llame a `listarCorreos` y lo encuentre proyectado
 *     pasa en verde mientras el handler siga sirviendo la fila entera.
 *   · 🔴 **El ORDEN de las preguntas de `POST /enviar` es un contrato y sólo se
 *     puede interrogar acá.** Que el 429 del techo gane al 503 del SMTP no vive
 *     en `ritmo.ts` ni en `repositorio.ts`: vive en cuál `if` está primero.
 *
 * Es la lección de `routes/conversaciones.etapa.test.ts`: `?etapa=sin_respuesta`
 * contestaba 400 con los quince tests con base en verde, porque **todos llamaban
 * al seam directo y se salteaban la ruta**.
 *
 * ══ CÓMO SE CONECTA LA RUTA A UNA BASE DE TEST ═════════════════════════════
 *
 * 🔴 **`routes/correos.ts` importa el singleton `db`, y ese singleton se resuelve
 * AL IMPORTARSE** (`db/client.ts` lee `DATABASE_URL` en el cuerpo del módulo).
 * Por eso acá el orden es: crear la base, apuntar `DATABASE_URL` a ELLA, y recién
 * entonces `await import(...)` de la ruta. Con un `import` estático arriba, el
 * singleton ya estaría atado a otra base y este archivo sembraría de un lado y
 * leería del otro — un verde que no significa nada. Es el hueco declarado en
 * `routes/dashboard.test.db.ts`, cerrado por el único camino que hay.
 *
 * ⚠️ **Y por eso hay UNA sola base para el archivo entero**, no una por test como
 * `baseDePrueba`: el singleton no se puede re-apuntar entre tests. El aislamiento
 * lo da `limpiar()` (un TRUNCATE al empezar cada caso), y por eso los tests de
 * acá **no pueden correr en paralelo entre sí** — node:test los corre en serie
 * dentro de un archivo, que es de lo que esto depende.
 *
 * ⚠️ **Las variables de SMTP se BORRAN, y no es higiene: es la garantía de que
 * este archivo no le manda un correo a nadie.** Si la máquina que corre los
 * tests tuviera `SMTP_HOST`/`USER`/`PASS` en el entorno, `POST /enviar` llegaría
 * al paso 7 y `sendMail` saldría a la red con las credenciales de SES de
 * producción. Un test que manda correos de verdad no se nota hasta que alguien
 * recibe uno.
 */

// ── El andamio: base propia, y el singleton apuntado a ella ANTES de importar ─

guardarAntiProd(URL_ADMIN);

const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
const NOMBRE_BASE = `t_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
await admin.unsafe(`CREATE DATABASE "${NOMBRE_BASE}" TEMPLATE ${TEMPLATE}`);

process.env.DATABASE_URL = urlDeBase(NOMBRE_BASE);

// Sin canal no sale nada. Ver el ⚠️ de arriba: esto es una guarda, no una
// preferencia — y se hace antes de importar la ruta porque `transporte()` lee el
// entorno en cada request, así que dejarlo para un `t.before` sería una carrera.
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;

const { db } = await import('../db/client.js');
const { correosRouter } = await import('../routes/correos.js');
const { crearRemitente, desactivarRemitente, guardarCorreo, listarRemitentes } = await import(
  './repositorio.js'
);

const app = express();
app.use(express.json());
/**
 * ⚠️ **El rol lo anota `cargarRol`, no lo lee el handler** (§Los roles). Se monta
 * con un lector que dice «la tabla no está» —el estado de producción hasta que la
 * migración 0028 se aplique—, y en ese estado la cascada cae a
 * `HERMES_SUPERVISORES`, que es lo que este archivo manipula. Sin este
 * middleware, `mandaEnElEquipo` daría falso siempre y los 403 saldrían por
 * omisión: verdes que no significan nada.
 */
app.use(cargarRol(async () => ({ estado: 'sin_tabla', fila: null }), process.env));
app.use('/api/correos', correosRouter);

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address() as AddressInfo;

after(async () => {
  server.close();
  await once(server, 'close');
  // El pool del singleton queda abierto: sin cerrarlo, el DROP se cuelga y el
  // archivo entero se queda sin summary (y en N2b el runner de VPS1 es uno solo).
  await db.$client.end({ timeout: 5 });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${NOMBRE_BASE}" WITH (FORCE)`);
  await admin.end({ timeout: 5 });
});

// ── Helpers ────────────────────────────────────────────────────────────────

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

async function pedir(
  metodo: 'GET' | 'POST',
  camino: string,
  quien: string,
  cuerpo?: unknown,
): Promise<Respuesta> {
  const resp = await fetch(`http://127.0.0.1:${port}/api/correos${camino}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${firmarSesion(quien)}`,
      ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: resp.status, json };
}

/** Cuántas filas quedaron en `correos`. Lo que un 400 no puede haber escrito. */
async function cuantosCorreos(): Promise<number> {
  const filas = await db.$client<{ n: string }[]>`SELECT count(*)::text AS n FROM correos`;
  return Number(filas[0]?.n ?? 0);
}

/**
 * El aislamiento entre casos. Ver el ⚠️ de arriba: acá no hay un clon del
 * template por test, así que la base se vacía a mano al empezar cada uno.
 */
async function limpiar(): Promise<void> {
  await db.$client`TRUNCATE correos RESTART IDENTITY`;
  await db.$client`TRUNCATE remitentes_correo RESTART IDENTITY`;
  delete process.env.HERMES_SUPERVISORES;
}

const VENDEDORA = 'luz';
const SUPERVISOR = 'ventas10@grupogoberna.com';

// ════════════════════════════════════════════════════════════════════════════
// LA AUDITORÍA — H4, en el handler donde vivía
// ════════════════════════════════════════════════════════════════════════════

test('GET /api/correos NO manda el cuerpo — el agujero H4 vivía en este handler', async () => {
  await limpiar();
  await guardarCorreo(db, {
    vendedoraId: 'Sindy',
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'la cotización que escribió OTRA vendedora',
    clave: null,
    estado: 'enviado',
  });

  const r = await pedir('GET', '/', VENDEDORA);
  const correos = r.json?.correos as Record<string, unknown>[];

  assert.equal(r.status, 200);
  assert.equal(correos.length, 1);
  // No se compara el valor: se afirma que la CLAVE no está. Con `cuerpo: ''` el
  // test pasaría igual y los datos habrían viajado lo mismo.
  assert.equal('cuerpo' in correos[0], false, 'el cuerpo de un correo ajeno no puede viajar');
  // Y el control: la lista SÍ sirve para lo que existe —a quién y cuándo—, o sea
  // que el candado de arriba no está pasando por servir la nada.
  assert.equal(correos[0].para, 'lead@ejemplo.com');
  assert.equal(correos[0].vendedoraId, 'Sindy');

  // ⚠️ Sigue sin `WHERE vendedora_id`, a propósito: la lista se mira para no
  // escribirle dos veces a la misma persona. Lo que cambió con H4 no es a quién
  // se le muestra, es QUÉ — y este assert lo deja escrito.
  assert.equal(correos[0].vendedoraId, 'Sindy', 'la lista es del equipo, no de quien la pide');
});

test('GET /api/correos/:id sí trae el cuerpo — la diferencia es que se PIDE', async () => {
  await limpiar();
  const guardado = await guardarCorreo(db, {
    vendedoraId: VENDEDORA,
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'el texto completo, con el precio adentro',
    clave: 'conv:whatsapp:51900000000:51984429504',
    estado: 'enviado',
  });

  const uno = await pedir('GET', `/${guardado.id}`, VENDEDORA);
  assert.equal(uno.status, 200);
  assert.equal(
    (uno.json?.correo as Record<string, unknown>).cuerpo,
    'el texto completo, con el precio adentro',
  );

  // 🔴 `/remitentes` se declara ANTES que `/:id` y por eso no cae acá. Con el
  // orden invertido, `GET /api/correos/remitentes` entraría por este handler con
  // `id = "remitentes"` y contestaría 400 sobre una ruta que existe.
  const noEsId = await pedir('GET', '/remitentes', SUPERVISOR);
  assert.notEqual(noEsId.status, 400, '`/remitentes` no puede resolverse como un id');

  assert.equal((await pedir('GET', '/999999', VENDEDORA)).status, 404);
  assert.equal((await pedir('GET', '/lo-que-sea', VENDEDORA)).status, 400);
});

// ════════════════════════════════════════════════════════════════════════════
// «NADA MASIVO» — H3, cruzando la ruta
// ════════════════════════════════════════════════════════════════════════════

test('POST /enviar: dos direcciones en «Para» se frenan ANTES de tocar nada', async () => {
  await limpiar();

  const r = await pedir('POST', '/enviar', VENDEDORA, {
    // 🔴 Hasta este frente esta cadena SALÍA: nodemailer la parte en DOS
    // destinatarios (verificado contra el addressparser instalado) y la tabla
    // guardaba UNA fila con la cadena entera. O sea que «nada masivo» era una
    // frase de la pantalla y la auditoría mentía sobre a cuánta gente le llegó.
    para: 'a@b.com, c@d.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio.',
  });

  assert.equal(r.status, 400);
  assert.equal(r.json?.codigo, 'destinatario');
  // El motivo viaja aparte del texto: la pantalla ramifica por él, y colapsar los
  // cuatro en una frase deja a quien escribió `Ana <ana@x.com>` buscando una coma.
  assert.equal(r.json?.motivo, 'varios');

  // Un rechazo de forma NO deja fila: la fila `fallido` es para lo que el
  // proveedor rechazó, no para lo que nunca se intentó mandar.
  assert.equal(await cuantosCorreos(), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// EL TECHO — que sea una propiedad del código, y que gane la carrera de orden
// ════════════════════════════════════════════════════════════════════════════

test('POST /enviar: el techo cuenta los envíos de la persona aunque su grafía no coincida', async () => {
  await limpiar();

  // 🔴 El mismo humano con dos grafías vivas en producción: `Luz` es lo que
  // empuja Cerberus y `luz` lo que ella tipea al entrar (de donde sale el
  // `vendedoraId` del token). Comparando exacto esto no da error: da CERO, o sea
  // un techo que no frena nunca — que es la definición de teatro.
  for (let i = 0; i < 20; i += 1) {
    await guardarCorreo(db, {
      vendedoraId: 'Luz',
      para: `lead${i}@ejemplo.com`,
      asunto: 'Diploma en Gestión Pública',
      cuerpo: 'Hola, te paso el precio.',
      clave: null,
      estado: 'enviado',
    });
  }

  const r = await pedir('POST', '/enviar', 'luz', {
    para: 'otro@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio.',
  });

  assert.equal(r.status, 429);
  assert.equal(r.json?.codigo, 'techo_de_ritmo');
  // El motivo dice CUÁNDO se destraba: con «60 por día» la vendedora se espera
  // hasta mañana cuando lo que la libera es el próximo cambio de hora.
  assert.equal(r.json?.motivo, 'techo_hora');
  assert.equal(r.json?.usado, 20);

  // 🔴 **Y ACÁ ESTÁ EL CANDADO DEL ORDEN, que ningún test puro puede escribir.**
  // Este entorno no tiene SMTP configurado, así que si el paso del ritmo se
  // moviera después del paso del canal, la respuesta sería **503
  // `smtp_no_configurado`** — «es un paso de sistemas, no algo que hayas hecho
  // mal»— y la vendedora saldría a pedirle a otro que arregle un servidor que
  // está bien. El 429 ganando es lo que hace que el mensaje sea cierto.
  assert.notEqual(r.json?.codigo, 'smtp_no_configurado');

  assert.equal(await cuantosCorreos(), 20, 'un envío frenado no se audita como intento');
});

// ════════════════════════════════════════════════════════════════════════════
// EL SOBRE — retirar un remitente lo retira DE VERDAD
// ════════════════════════════════════════════════════════════════════════════

test('POST /enviar: un remitente retirado no se puede usar, y se distingue del que no existe', async () => {
  await limpiar();
  const alta = await crearRemitente(db, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela Goberna',
    creadoPor: SUPERVISOR,
  });
  assert.equal(alta.ok, true);
  const id = alta.ok ? alta.remitente.id : 0;
  assert.equal(await desactivarRemitente(db, id), true);

  // 🔴 Para el ENVÍO los dos casos son el mismo `null` (`leerRemitente` filtra
  // por `activo`), y eso es lo correcto: un buzón apagado no manda. Lo que la
  // ruta agrega es la EXPLICACIÓN, y son opuestas — «lo borraron» se arregla
  // eligiendo otro, «lo apagaron» se arregla volviéndolo a prender. Con un solo
  // 404 para los dos, quien retiró el buzón busca un remitente que sí está.
  const retirado = await pedir('POST', '/enviar', VENDEDORA, {
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio.',
    remitenteId: id,
  });
  assert.equal(retirado.status, 409);
  assert.equal(retirado.json?.codigo, 'remitente_retirado');

  const inexistente = await pedir('POST', '/enviar', VENDEDORA, {
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio.',
    remitenteId: 999_999,
  });
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.json?.codigo, 'remitente_desconocido');

  assert.equal(await cuantosCorreos(), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// EL ALTA — el 554 de SES se evita ACÁ o no se evita
// ════════════════════════════════════════════════════════════════════════════

test('POST /remitentes: un dominio sin verificar no llega a escribir fila', async () => {
  await limpiar();
  process.env.HERMES_SUPERVISORES = SUPERVISOR;

  // 🔴 `grupogoberna.com` **no está verificado en SES** (medido: el TXT
  // `_amazonses` existe para `goberna.us` y no para éste), y tres de los nueve
  // `vendedora_id` viven ahí — o sea que es el error que alguien va a cometer.
  // Un remitente mal dado de alta **no se ve mal en ningún lado**: la fila queda,
  // la pantalla lo lista, el selector lo ofrece, y el 554 aparece días después en
  // el correo de OTRA persona, con un lead esperando. Acá hay alguien mirando la
  // config; allá no hay nadie.
  const r = await pedir('POST', '/remitentes', SUPERVISOR, {
    direccion: 'ventas10@grupogoberna.com',
    nombre: 'Ventas',
  });

  assert.equal(r.status, 400);
  assert.equal(r.json?.codigo, 'dominio_no_verificado');
  assert.deepEqual(r.json?.dominios, ['goberna.us'], 'el mensaje enumera desde dónde SÍ se puede');
  assert.equal(
    (await listarRemitentes(db, { incluirInactivos: true })).length,
    0,
    'rechazado quiere decir que no quedó ni apagado',
  );

  // El control: con el dominio verificado el alta pasa. Sin esto, los tres
  // asserts de arriba no distinguen «la regla anda» de «el alta rechaza a todos».
  const bueno = await pedir('POST', '/remitentes', SUPERVISOR, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela Goberna',
  });
  assert.equal(bueno.status, 201);
  assert.equal((await listarRemitentes(db)).length, 1);
});

test('POST /remitentes: dos direcciones que son el mismo buzón chocan con un 409, no con un 500', async () => {
  await limpiar();
  process.env.HERMES_SUPERVISORES = SUPERVISOR;

  assert.equal(
    (await pedir('POST', '/remitentes', SUPERVISOR, {
      direccion: 'Escuela@goberna.us',
      nombre: 'Escuela Goberna',
    })).status,
    201,
  );

  // El índice va sobre `lower(direccion)`, así que la segunda choca aunque no se
  // escriba igual. 🔴 Y el 23505 no se puede dejar propagar: llegaría como «se
  // rompió» y la pantalla no tendría cómo explicar por qué rebotó algo que en la
  // lista **no aparece escrito igual**.
  const segunda = await pedir('POST', '/remitentes', SUPERVISOR, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela (otra vez)',
  });
  assert.equal(segunda.status, 409);
  assert.equal(segunda.json?.codigo, 'remitente_repetido');
  assert.equal((await listarRemitentes(db, { incluirInactivos: true })).length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// LA PUERTA — los remitentes los administra quien manda
// ════════════════════════════════════════════════════════════════════════════

test('las cuatro rutas de remitentes son 403 para quien no manda, y la lista no viaja', async () => {
  await limpiar();
  process.env.HERMES_SUPERVISORES = SUPERVISOR;
  await crearRemitente(db, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela Goberna',
    responderA: 'ventas@grupogoberna.com',
    creadoPor: SUPERVISOR,
  });

  const ajeno = await pedir('GET', '/remitentes', VENDEDORA);
  assert.equal(ajeno.status, 403);
  assert.equal(ajeno.json?.codigo, 'no_es_supervisor');
  // Es un 403 y no una lista vacía, el molde del Dashboard (ADR 0036): «no te
  // toca» y «no hay» se ven igual en pantalla y se arreglan al revés.
  assert.equal('remitentes' in ajeno.json!, false);

  // ⚠️ Pero el composer de esa MISMA vendedora sí tiene que poder elegir con qué
  // sale: `GET /estado` no está detrás del 403, y sirve sólo los ACTIVOS y sólo
  // lo que hace falta para dibujar el sobre. Sin este control, el 403 de arriba
  // podría estar tapando la pantalla entera y nadie lo notaría hasta producción.
  const estado = await pedir('GET', '/estado', VENDEDORA);
  assert.equal(estado.status, 200);
  assert.equal(estado.json?.supervisor, false);
  assert.equal(estado.json?.sinRemitentes, false);
  const ofrecidos = estado.json?.remitentes as Record<string, unknown>[];
  assert.equal(ofrecidos.length, 1);
  // 🔴 Y `creadoPor` no viaja al composer: es rastro de administración. La lista
  // pública se enumera campo por campo justo para que una columna nueva del
  // schema **no nazca servida** a las nueve.
  assert.equal('creadoPor' in ofrecidos[0], false);
  assert.equal('activo' in ofrecidos[0], false);

  const supervisora = await pedir('GET', '/remitentes', SUPERVISOR);
  assert.equal(supervisora.status, 200);
  assert.equal((supervisora.json?.remitentes as unknown[]).length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// LO QUE NO ES UNA CADENA NO ES TEXTO — el argumento estaba escrito y contradicho
// ════════════════════════════════════════════════════════════════════════════

test('POST /enviar: un asunto que no es texto es «falta el asunto», no «[object Object]»', async () => {
  await limpiar();

  // 🔴 `para` chequeaba `typeof === 'string'` y traía el docblock que explica por
  // qué; cinco líneas más abajo, `asunto` y `cuerpo` hacían `String(x ?? '')`. Con
  // esto, `String({})` daba `"[object Object]"`: mide 15, no está vacío, pasa el
  // tope de 200 — y **al lead le llegaba un correo con ese asunto**. No hace falta
  // un atacante: un refactor del composer que mande un objeto donde antes mandaba
  // texto alcanza, y el server contestaba `ok: true`.
  const r = await pedir('POST', '/enviar', VENDEDORA, {
    para: 'lead@ejemplo.com',
    asunto: {},
    cuerpo: 'Hola, te paso el precio.',
  });

  assert.equal(r.status, 400);
  assert.equal(r.json?.codigo, 'asunto');
  assert.equal(r.json?.motivo, 'asunto_vacio');
  assert.equal(await cuantosCorreos(), 0, 'un rechazo de forma no deja fila');

  // Y el control que hace que esto signifique algo: un asunto de verdad no rebota.
  const bueno = await pedir('POST', '/enviar', VENDEDORA, {
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio.',
  });
  assert.notEqual(bueno.json?.codigo, 'asunto');
});

test('POST /enviar: un cuerpo que no es texto es «el correo no tiene texto»', async () => {
  await limpiar();

  const r = await pedir('POST', '/enviar', VENDEDORA, {
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    // Antes salía `"[object Object]"` como CUERPO del correo. El lead recibía eso.
    cuerpo: { texto: 'Hola' },
  });

  assert.equal(r.status, 400);
  assert.equal(r.json?.codigo, 'cuerpo');
  assert.equal(r.json?.motivo, 'cuerpo_vacio');
  assert.equal(await cuantosCorreos(), 0);

  // ⚠️ Y un número tampoco: `String(0)` es `"0"`, un cuerpo de un carácter que
  // pasa las dos guardas. Éste es el caso que el `?? ''` no atrapaba ni de casualidad.
  const cero = await pedir('POST', '/enviar', VENDEDORA, {
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 0,
  });
  assert.equal(cero.status, 400);
  assert.equal(cero.json?.motivo, 'cuerpo_vacio');
});
