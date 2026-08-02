import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarCalificacionBot, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * EL LECTOR QUE `bot_calificaciones` NO TENÍA.
 *
 * El 1-ago-2026 el bot escaló tres conversaciones de leads que estaban por
 * comprar. Escalar lo silencia a propósito (`bot_pausas`, dos horas de gracia) y
 * escribe el hecho en una tabla que **nadie leía**: los tres se salvaron porque
 * el dueño estaba mirando la sala a mano.
 *
 * Va contra la base porque es SQL, y porque el defecto que hay que impedir es
 * silencioso en las dos direcciones: una columna que llega siempre en NULL se ve
 * igual que «el bot no dijo nada», y un filtro que no filtra se ve igual que uno
 * que sí salvo en el conteo.
 */

const LINEA = "51984429504"; // la del bot

type Fila = {
  clave: string;
  persona_nombre: string | null;
  bot_escalada: boolean;
  bot_temperatura: string | null;
  bot_motivo: string | null;
};

const claveDe = (telefono: string) => `conv:whatsapp:${telefono}:${LINEA}`;

/** Tres leads del día: uno escalado por cerrar, uno caliente sin escalar, uno que el bot no calificó. */
async function sembrarLaSala(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarMensaje(db, { personaId: "51900111", personaNombre: "Aries", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900222", personaNombre: "Mic", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900333", personaNombre: "Nadie", numeroPropio: LINEA });

  await sembrarCalificacionBot(db, {
    clave: claveDe("51900111"),
    temperatura: "caliente",
    motivo: "por_cerrar",
    escalada: true,
  });
  await sembrarCalificacionBot(db, {
    clave: claveDe("51900222"),
    temperatura: "caliente",
    motivo: "preguntó el precio y la forma de pago",
    escalada: false,
  });
}

test("el veredicto del bot viaja en la fila de la cola, no hay que abrir el chat", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaSala(db);

  const { conversaciones } = await consultarCola(db, {});
  const porNombre = new Map((conversaciones as Fila[]).map((c) => [c.persona_nombre, c]));

  assert.equal(porNombre.get("Aries")?.bot_escalada, true);
  assert.equal(porNombre.get("Aries")?.bot_motivo, "por_cerrar");
  assert.equal(porNombre.get("Aries")?.bot_temperatura, "caliente");

  assert.equal(porNombre.get("Mic")?.bot_escalada, false);
  assert.equal(porNombre.get("Mic")?.bot_temperatura, "caliente");
});

test("sin calificación, `bot_escalada` es false y la temperatura es NULL — nunca un invento", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaSala(db);

  const { conversaciones } = await consultarCola(db, {});
  const nadie = (conversaciones as Fila[]).find((c) => c.persona_nombre === "Nadie");
  // `null` en la temperatura es «el bot no dijo nada de esta», y el front lo lee
  // así: la ausencia de dato NO es «está fría». Mismo criterio que la marca de
  // ex-cliente (#133).
  assert.equal(nadie?.bot_temperatura, null);
  assert.equal(nadie?.bot_escalada, false);
});

test("el filtro «el bot pidió ayuda» trae SOLO las escaladas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaSala(db);

  const { conversaciones, total } = await consultarCola(db, { intencion: "bot-escalada" });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "Aries");
  assert.equal(total, 1);
});

test("el filtro «el bot la ve caliente» incluye a la escalada por cerrar: es las dos cosas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaSala(db);

  const { conversaciones } = await consultarCola(db, { intencion: "bot-caliente" });
  const nombres = (conversaciones as Fila[]).map((c) => c.persona_nombre).sort();
  assert.deepEqual(nombres, ["Aries", "Mic"]);
});

test("los conteos del chip son los MISMOS predicados que la página (lección de #37)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaSala(db);

  const { conteosFiltro } = await consultarCola(db, {});
  assert.equal(conteosFiltro?.botEscalada, 1);
  assert.equal(conteosFiltro?.botCaliente, 2);

  // Y lo que el chip promete es lo que el filtro entrega: si estas dos cifras se
  // separaran, el chip diría «2» y la cola mostraría otra cosa — que es
  // exactamente el defecto por el que los chips llevan su número.
  const escaladas = await consultarCola(db, { intencion: "bot-escalada" });
  assert.equal(escaladas.total, conteosFiltro?.botEscalada);
  const calientes = await consultarCola(db, { intencion: "bot-caliente" });
  assert.equal(calientes.total, conteosFiltro?.botCaliente);
});

test("el desglose del embudo también se recorta con el filtro del bot", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaSala(db);

  // El desglose nombra `bq` cuando el filtro del bot está puesto: sin el join en
  // esa consulta, esto ni compilaba en Postgres. Es el mismo motivo por el que
  // ya estaba el join al padrón.
  const { desglose } = await consultarCola(db, { intencion: "bot-escalada" });
  const n = (desglose ?? []).reduce((acc, f) => acc + f.n, 0);
  assert.equal(n, 1);
});

test("el orden de la cola NO cambia por una escalada", async (t) => {
  const db = await baseDePrueba(t);
  // La urgencia vive una vez (`cola/urgencia.ts` + `urgenciaSql.ts`) con su test
  // de paridad contra el radar. Una escalada se encuentra por el chip de filtro,
  // no empujando filas: meterle una séptima condición al orden sería la segunda
  // escritura que #37 dejó prohibida.
  await sembrarMensaje(db, {
    personaId: "51900111",
    personaNombre: "Vieja",
    numeroPropio: LINEA,
    occurredAt: new Date(Date.now() - 5 * 86_400_000),
  });
  await sembrarMensaje(db, { personaId: "51900222", personaNombre: "Nueva", numeroPropio: LINEA });
  await sembrarCalificacionBot(db, { clave: claveDe("51900111"), escalada: true, motivo: "por_cerrar" });

  const sinFiltro = (await consultarCola(db, {})).conversaciones as Fila[];
  const conFiltro = (await consultarCola(db, { intencion: "bot-caliente" })).conversaciones as Fila[];
  // La escalada de hace cinco días no se sube: sigue mandando la urgencia.
  assert.equal(sinFiltro[0].persona_nombre, "Nueva");
  // Y el filtro tampoco reordena: recorta.
  assert.equal(conFiltro.length, 0);
});
