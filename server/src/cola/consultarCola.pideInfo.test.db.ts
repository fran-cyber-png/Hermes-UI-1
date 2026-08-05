import assert from "node:assert/strict";
import test from "node:test";
import { baseDePrueba, type DbDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * «PIDEN INFO» = pidió algo **Y nadie le contestó**.
 *
 * El número que obligó el cambio, medido en producción el 5-ago-2026: el
 * predicado a secas daba **675** conversaciones y **647 (96 %) ya estaban
 * respondidas**. Un chip que ofrece 675 en una cola de 2.565 no ayuda a elegir a
 * quién atender: es la quinta parte de la mesa, y de cada 25 filas 24 son
 * trabajo hecho.
 *
 * Lo que estos tests fijan es la distinción que el arreglo introduce: **el HECHO
 * de la fila no cambió, el FILTRO se angostó**. Son dos preguntas distintas
 * sobre el mismo dato («¿qué dijo?» vs «¿a quién atiendo?»), y sólo la segunda
 * necesita saber si alguien ya contestó.
 */

const LINEA = "51984429504";
const T = (min: number) => new Date(Date.UTC(2026, 7, 5, 10, min));

/** Un hilo: una lista de `[direccion, texto]` en orden, un minuto entre cada uno. */
async function hilo(
  db: DbDePrueba,
  personaId: string,
  mensajes: readonly ["entrante" | "saliente", string][],
) {
  for (const [i, [direccion, texto]] of mensajes.entries()) {
    await sembrarMensaje(db, {
      canal: "whatsapp",
      personaId,
      numeroPropio: LINEA,
      direccion,
      texto,
      occurredAt: T(i),
    });
  }
}

test("pidió info y NADIE le contestó: entra", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000001", [["entrante", "hola, cuánto cuesta el diploma?"]]);
  const r = await consultarCola(db, { intencion: "pide-info" });
  assert.equal(r.total, 1);
});

test("🔴 pidió info y YA le contestaron: NO entra (los 647 del 96 %)", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000002", [
    ["entrante", "cuánto cuesta?"],
    ["saliente", "son 150 USD"],
  ]);
  const r = await consultarCola(db, { intencion: "pide-info" });
  assert.equal(r.total, 0, "trabajo hecho no es trabajo pendiente");
});

test("EL PREDICADO NO CAMBIÓ, sólo el filtro: la conversación sigue en la cola", async (t) => {
  // Angostar el PREDICADO en vez del filtro habría hecho que la fila dejara de
  // saber qué pidió esa persona, y el radar del Dashboard —que comparte el
  // fragmento `pideInfoAgrupadoSql`— habría cambiado con ella.
  const db = await baseDePrueba(t);
  await hilo(db, "51900000003", [
    ["entrante", "me pasás el temario?"],
    ["saliente", "ahí va"],
  ]);
  const sinFiltro = await consultarCola(db, {});
  assert.equal(sinFiltro.total, 1, "sigue en la cola: nada se escondió");
  assert.equal(sinFiltro.conteosFiltro?.pideInfo, 0, "pero no cuenta como trabajo pendiente");
});

test("volvió a escribir después de que le contestaron: vuelve a entrar", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000004", [
    ["entrante", "cuánto cuesta?"],
    ["saliente", "150 USD"],
    ["entrante", "y el temario?"],
  ]);
  const r = await consultarCola(db, { intencion: "pide-info" });
  assert.equal(r.total, 1, "la deuda se reabre con cada pregunta nueva");
});

test("sin responder PERO no pidió nada: no entra a «piden info»", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000005", [["entrante", "ok gracias"]]);
  assert.equal((await consultarCola(db, { intencion: "pide-info" })).total, 0);
  assert.equal(
    (await consultarCola(db, { intencion: "sin-responder" })).total,
    1,
    "sigue siendo deuda, pero de otra clase",
  );
});

test("«PIDEN INFO» ES UN SUBCONJUNTO ESTRICTO DE «SIN RESPONDER»", async (t) => {
  // La propiedad que hace legible la barra: de los que esperan, éstos pidieron
  // algo concreto. Si «piden info» superara a «sin responder», el orden de los
  // chips estaría mintiendo sobre la relación entre ellos.
  const db = await baseDePrueba(t);
  await hilo(db, "51900000101", [["entrante", "cuánto cuesta?"]]);
  await hilo(db, "51900000102", [["entrante", "me pasás info?"]]);
  await hilo(db, "51900000103", [["entrante", "ok gracias"]]);
  await hilo(db, "51900000104", [
    ["entrante", "cuánto cuesta?"],
    ["saliente", "ya te digo"],
  ]);
  await hilo(db, "51900000105", [
    ["entrante", "hola"],
    ["saliente", "hola!"],
  ]);

  const c = (await consultarCola(db, {})).conteosFiltro!;
  assert.equal(c.pideInfo, 2, "los dos que pidieron y esperan");
  assert.equal(c.sinResponder, 3, "más el que dijo «ok gracias»");
  assert.ok(c.pideInfo <= c.sinResponder, "el subconjunto no puede ser más grande");

  // Y el conteo del chip es EXACTAMENTE lo que el filtro devuelve (lección #37).
  assert.equal((await consultarCola(db, { intencion: "pide-info" })).total, c.pideInfo);
  assert.equal((await consultarCola(db, { intencion: "sin-responder" })).total, c.sinResponder);
});
