import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { baseDePrueba, type DbDePrueba } from '../pruebas/base.js';
import { sembrarInteres, sembrarLead, sembrarMensaje } from '../pruebas/sembrar.js';
import { repartirAprobadas } from './aprobar.js';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';
import { correrEncolado } from './encolar.js';
import { diaLocal, proximoMomento } from './franja.js';
import { cancelarPorRespuestaHumana, repositorioDrizzle } from './repositorio.js';

/**
 * EL MODO SUPERVISADO CONTRA UNA POSTGRES DE VERDAD (ADR 0016).
 *
 * Los tests puros ya fijan la máquina de estados, la caducidad y el reparto del
 * lote. Lo que solo se puede probar acá es el SQL: que en supervisada el
 * encolado escriba `preparada` y NO `pendiente`, que aprobar un lote deje las
 * horas espaciadas de verdad en la tabla, que descartar no deje huérfanos, y que
 * la campaña que eligió la plantilla quede guardada para que la bandeja agrupe.
 *
 * EL RELOJ: se ancla al próximo 08:00 de Lima (fuera de la franja 9–20, dentro
 * de la ventana de despacho 7:30–9:00), igual que `autorespuesta.test.db.ts`.
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

const ahoraDePrueba = () => proximoMomento(new Date(), '08:00', cfg.zona);
const azarFijo = () => 0; // el mínimo del rango: 60 s exactos entre envíos
const haceHoras = (ahora: Date, horas: number) => new Date(ahora.getTime() - horas * 3_600_000);

const NUMERO_PROPIO = '51999999999';

async function supervisar(db: DbDePrueba) {
  await repositorioDrizzle(db).fijarModo('supervisada', 'la puso en supervisada el test', 'test');
}

async function estados(db: DbDePrueba): Promise<Record<string, number>> {
  const filas = await db.execute<{ estado: string; n: number }>(
    sql`SELECT estado, count(*)::int AS n FROM auto_respuestas_pendientes GROUP BY estado`,
  );
  return Object.fromEntries(filas.map((f) => [f.estado, f.n]));
}

test('en supervisada el encolado PREPARA: nada queda listo para salir solo', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  await supervisar(db);

  for (const n of ['51961506674', '51961506675', '51961506676']) {
    await sembrarMensaje(db, { personaId: n, texto: 'hola, quiero información', occurredAt: haceHoras(ahora, 3), numeroPropio: NUMERO_PROPIO });
  }

  const r = await correrEncolado({ base: db, repo: repositorioDrizzle(db), cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  assert.equal(r.corrio, true);
  assert.equal(r.modo, 'supervisada');
  assert.equal(r.encoladas, 3);
  assert.deepEqual(await estados(db), { preparada: 3 }, 'ni una sola «pendiente»: sin OK no sale nada');
});

test('aprobar en lote encola con el espaciado correcto', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  const repo = repositorioDrizzle(db);
  await supervisar(db);

  for (let i = 0; i < 5; i++) {
    await sembrarMensaje(db, {
      personaId: `5196150000${i}`,
      texto: 'hola, quiero información',
      // Escalonados: el que más esperó tiene que salir primero.
      occurredAt: haceHoras(ahora, 5 - i),
      numeroPropio: NUMERO_PROPIO,
    });
  }
  await correrEncolado({ base: db, repo, cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  const esperando = await repo.listarEsperandoAprobacion();
  assert.equal(esperando.length, 5);

  // El lote entero, de un click — como lo hace la bandeja.
  const ocupadas = await repo.ocupacionDesde(diaLocal(ahora, cfg.zona));
  const reparto = repartirAprobadas(esperando, cfg, ahora, azarFijo, ocupadas);
  assert.equal(reparto.aprobadas.length, 5, 'las cinco entran');
  for (const a of reparto.aprobadas) {
    assert.equal(await repo.aprobar({ ...a, quien: 'ana', ahora }), true);
  }

  assert.deepEqual(await estados(db), { aprobada: 5 });

  const filas = await db.execute<{ programado_para: string; aprobada_por: string }>(
    sql`SELECT programado_para, aprobada_por FROM auto_respuestas_pendientes ORDER BY programado_para`,
  );
  const horas = filas.map((f) => new Date(f.programado_para).getTime());
  assert.equal(horas[0], ahora.getTime(), 'la primera sale ya');
  for (let i = 1; i < horas.length; i++) {
    const aire = (horas[i] - horas[i - 1]) / 1000;
    assert.ok(
      aire >= cfg.espaciadoSegundos[0] && aire <= cfg.espaciadoSegundos[1],
      `entre la ${i} y la ${i + 1} hay ${aire}s, fuera del rango configurado — el lote saldría como ráfaga`,
    );
  }
  assert.ok(filas.every((f) => f.aprobada_por === 'ana'), 'queda quién lo autorizó');
});

test('descartar no deja huérfanos: se cierran esas y NADA más', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  const repo = repositorioDrizzle(db);
  await supervisar(db);

  for (let i = 0; i < 4; i++) {
    await sembrarMensaje(db, { personaId: `5196150100${i}`, texto: 'hola', occurredAt: haceHoras(ahora, 3), numeroPropio: NUMERO_PROPIO });
  }
  await correrEncolado({ base: db, repo, cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  const esperando = await repo.listarEsperandoAprobacion();
  const descartadas = await repo.descartar([esperando[0].id, esperando[1].id], 'ana', 'la descartó la vendedora');

  assert.equal(descartadas, 2);
  assert.deepEqual(await estados(db), { descartada: 2, preparada: 2 }, 'las otras dos siguen esperando');

  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM auto_respuestas_pendientes WHERE estado = 'descartada' AND (motivo IS NULL OR resuelto_at IS NULL)`,
  );
  assert.equal(n, 0, 'una descartada siempre tiene motivo y hora: nada queda a medio cerrar');

  // Y descartar dos veces no revive ni vuelve a contar.
  assert.equal(await repo.descartar([esperando[0].id], 'ana', 'otra vez'), 0);

  // La bandeja ya no las ofrece.
  assert.deepEqual(
    (await repo.listarEsperandoAprobacion()).map((p) => p.id).sort(),
    [esperando[2].id, esperando[3].id].sort(),
  );
});

test('lo descartado no se vuelve a proponer en la misma corrida del día', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  const repo = repositorioDrizzle(db);
  await supervisar(db);

  await sembrarMensaje(db, { personaId: '51961506674', texto: 'hola', occurredAt: haceHoras(ahora, 3), numeroPropio: NUMERO_PROPIO });
  await correrEncolado({ base: db, repo, cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  const [una] = await repo.listarEsperandoAprobacion();
  await repo.descartar([una.id], 'ana', 'la descartó la vendedora');

  // Cinco minutos después corre el encolado otra vez, como en producción.
  const r = await correrEncolado({
    base: db,
    repo,
    cfg,
    ahora: () => new Date(ahora.getTime() + 5 * 60_000),
    azar: azarFijo,
    registrar: () => {},
  });

  assert.equal(r.encoladas, 0, 'no se le vuelve a preguntar lo mismo a la vendedora');
  assert.deepEqual(await estados(db), { descartada: 1 });
});

test('si la vendedora responde a mano, lo preparado se cancela solo', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  const repo = repositorioDrizzle(db);
  await supervisar(db);

  await sembrarMensaje(db, { personaId: '51961506674', texto: 'hola', occurredAt: haceHoras(ahora, 3), numeroPropio: NUMERO_PROPIO });
  await correrEncolado({ base: db, repo, cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  const [una] = await repo.listarEsperandoAprobacion();
  const canceladas = await cancelarPorRespuestaHumana(db, una.clave);

  assert.equal(canceladas, 1, 'aprobar el acuse ahora sería mandarle dos mensajes seguidos');
  assert.deepEqual(await estados(db), { cancelada: 1 });
  assert.deepEqual(await repo.listarEsperandoAprobacion(), []);
});

test('la campaña queda guardada, y con ella la plantilla que la nombra', async (t) => {
  const db = await baseDePrueba(t);
  const ahora = ahoraDePrueba();
  const repo = repositorioDrizzle(db);
  await supervisar(db);

  // Una con interés asentado, otra que solo llenó el formulario de otra campaña.
  await sembrarMensaje(db, { personaId: '51961506674', texto: 'hola', occurredAt: haceHoras(ahora, 3), numeroPropio: NUMERO_PROPIO });
  await sembrarInteres(db, { clave: `conv:whatsapp:51961506674:${NUMERO_PROPIO}`, curso: 'OSINT & SOCMINT' });

  await sembrarMensaje(db, { personaId: '51961506675', texto: 'hola', occurredAt: haceHoras(ahora, 3), numeroPropio: NUMERO_PROPIO });
  await sembrarLead(db, { phone: '+51 961 506 675', campaignName: '[JUL] INTELIGENCIA' });

  await correrEncolado({ base: db, repo, cfg, ahora: () => ahora, azar: azarFijo, registrar: () => {} });

  const filas = await db.execute<{ telefono: string; campana: string | null; plantilla_id: string; texto: string }>(
    sql`SELECT telefono, campana, plantilla_id, texto FROM auto_respuestas_pendientes ORDER BY telefono`,
  );

  assert.equal(filas[0].campana, 'OSINT y SOCMINT');
  assert.equal(filas[0].plantilla_id, 'fuera-de-horario-campana');
  assert.ok(filas[0].texto.includes('temario de OSINT y SOCMINT'), filas[0].texto);

  assert.equal(filas[1].campana, 'Inteligencia y Contrainteligencia', 'el curso sale del formulario que llenó');
  assert.ok(filas[1].texto.includes('inteligencia y contrainteligencia'), filas[1].texto);
});
