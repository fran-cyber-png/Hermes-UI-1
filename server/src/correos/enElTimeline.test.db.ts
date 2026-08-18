import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseDePrueba } from '../pruebas/base.js';
import { guardarCorreo, type CorreoAGuardar } from './repositorio.js';
import { correosDelTimeline } from './enElTimeline.js';

/**
 * EL CORREO SE TIENE QUE VER EN EL TIMELINE DE SU CONVERSACIÓN (H7).
 *
 * ══ POR QUÉ ESTO NO LO PUEDE VER UN TEST PURO ═══════════════════════════════
 *
 * Lo que se afirma acá no es una regla: es **qué filas trae una consulta y qué
 * columnas trae de cada una**. Un test puro no tiene consulta que mirar, y el
 * defecto original tampoco era una función mal escrita — era que `correos.clave`
 * se escribía y no la leía nadie. Tres de los cuatro candados de abajo son
 * afirmaciones sobre SQL:
 *
 *   · 🔴 **Que `clave = NULL` no caiga en ningún timeline.** En SQL nada iguala a
 *     NULL, así que hoy sale gratis — pero las tres filas de producción son así
 *     (las tres son pruebas del 4 y el 6 de agosto), o sea que el día que alguien
 *     escriba un `COALESCE(clave, …)` o un `LIKE` para «hacerlo más flexible»,
 *     esas filas aparecen **en todas las conversaciones a la vez**.
 *   · 🔴 **Que el cuerpo no viaje.** Se afirma que la CLAVE no está en el objeto,
 *     no que valga `''`: con un `cuerpo: ''` el test pasaría igual y los datos
 *     habrían viajado lo mismo. Es el molde del candado de H4.
 *   · 🔴 **Que la degradación se dispare de verdad.** El `code` de Postgres no
 *     está en el error: drizzle lo envuelve y lo deja en `err.cause`. Se rompe la
 *     tabla de VERDAD; un mock del error lo habría dado por bueno con la forma
 *     equivocada, que es exactamente cómo pasa desapercibido.
 */

function correo(cambios: Partial<CorreoAGuardar> = {}): CorreoAGuardar {
  return {
    vendedoraId: 'Luz',
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio: son S/ 1.200 y se puede en dos cuotas.',
    clave: 'conv:whatsapp:51900000000:51984429504',
    estado: 'enviado',
    ...cambios,
  };
}

const ESTA = 'conv:whatsapp:51900000000:51984429504';
const OTRA = 'conv:whatsapp:51911111111:51984429504';

test('el correo aparece en el timeline de SU conversación y en el de ninguna otra', async (t) => {
  const db = await baseDePrueba(t);

  await guardarCorreo(db, correo({ clave: ESTA, asunto: 'Tu cotización' }));
  await guardarCorreo(db, correo({ clave: OTRA, asunto: 'Cotización de otra persona' }));

  const acá = await correosDelTimeline(db, ESTA);
  assert.equal(acá.length, 1, 'el correo de esta conversación tiene que estar');
  assert.equal(acá[0].asunto, 'Tu cotización');

  // El control que hace que el de arriba signifique algo: no es que traiga
  // «todos» y el primero coincida — el de la otra conversación NO está.
  const allá = await correosDelTimeline(db, OTRA);
  assert.equal(allá.length, 1);
  assert.equal(allá[0].asunto, 'Cotización de otra persona');
});

test('un correo con `clave` NULL no cae en NINGÚN timeline', async (t) => {
  const db = await baseDePrueba(t);

  // Las tres filas de producción son exactamente así. Un correo sin conversación
  // de origen no es de nadie: mostrarlo en una conversación sería afirmar que a
  // ESA persona le escribimos.
  await guardarCorreo(db, correo({ clave: null, asunto: 'test' }));

  assert.deepEqual(await correosDelTimeline(db, ESTA), []);
  assert.deepEqual(await correosDelTimeline(db, OTRA), []);
  // Y tampoco se lo pesca con la cadena vacía ni con nada que se le parezca.
  assert.deepEqual(await correosDelTimeline(db, ''), []);
  assert.deepEqual(await correosDelTimeline(db, 'null'), []);
});

