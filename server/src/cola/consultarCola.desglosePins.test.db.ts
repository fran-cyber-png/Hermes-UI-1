import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarEstadoConversacion, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * 🔴 LA COLA Y EL EMBUDO MIRAN DOS UNIVERSOS DISTINTOS, Y LA DIFERENCIA ES UNA SOLA.
 *
 * La cola sube las conversaciones FIJADAS aunque estén fuera de la ventana de 30
 * días (la banda de pin, #49). El desglose del embudo **no**: su foto es la de la
 * ventana, sin excepciones — si no, una fijada de hace medio año le sumaría uno a
 * la cuenta de alguna etapa para siempre.
 *
 * Antes eso se garantizaba rearmando el `todo` entero con `pins = null`: una
 * tercera pasada completa —1.193 ms medidos en producción— para excluir un puñado
 * de filas. Ahora los dos comparten la tabla temporal y el desglose se recorta con
 * `en_ventana`.
 *
 * **Este archivo existe para que ese atajo no se coma la diferencia.** Sin él, el
 * defecto sería invisible: la cola se vería idéntica y el número de una columna
 * del Pipeline estaría de más, sin error, sin log y sin fila rara que mirar.
 */

const VENDEDORA = "luz";
const LINEA = "51999999999";
const HACE_UN_ANO = new Date(Date.now() - 365 * 24 * 3600_000);
const HOY = new Date();

test("una conversación FIJADA y vieja sube a la cola pero NO entra al embudo", async (t) => {
  const db = await baseDePrueba(t);

  // La vieja: su último mensaje quedó muy afuera de la ventana. Sin el pin no
  // existiría para nadie.
  await sembrarMensaje(db, {
    personaId: "51900000001",
    numeroPropio: LINEA,
    occurredAt: HACE_UN_ANO,
    direccion: "entrante",
    texto: "hola, hace un año",
  });
  await sembrarEstadoConversacion(db, {
    vendedoraId: VENDEDORA,
    clave: `conv:whatsapp:51900000001:${LINEA}`,
    fijada: true,
  });

  // Y una de hoy, para que el embudo no dé vacío y el test pueda distinguir
  // «bien recortado» de «no devolvió nada».
  await sembrarMensaje(db, {
    personaId: "51900000002",
    numeroPropio: LINEA,
    occurredAt: HOY,
    direccion: "entrante",
    texto: "hola, hoy",
  });

  const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: VENDEDORA });

  const claves = (r.conversaciones as { clave: string }[]).map((c) => c.clave);
  assert.ok(
    claves.includes(`conv:whatsapp:51900000001:${LINEA}`),
    "la fijada vieja TIENE que estar en la cola: es lo que hace la banda de pin",
  );

  // El desglose es el del embudo: cuenta la de hoy y nada más.
  const total = (r.desglose ?? []).reduce((n, f) => n + f.n, 0);
  assert.equal(total, 1, "el embudo cuenta SOLO la de la ventana, no la fijada vieja");
});

/**
 * El gemelo, y el que atrapa el error opuesto: recortar de más. Una fijada que
 * ADEMÁS tiene mensajes de esta semana está en los dos universos, y perderla del
 * embudo sería restarle uno a una columna del Pipeline.
 */
test("una fijada que SÍ tiene mensajes en la ventana cuenta en los dos lados", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, {
    personaId: "51900000003",
    numeroPropio: LINEA,
    occurredAt: HACE_UN_ANO,
    direccion: "entrante",
    texto: "el primero, viejo",
  });
  await sembrarMensaje(db, {
    personaId: "51900000003",
    numeroPropio: LINEA,
    occurredAt: HOY,
    direccion: "entrante",
    texto: "y volvió hoy",
  });
  await sembrarEstadoConversacion(db, {
    vendedoraId: VENDEDORA,
    clave: `conv:whatsapp:51900000003:${LINEA}`,
    fijada: true,
  });

  const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: VENDEDORA });

  assert.equal(r.conversaciones.length, 1);
  assert.equal(
    (r.desglose ?? []).reduce((n, f) => n + f.n, 0),
    1,
    "está en la ventana por derecho propio: el recorte del embudo no la puede perder",
  );
});

/**
 * ⚠️ Y sin nada fijado los dos universos son el MISMO. Es el caso normal —hoy en
 * producción no hay una sola conversación fijada— y por eso importa que esté
 * escrito: si alguien mide el ahorro sin sembrar un pin, los dos caminos dan
 * igual y el atajo parece gratis en todos los casos.
 */
test("sin pins, la cola y el embudo cuentan lo mismo", async (t) => {
  const db = await baseDePrueba(t);

  for (const p of ["51900000004", "51900000005", "51900000006"]) {
    await sembrarMensaje(db, {
      personaId: p,
      numeroPropio: LINEA,
      occurredAt: HOY,
      direccion: "entrante",
      texto: "hola",
    });
  }

  const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: VENDEDORA });

  assert.equal(r.conversaciones.length, 3);
  assert.equal((r.desglose ?? []).reduce((n, f) => n + f.n, 0), 3);
});
