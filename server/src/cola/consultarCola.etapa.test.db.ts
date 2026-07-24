import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarGestion, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola, contarPorEtapaEfectiva } from "./consultarCola.js";

/**
 * EL FILTRO ?etapa= Y LOS CONTEOS REALES (#89) — el contrato que consume el
 * tablero (#90): pedir una etapa trae SOLO esa etapa (efectiva, ADR 0013), el
 * total de la primera página respeta el filtro (la carga incremental POR
 * columna es honesta), y los conteos del embudo salen del MISMO seam sobre la
 * MISMA ventana de 30 días. Acá muere la dualidad que hacía incomparable el
 * «N de M» del kanban.
 */

const NUMERO = "51999999999";
const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);
const claveDe = (personaId: string) => `conv:whatsapp:${personaId}:${NUMERO}`;

type Fila = { persona_id: string | null; etapa_efectiva: string };

/**
 * El conjunto del contrato: 2 interesadas (1 mensaje sin responder + 1
 * comentario nuevo), 3 contactadas (2 derivadas + 1 manual), 1 cotizada,
 * 1 perdida. Total: 7 dentro de la ventana.
 */
async function sembrarTablero(db: Parameters<typeof consultarCola>[0]) {
  await sembrarMensaje(db, { personaId: "p-int-1", occurredAt: hace(3) });
  await sembrarComentario(db, { personaId: "c-int-2", occurredAt: hace(4) });

  await sembrarMensaje(db, { personaId: "p-con-1", occurredAt: hace(6) });
  await sembrarMensaje(db, { personaId: "p-con-1", direccion: "saliente", occurredAt: hace(5) });
  await sembrarMensaje(db, { personaId: "p-con-2", occurredAt: hace(8) });
  await sembrarMensaje(db, { personaId: "p-con-2", direccion: "saliente", occurredAt: hace(7) });
  await sembrarMensaje(db, { personaId: "p-con-3", occurredAt: hace(9) });
  await sembrarGestion(db, { clave: claveDe("p-con-3"), etapa: "contactado" });

  await sembrarMensaje(db, { personaId: "p-cot-1", occurredAt: hace(10) });
  await sembrarGestion(db, { clave: claveDe("p-cot-1"), etapa: "cotizado" });

  await sembrarMensaje(db, { personaId: "p-per-1", occurredAt: hace(11) });
  await sembrarMensaje(db, { personaId: "p-per-1", direccion: "saliente", occurredAt: hace(10) });
  await sembrarGestion(db, { clave: claveDe("p-per-1"), etapa: "perdido" });
}

describe("?etapa= filtra por etapa EFECTIVA (#89)", () => {
  test("contactado trae las derivadas Y las manuales — y nada más", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const r = await consultarCola(db, { etapa: "contactado" });
    const personas = (r.conversaciones as Fila[]).map((f) => f.persona_id).sort();
    assert.deepEqual(personas, ["p-con-1", "p-con-2", "p-con-3"]);
    assert.equal(r.total, 3, "el total de la primera página respeta el filtro: la columna no miente");
  });

  test("el caso que hoy divergía: respondida sin gestión está en contactado y NO en interesado", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-resp", occurredAt: hace(5) });
    await sembrarMensaje(db, { personaId: "p-resp", direccion: "saliente", occurredAt: hace(1) });

    const contactadas = await consultarCola(db, { etapa: "contactado" });
    const interesadas = await consultarCola(db, { etapa: "interesado" });
    assert.equal((contactadas.conversaciones as Fila[])[0]?.persona_id, "p-resp");
    assert.equal(interesadas.conversaciones.length, 0);
    assert.equal(interesadas.total, 0);
  });

  test("interesado = sin gestión y sin responder (mensajes y comentarios)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const r = await consultarCola(db, { etapa: "interesado" });
    const personas = (r.conversaciones as Fila[]).map((f) => f.persona_id).sort();
    assert.deepEqual(personas, ["c-int-2", "p-int-1"]);
  });

  test("cotizado y perdido: la manual manda, el filtro la encuentra", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const cotizadas = (await consultarCola(db, { etapa: "cotizado" })).conversaciones as Fila[];
    const perdidas = (await consultarCola(db, { etapa: "perdido" })).conversaciones as Fila[];
    assert.deepEqual(cotizadas.map((f) => f.persona_id), ["p-cot-1"]);
    assert.deepEqual(perdidas.map((f) => f.persona_id), ["p-per-1"]);
  });

  test("la paginación por columna es honesta: limit/offset dentro de la etapa", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const pagina1 = await consultarCola(db, { etapa: "contactado", limit: 2, offset: 0 });
    assert.equal(pagina1.conversaciones.length, 2);
    assert.equal(pagina1.hayMas, true);
    const pagina2 = await consultarCola(db, { etapa: "contactado", limit: 2, offset: 2 });
    assert.equal(pagina2.conversaciones.length, 1, "traer más de Contactados trae CONTACTADOS, no el feed");
  });

  test("retrocompat: sin ?etapa= la cola devuelve todo, como siempre", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const r = await consultarCola(db, {});
    assert.equal(r.conversaciones.length, 7);
    assert.equal(r.total, 7);
  });
});

describe("los conteos reales por etapa — un solo universo (#89)", () => {
  test("la primera página trae los conteos del embudo sobre la misma ventana", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const r = await consultarCola(db, {});
    assert.deepEqual(r.conteos, { interesado: 2, contactado: 3, cotizado: 1, perdido: 1 });
  });

  test("las páginas siguientes no recuentan (como el total)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const r = await consultarCola(db, { offset: 2 });
    assert.equal(r.conteos, undefined);
  });

  test("contarPorEtapaEfectiva (el embudo del dashboard) dice LO MISMO que la cola", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarTablero(db);

    const embudo = await contarPorEtapaEfectiva(db);
    assert.deepEqual(embudo, { interesado: 2, contactado: 3, cotizado: 1, perdido: 1 });
  });

  test("el embudo respeta la ventana de 30 días: la historia vieja no infla los conteos", async (t) => {
    const db = await baseDePrueba(t);
    // Una conversación vieja CON gestión asentada: antes inflaba el embudo del
    // dashboard para siempre (contaba toda la historia de gestiones sin ventana).
    await sembrarMensaje(db, { personaId: "p-vieja", occurredAt: hace(45 * 24) });
    await sembrarGestion(db, { clave: claveDe("p-vieja"), etapa: "cotizado", creadoAt: hace(45 * 24) });
    await sembrarMensaje(db, { personaId: "p-hoy", occurredAt: hace(2) });

    const embudo = await contarPorEtapaEfectiva(db);
    assert.deepEqual(embudo, { interesado: 1 }, "solo cuenta lo que está en la ventana de la cola");
  });

  test("una gestión sobre una conversación en ventana cuenta aunque la gestión sea vieja", async (t) => {
    const db = await baseDePrueba(t);
    // La gestión no tiene ventana propia: la ventana es de la CONVERSACIÓN.
    await sembrarMensaje(db, { personaId: "p-viva", occurredAt: hace(2) });
    await sembrarGestion(db, { clave: claveDe("p-viva"), etapa: "cotizado", creadoAt: hace(40 * 24) });

    const embudo = await contarPorEtapaEfectiva(db);
    assert.deepEqual(embudo, { cotizado: 1 });
  });
});
