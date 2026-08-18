import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDePrueba } from '../pruebas/base.js';
import {
  conteosDeRitmo,
  crearRemitente,
  desactivarRemitente,
  editarRemitente,
  guardarCorreo,
  leerCorreo,
  leerRemitente,
  listarCorreos,
  listarRemitentes,
  type CorreoAGuardar,
} from './repositorio.js';

/**
 * EL SEAM DE CORREOS, CONTRA UNA BASE DE VERDAD.
 *
 * ══ POR QUÉ NO ALCANZAN LOS TESTS PUROS ═════════════════════════════════════
 *
 * Las cuatro reglas de este frente son puras y están testeadas hasta el hueso
 * (`destinatario` `remitente` `verificado` `ritmo`), y **ninguna de ellas puede
 * ver los tres defectos que este archivo fija**:
 *
 *   · 🔴 **Qué columnas viajan.** El agujero H4 —la lista mandaba el `cuerpo` de
 *     todos los correos del equipo— no es una regla mal escrita: es una consulta
 *     sin proyección. Un test puro no tiene consulta que mirar. Acá se afirma que
 *     la clave `cuerpo` **no está** en la fila que sale, que es la única forma de
 *     que alguien no «simplifique» esto de vuelta a un `select()` a secas.
 *   · 🔴 **Que la degradación se dispare.** El `code` de Postgres no está en el
 *     error: drizzle lo envuelve y lo deja en `err.cause`. Verificado acá abajo
 *     rompiendo la tabla de verdad — un mock del error lo habría dado por bueno
 *     con la forma equivocada, que es exactamente cómo pasa desapercibido.
 *   · 🔴 **Que el techo cuente los envíos de la propia persona.** `Luz` guardado
 *     y `luz` preguntando no da error: da cero, o sea un techo que no frena.
 *
 * Es la lección de `entrega/aplicarRecibo.test.db.ts`, que existe porque el
 * frente de los ✓✓ estuvo apagado en producción con todos sus tests puros en
 * verde.
 */

/** Lo mínimo para guardar un correo. Cada test cambia lo que le importa. */
function correo(cambios: Partial<CorreoAGuardar> = {}): CorreoAGuardar {
  return {
    vendedoraId: 'Luz',
    para: 'lead@ejemplo.com',
    asunto: 'Diploma en Gestión Pública',
    cuerpo: 'Hola, te paso el precio y las cuotas.',
    clave: 'conv:whatsapp:51900000000:51984429504',
    estado: 'enviado',
    ...cambios,
  };
}

test('la lista NO puede traer el cuerpo — es el agujero H4', async (t) => {
  const db = await baseDePrueba(t);
  await guardarCorreo(db, correo({ cuerpo: 'la cotización que escribió otra vendedora' }));

  const [fila] = await listarCorreos(db);

  // No se compara el valor: se afirma que la CLAVE no existe. Con `cuerpo: ''`
  // el test pasaría igual y los datos habrían viajado lo mismo.
  assert.equal('cuerpo' in fila, false, 'el cuerpo del correo de otra no puede viajar');
  assert.equal(fila.para, 'lead@ejemplo.com');
  assert.equal(fila.vendedoraId, 'Luz');
});

test('leerCorreo sí trae el cuerpo — la diferencia es que se PIDE', async (t) => {
  const db = await baseDePrueba(t);
  const guardado = await guardarCorreo(db, correo({ cuerpo: 'el texto completo' }));

  assert.equal((await leerCorreo(db, guardado.id))?.cuerpo, 'el texto completo');
  assert.equal(await leerCorreo(db, 999_999), null, 'un id que no está no tira: no está');
});

test('el sobre con el que salió se guarda y se sirve, copiado', async (t) => {
  const db = await baseDePrueba(t);
  const alta = await crearRemitente(db, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela Goberna',
    creadoPor: 'estephano',
  });
  assert.equal(alta.ok, true);
  const remitenteId = alta.ok ? alta.remitente.id : 0;

  await guardarCorreo(
    db,
    correo({
      remitenteId,
      desde: '"Luz · Escuela Goberna" <escuela@goberna.us>',
      responderA: 'ventas10@grupogoberna.com',
      idExterno: 'ses-0100018f',
    }),
  );

  // Se le cambia el nombre al remitente DESPUÉS de mandar: la auditoría tiene que
  // seguir diciendo con qué salió ese correo, no con qué saldría hoy.
  await editarRemitente(db, remitenteId, { nombre: 'Otra cosa' });

  const [fila] = await listarCorreos(db);
  assert.equal(fila.desde, '"Luz · Escuela Goberna" <escuela@goberna.us>');
  assert.equal(fila.responderA, 'ventas10@grupogoberna.com');
  assert.equal(fila.idExterno, 'ses-0100018f');
  assert.equal(fila.remitenteId, remitenteId);
});

test('dos direcciones que son el mismo buzón no entran dos veces', async (t) => {
  const db = await baseDePrueba(t);
  const primera = await crearRemitente(db, {
    direccion: 'Escuela@goberna.us',
    nombre: 'Escuela Goberna',
    creadoPor: 'estephano',
  });
  assert.equal(primera.ok, true);

  // El índice es sobre `lower(direccion)`: la segunda choca aunque no se escriba
  // igual, y tiene que llegar como «ya existe» y no como un 500.
  const segunda = await crearRemitente(db, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela (otra vez)',
    creadoPor: 'otra',
  });
  assert.deepEqual(segunda, { ok: false, motivo: 'ya_existe' });
  assert.equal((await listarRemitentes(db)).length, 1);
});

