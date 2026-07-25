import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { baseDePrueba, type DbDePrueba } from '../pruebas/base.js';
import { sembrarMensaje } from '../pruebas/sembrar.js';
import { consultarCandidatos } from './candidatos.js';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';
import { correrEncolado } from './encolar.js';
import { diaLocal, proximoMomento } from './franja.js';
import { cancelarPorRespuestaHumana, repositorioDrizzle } from './repositorio.js';

/**
 * LA COLA CONTRA UNA POSTGRES DE VERDAD (ADR 0008).
 *
 * Lo que se prueba acá es lo que los tests puros no pueden: que el UNIQUE
 * impida la segunda auto-respuesta del día, que los techos se respeten cuando
 * los cuenta el SQL, que los estados transicionen, y que la consulta de
 * candidatos distinga a quien espera de quien ya fue atendido.
 *
 * EL RELOJ: se ancla al próximo 08:00 de Lima (fuera de la franja 9–20, dentro
 * de la ventana de despacho 7:30–9:00). Así el test no depende de la hora a la
 * que corra CI, y los mensajes sembrados caen dentro de la ventana de 3 días
 * que mira `consultarCandidatos`.
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

/** Las 08:00 de Lima más próximas: siempre fuera de horario y en ventana. */
const ahoraDePrueba = () => proximoMomento(new Date(), '08:00', cfg.zona);

/** Azar fijo: el mínimo del rango (60 s). Un plan reproducible. */
const azarFijo = () => 0;

const haceHoras = (ahora: Date, horas: number) => new Date(ahora.getTime() - horas * 3_600_000);

const NUMERO_PROPIO = '51999999999';
const clave = (telefono: string) => `conv:whatsapp:${telefono}:${NUMERO_PROPIO}`;

/** Deja el interruptor de la base encendido (la segunda llave). */
async function encender(db: DbDePrueba) {
  await repositorioDrizzle(db).fijarInterruptor(true, 'encendida por el test', 'test');
}