test('el CUERPO no viaja en el timeline — se pide aparte, por `GET /api/correos/:id`', async (t) => {
  const db = await baseDePrueba(t);
  await guardarCorreo(
    db,
    correo({ clave: ESTA, cuerpo: 'la cotización con el precio que escribió otra vendedora' }),
  );

  const [fila] = await correosDelTimeline(db, ESTA);

  // No se compara el valor: se afirma que la clave NO ESTÁ. Es la diferencia
  // entre «no se dibuja» y «no viajó», y sólo la segunda es un recorte.
  assert.equal('cuerpo' in fila, false, 'el cuerpo no puede viajar en cada apertura de conversación');
  // El control: el renglón sirve para lo que existe, o sea que el candado de
  // arriba no está pasando por servir la nada.
  assert.equal(fila.asunto, 'Diploma en Gestión Pública');
  assert.equal(fila.para, 'lead@ejemplo.com');
  assert.equal(fila.vendedoraId, 'Luz', 'la grafía se sirve tal cual se guardó');
  assert.ok(fila.id > 0, 'el id es con lo que se pide el cuerpo');
});

test('un correo FALLIDO se ve, con su motivo — es el caso que más importa', async (t) => {
  const db = await baseDePrueba(t);

  await guardarCorreo(db, correo({ clave: ESTA, estado: 'enviado', asunto: 'el que salió' }));
  await guardarCorreo(
    db,
    correo({
      clave: ESTA,
      estado: 'fallido',
      motivo: '554 Email address is not verified',
      asunto: 'el que no salió',
    }),
  );

  const filas = await correosDelTimeline(db, ESTA);

  // 🔴 Esconder el fallido deja el mismo agujero de H7 con otra forma: la
  // vendedora cree que le escribió y el correo no está en ninguna parte — ni en
  // el timeline ni en la bandeja del lead.
  assert.equal(filas.length, 2);
  const fallido = filas.find((f) => f.estado === 'fallido');
  assert.ok(fallido, 'el correo que no salió tiene que verse');
  assert.equal(fallido.motivo, '554 Email address is not verified');
  // Y el que salió no inventa un motivo.
  assert.equal(filas.find((f) => f.estado === 'enviado')?.motivo, null);
});

test('el orden es del más nuevo al más viejo, y dos del mismo instante no se barajan', async (t) => {
  const db = await baseDePrueba(t);

  // ⚠️ El mismo `creado_at` a propósito: es lo que pasa cuando se manda dos veces
  // seguidas. Sin el desempate por `id`, la lista se reordena sola entre dos
  // refrescos y eso se lee como que salió algo dos veces.
  //
  // ⚠️ **Va como CADENA, no como `Date`.** Un `Date` adentro de un template de
  // postgres.js revienta con `ERR_INVALID_ARG_TYPE` («Received an instance of
  // Date») al serializar el parámetro — la misma cicatriz que tuvo el frente de
  // los ✓✓, donde un `Date` en un template mataba cada recibo. Acá el síntoma es
  // ruidoso; allá era mudo.
  const mismoInstante = '2026-08-17T15:00:00Z';
  const uno = await db.$client`
    INSERT INTO correos (vendedora_id, para, asunto, cuerpo, clave, estado, creado_at)
    VALUES ('Luz', 'lead@ejemplo.com', 'primero', 'x', ${ESTA}, 'enviado', ${mismoInstante})
    RETURNING id`;
  const dos = await db.$client`
    INSERT INTO correos (vendedora_id, para, asunto, cuerpo, clave, estado, creado_at)
    VALUES ('Luz', 'lead@ejemplo.com', 'segundo', 'x', ${ESTA}, 'enviado', ${mismoInstante})
    RETURNING id`;
  await db.$client`
    INSERT INTO correos (vendedora_id, para, asunto, cuerpo, clave, estado, creado_at)
    VALUES ('Luz', 'lead@ejemplo.com', 'viejo', 'x', ${ESTA}, 'enviado', '2026-08-01T09:00:00Z')`;

  const filas = await correosDelTimeline(db, ESTA);

  assert.deepEqual(
    filas.map((f) => f.asunto),
    ['segundo', 'primero', 'viejo'],
  );
  assert.ok(Number(dos[0].id) > Number(uno[0].id), 'el desempate es por id, y el mayor va primero');
});

test('sin la tabla, el timeline se arma como antes: lista vacía y log, nunca un 500', async (t) => {
  const db = await baseDePrueba(t);
  await guardarCorreo(db, correo({ clave: ESTA }));

  // Se rompe la tabla de VERDAD. El `code` de Postgres vive en `err.cause`, no en
  // el error que drizzle propaga: con la forma equivocada la degradación no se
  // dispara nunca y el panel derecho entero se cae con un 500 por un frente que
  // todavía no se desplegó.
  await db.execute(`DROP TABLE correos`);

  assert.deepEqual(await correosDelTimeline(db, ESTA), []);
});