test('editar solo toca lo que vino, y retirar se puede deshacer', async (t) => {
  const db = await baseDePrueba(t);
  const alta = await crearRemitente(db, {
    direccion: 'escuela@goberna.us',
    nombre: 'Escuela Goberna',
    responderA: 'ventas@grupogoberna.com',
    firma: 'Equipo Escuela · goberna.us',
    creadoPor: 'estephano',
  });
  const id = alta.ok ? alta.remitente.id : 0;

  const editado = await editarRemitente(db, id, { nombre: 'Escuela' });
  assert.equal(editado?.nombre, 'Escuela');
  assert.equal(editado?.firma, 'Equipo Escuela · goberna.us', 'la firma no se toca sola');
  assert.equal(editado?.responderA, 'ventas@grupogoberna.com');

  // Mandarlo en `null` SÍ lo saca: es una decisión, no un silencio.
  assert.equal((await editarRemitente(db, id, { firma: null }))?.firma, null);

  // Sin cambios devuelve la fila: «no cambiaste nada» no es «no existe».
  assert.equal((await editarRemitente(db, id, {}))?.id, id);
  assert.equal(await editarRemitente(db, 999_999, { nombre: 'x' }), null);

  assert.equal(await desactivarRemitente(db, id), true);
  assert.equal(await desactivarRemitente(db, id), true, 'apagar dos veces es idempotente');
  assert.equal(await desactivarRemitente(db, 999_999), false);

  // Retirado no se puede elegir para mandar, y se ve igual que uno que no existe.
  assert.equal(await leerRemitente(db, id), null);
  assert.equal((await listarRemitentes(db)).length, 0);

  // Pero se sigue viendo para administrarlo, o apagar sería para siempre.
  assert.equal((await listarRemitentes(db, { incluirInactivos: true })).length, 1);
  assert.equal((await editarRemitente(db, id, { activo: true }))?.activo, true);
  assert.equal((await leerRemitente(db, id))?.direccion, 'escuela@goberna.us');
});

test('el techo cuenta los envíos de la persona aunque su grafía no coincida', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = new Date();
  await guardarCorreo(db, correo({ vendedoraId: 'Luz' }));

  // El mismo humano con dos grafías vivas (`Luz` en la fila, `luz` en el token).
  // Comparando exacto esto daría 0 y el techo no frenaría nunca.
  assert.deepEqual(await conteosDeRitmo(db, 'luz', ahora), { ultimaHora: 1, ultimoDia: 1 });
  assert.deepEqual(await conteosDeRitmo(db, ' LUZ ', ahora), { ultimaHora: 1, ultimoDia: 1 });
  assert.deepEqual(await conteosDeRitmo(db, 'sindy', ahora), { ultimaHora: 0, ultimoDia: 0 });
});

test('un correo que no salió no gasta cupo, y la ventana es rodante', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = new Date();
  await guardarCorreo(db, correo());
  await guardarCorreo(db, correo({ estado: 'fallido', motivo: 'SES lo rechazó' }));

  assert.deepEqual(
    await conteosDeRitmo(db, 'luz', ahora),
    { ultimaHora: 1, ultimoDia: 1 },
    'el fallido queda auditado pero no le come el cupo a nadie',
  );

  // Dos horas después el de recién ya salió de la ventana de la hora y sigue
  // adentro de la del día: son dos ventanas, no un balde de calendario.
  const enDosHoras = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);
  assert.deepEqual(await conteosDeRitmo(db, 'luz', enDosHoras), { ultimaHora: 0, ultimoDia: 1 });

  const enDosDias = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);
  assert.deepEqual(await conteosDeRitmo(db, 'luz', enDosDias), { ultimaHora: 0, ultimoDia: 0 });
});

test('sin la migración 0029 degrada hacia lo de antes, no hacia un 500', async (t) => {
  const db = await baseDePrueba(t);
  await guardarCorreo(db, correo({ desde: 'escuela@goberna.us' }));

  // Se rompe la base de verdad y no un mock: el `code` que dispara la
  // degradación no está en el error que llega, está en `err.cause` (drizzle
  // envuelve toda consulta fallida). Con un error inventado a mano, la forma
  // equivocada pasa el test y falla en producción.
  await db.execute(`DROP TABLE remitentes_correo`);
  assert.deepEqual(await listarRemitentes(db), [], 'sin remitentes no hay a quién elegir');

  await db.execute(`ALTER TABLE correos
    DROP COLUMN remitente_id, DROP COLUMN desde,
    DROP COLUMN responder_a, DROP COLUMN id_externo`);

  const [fila] = await listarCorreos(db);
  assert.equal(fila.para, 'lead@ejemplo.com', 'la lista sigue siendo la lista');
  assert.equal(fila.desde, null);
  assert.equal('cuerpo' in fila, false, 'degradada tampoco puede traer el cuerpo');
  assert.equal((await leerCorreo(db, fila.id))?.cuerpo, 'Hola, te paso el precio y las cuotas.');
});