async function contarPendientes(db: DbDePrueba): Promise<number> {
  const [f] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM auto_respuestas_pendientes`,
  );
  return f.n;
}

test('no duplica: una conversación recibe UNA auto-respuesta por día, la garantiza el UNIQUE', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  await encender(db);

  await sembrarMensaje(db, {
    personaId: '51961506674',
    texto: 'hola, quiero información del diplomado',
    occurredAt: haceHoras(ahora, 2),
    numeroPropio: NUMERO_PROPIO,
  });

  const primera = await correrEncolado({ base: db, repo: repositorioDrizzle(db), cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });
  assert.equal(primera.encoladas, 1);
  assert.equal(await contarPendientes(db), 1);

  // Segunda corrida del encolado, mismos datos: la conversación ya tiene la suya.
  const segunda = await correrEncolado({ base: db, repo: repositorioDrizzle(db), cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });
  assert.equal(segunda.encoladas, 0, 'no se encola una segunda');
  assert.equal(await contarPendientes(db), 1, 'sigue habiendo UNA sola fila');

  // Y el descarte queda explicado: la decisión ya la ve como atendida hoy.
  assert.equal(segunda.plan?.descartadas[0]?.motivo, 'ya_recibio_hoy');

  // Escribir la fila a mano tampoco puede duplicarla: el UNIQUE es de la tabla.
  const repetida = await repositorioDrizzle(db).encolar({
    clave: clave('51961506674'),
    canal: 'whatsapp',
    telefono: '51961506674',
    numeroPropio: NUMERO_PROPIO,
    personaNombre: 'Ana',
    plantillaId: 'fuera-de-horario-primer-contacto',
    texto: 'otra',
    disparadaPor: ahora,
    programadoPara: ahora,
    diaLima: diaLocal(ahora, cfg.zona),
  });
  assert.equal(repetida, null, 'el UNIQUE (clave, dia_lima) la rebota');
  assert.equal(await contarPendientes(db), 1);
});

test('respeta los techos: lleno el de la hora, el resto queda postergado con motivo', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  await encender(db);

  for (let i = 0; i < 5; i++) {
    await sembrarMensaje(db, {
      personaId: `5196150000${i}`,
      texto: 'hola, info por favor',
      occurredAt: haceHoras(ahora, 2),
      numeroPropio: NUMERO_PROPIO,
    });
  }

  const acotada: ConfigAutoRespuesta = { ...cfg, techoPorHora: 2, techoPorDia: 10 };
  const r = await correrEncolado({ base: db, repo: repositorioDrizzle(db), cfg: acotada, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  assert.equal(r.encoladas, 2, 'solo entran dos en la hora');
  assert.equal(r.postergadas, 3);
  assert.equal(await contarPendientes(db), 2);
});

test('las transiciones de estado quedan escritas: pendiente → enviada · cancelada · fallida', async (t) => {
  const db = await baseDePrueba(t);
  const repo = repositorioDrizzle(db);
  const ahora = ahoraDePrueba();
  const dia = diaLocal(ahora, cfg.zona);

  // Escalonadas: la más vieja tiene que salir primero, y eso se prueba.
  const nueva = (telefono: string, minutosAntes: number) => ({
    clave: clave(telefono),
    canal: 'whatsapp',
    telefono,
    numeroPropio: NUMERO_PROPIO,
    personaNombre: 'Ana',
    plantillaId: 'fuera-de-horario-primer-contacto',
    texto: 'Hola, gracias por escribirnos…',
    disparadaPor: haceHoras(ahora, 2),
    programadoPara: new Date(ahora.getTime() - minutosAntes * 60_000),
    diaLima: dia,
  });

  const a = await repo.encolar(nueva('51900000001', 3));
  const b = await repo.encolar(nueva('51900000002', 2));
  const c = await repo.encolar(nueva('51900000003', 1));
  assert.ok(a && b && c);

  // La más vieja vencida es la primera que sale.
  const proxima = await repo.proximaVencida(ahora);
  assert.equal(proxima?.id, a.id);

  await repo.marcarEnviada(a.id, 'WA-123', ahora);
  await repo.cancelar(b.id, 'la vendedora respondió');
  await repo.marcarFallida(c.id, 'el transporte no respondió');

  const filas = await repo.listarDelDia(dia);
  const porTelefono = Object.fromEntries(filas.map((f) => [f.telefono, f]));
  assert.equal(porTelefono['51900000001'].estado, 'enviada');
  assert.equal(porTelefono['51900000002'].estado, 'cancelada');
  assert.equal(porTelefono['51900000003'].estado, 'fallida');

  const [enviada] = await db.execute<{ id_externo: string; resuelto_at: Date }>(
    sql`SELECT id_externo, resuelto_at FROM auto_respuestas_pendientes WHERE telefono = '51900000001'`,
  );
  assert.equal(enviada.id_externo, 'WA-123', 'queda el puente con envios_wa y con la burbuja del hilo');
  assert.ok(enviada.resuelto_at, 'y la hora REAL, para comparar contra la programada');

  // Ya resueltas: no vuelven a salir.
  assert.equal(await repo.proximaVencida(ahora), null);
});

test('la respuesta humana cancela lo pendiente de ESA conversación y no toca las demás', async (t) => {
  const db = await baseDePrueba(t);
  const repo = repositorioDrizzle(db);
  const ahora = ahoraDePrueba();
  const dia = diaLocal(ahora, cfg.zona);

  const nueva = (telefono: string) => ({
    clave: clave(telefono),
    canal: 'whatsapp',
    telefono,
    numeroPropio: NUMERO_PROPIO,
    personaNombre: null,
    plantillaId: 'fuera-de-horario-seguimiento',
    texto: 'Hola, gracias por escribirnos…',
    disparadaPor: haceHoras(ahora, 2),
    programadoPara: ahora,
    diaLima: dia,
  });
  assert.ok(await repo.encolar(nueva('51900000001')));
  assert.ok(await repo.encolar(nueva('51900000002')));

  const canceladas = await cancelarPorRespuestaHumana(db, clave('51900000001'));
  assert.equal(canceladas, 1);

  const filas = await repo.listarDelDia(dia);
  const porTelefono = Object.fromEntries(filas.map((f) => [f.telefono, f]));
  assert.equal(porTelefono['51900000001'].estado, 'cancelada');
  assert.match(porTelefono['51900000001'].motivo ?? '', /respondió antes/);
  assert.equal(porTelefono['51900000002'].estado, 'pendiente');
});

test('«¿ya respondió alguien?» mira la conversación, no solo lo que salió por Hermes', async (t) => {
  const db = await baseDePrueba(t);
  const repo = repositorioDrizzle(db);
  const ahora = ahoraDePrueba();
  const disparo = haceHoras(ahora, 2);

  await sembrarMensaje(db, {
    personaId: '51961506674',
    texto: 'hola',
    occurredAt: disparo,
    numeroPropio: NUMERO_PROPIO,
  });

  const consulta = { canal: 'whatsapp', telefono: '51961506674', numeroPropio: NUMERO_PROPIO, desde: disparo };
  assert.equal(await repo.huboRespuestaHumana(consulta), false, 'todavía nadie contestó');

  // La vendedora contesta desde su teléfono: whatsmeow lo ingesta igual.
  await sembrarMensaje(db, {
    personaId: '51961506674',
    direccion: 'saliente',
    texto: 'hola! ahora te paso el temario',
    occurredAt: new Date(disparo.getTime() + 60_000),
    numeroPropio: NUMERO_PROPIO,
  });

  assert.equal(await repo.huboRespuestaHumana(consulta), true);
  // Un saliente de OTRO número propio no cuenta: es otra conversación.
  assert.equal(
    await repo.huboRespuestaHumana({ ...consulta, numeroPropio: '51988888888' }),
    false,
  );
});

test('los candidatos: el que espera entra, el ya respondido no', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  const dia = diaLocal(ahora, cfg.zona);

  // Espera: escribió y nadie contestó.
  await sembrarMensaje(db, {
    personaId: '51900000001',
    personaNombre: 'Ana',
    texto: 'hola, quiero el temario',
    occurredAt: haceHoras(ahora, 3),
    numeroPropio: NUMERO_PROPIO,
  });

  // Ya atendido: escribió y le contestaron después.
  await sembrarMensaje(db, {
    personaId: '51900000002',
    texto: 'hola',
    occurredAt: haceHoras(ahora, 3),
    numeroPropio: NUMERO_PROPIO,
  });
  await sembrarMensaje(db, {
    personaId: '51900000002',
    direccion: 'saliente',
    texto: 'te paso el temario',
    occurredAt: haceHoras(ahora, 2),
    numeroPropio: NUMERO_PROPIO,
  });

  const candidatas = await consultarCandidatos(db, dia);

  assert.equal(candidatas.length, 1, 'solo la que sigue esperando');
  const [c] = candidatas;
  assert.equal(c.telefono, '51900000001');
  assert.equal(c.clave, clave('51900000001'));
  assert.equal(c.personaNombre, 'Ana');
  assert.equal(c.numeroPropio, NUMERO_PROPIO);
  assert.equal(c.ultimoSalienteEn, null);
  assert.equal(c.salientes, 0, 'primer contacto');
  assert.equal(c.autoRespuestasHoy, 0);
  assert.deepEqual(c.textosDelCliente, ['hola, quiero el temario']);
});

test('el interruptor arranca apagado y guarda quién y por qué', async (t) => {
  const db = await baseDePrueba(t);
  const repo = repositorioDrizzle(db);

  const inicial = await repo.leerInterruptor();
  assert.equal(inicial.encendida, false, 'apagada por defecto, sin fila que la prenda');

  await repo.fijarInterruptor(true, 'simulacro revisado, la prendemos', 'estephano');
  const prendida = await repo.leerInterruptor();
  assert.equal(prendida.encendida, true);
  assert.equal(prendida.actualizadoPor, 'estephano');

  await repo.fijarInterruptor(false, 'freno automático: el número está suspendido', 'sistema');
  const frenada = await repo.leerInterruptor();
  assert.equal(frenada.encendida, false);
  assert.match(frenada.motivo ?? '', /suspendido/);

  // Es un singleton: nunca hay dos filas peleando.
  const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auto_respuesta_estado`);
  assert.equal(n, 1);
});

test('con el interruptor apagado, el encolado no escribe nada', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();

  await sembrarMensaje(db, {
    personaId: '51961506674',
    texto: 'hola',
    occurredAt: haceHoras(ahora, 2),
    numeroPropio: NUMERO_PROPIO,
  });

  const r = await correrEncolado({ base: db, repo: repositorioDrizzle(db), cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  assert.equal(r.corrio, false);
  assert.equal(await contarPendientes(db), 0);
});
