import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * EL DESGLOSE DEL EMBUDO — cómo se navegan 1.389 tarjetas sin mentir.
 *
 * Medido en producción el 2026-07-25: de 300 Contactadas muestreadas, 300 están
 * respondidas (Silencio); de 300 Interesadas, 0 (todas Deuda). O sea: la etapa
 * efectiva PARTE la cola por el turno, y las dos preguntas que quedan sin
 * responder en pantalla son otras:
 *
 *   · en la bandeja de Interesados — ¿a esta persona ya le hablamos alguna vez, o
 *     nadie le contestó nunca? Son dos trabajos distintos, y hoy el rótulo dice
 *     «nadie les respondió aún» para las dos. `ya_le_hablamos` los separa.
 *   · en Contactados — ¿a cuál de estos silencios ya le mandamos el precio? Esa
 *     es la cotización de hecho que la columna Cotizados no ve.
 *
 * El `desglose` cuenta las dos cosas de una pasada, con la MISMA definición y la
 * MISMA ventana que las tarjetas (la lección de #37: un universo, no tres).
 */

const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

type Fila = { persona_id: string | null; ya_le_hablamos: boolean };

/**
 * Cuatro conversaciones que cubren las dos preguntas: dos silencios (uno con
 * precio enviado), una que volvió a escribir después de que le contestamos, y
 * una a la que nadie le habló nunca.
 */
async function sembrarColumna(db: Parameters<typeof consultarCola>[0]) {
  // Silencio + precio enviado: la que debería estar en Cotizados y no está.
  await sembrarMensaje(db, { personaId: "silencio-precio", texto: "info?", occurredAt: hace(20) });
  await sembrarMensaje(db, {
    personaId: "silencio-precio",
    direccion: "saliente",
    texto: "*LINK DE PAGO* https://buy.stripe.com/abc",
    occurredAt: hace(19),
  });
  // Silencio sin precio: le contestamos el temario y no volvió.
  await sembrarMensaje(db, { personaId: "silencio-pelado", texto: "hola", occurredAt: hace(18) });
  await sembrarMensaje(db, {
    personaId: "silencio-pelado",
    direccion: "saliente",
    texto: "El diploma dura 3 semanas",
    occurredAt: hace(17),
  });
  // Volvió a escribir: la etapa efectiva la devuelve a Interesados, pero NO es
  // una desconocida — ya le hablamos.
  await sembrarMensaje(db, { personaId: "volvio", texto: "hola", occurredAt: hace(16) });
  await sembrarMensaje(db, { personaId: "volvio", direccion: "saliente", texto: "hola!", occurredAt: hace(15) });
  await sembrarMensaje(db, { personaId: "volvio", texto: "sigo interesada", occurredAt: hace(2) });
  // Nadie le contestó nunca.
  await sembrarMensaje(db, { personaId: "virgen", texto: "hola", occurredAt: hace(30) });
}

describe("ya_le_hablamos: la bandeja deja de decirle «nadie te respondió» a quien sí", () => {
  test("distingue a la que volvió a escribir de la que nadie contestó", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarColumna(db);

    const filas = (await consultarCola(db, { etapa: "interesado" })).conversaciones as Fila[];
    const por = new Map(filas.map((f) => [f.persona_id, f]));
    assert.equal(por.size, 2, "las dos caen en Interesados: la etapa efectiva las junta");
    assert.equal(por.get("volvio")?.ya_le_hablamos, true);
    assert.equal(por.get("virgen")?.ya_le_hablamos, false);
  });
});

describe("?precio= recorta las que ya tienen precio enviado", () => {
  test("trae solo esas, y el total no miente", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarColumna(db);

    const r = await consultarCola(db, { etapa: "contactado", precio: true });
    assert.deepEqual((r.conversaciones as Fila[]).map((f) => f.persona_id), ["silencio-precio"]);
    assert.equal(r.total, 1, "el «Ver más» de la columna filtrada cuenta lo filtrado");
  });
});

describe("el desglose: las bandas contadas de una pasada", () => {
  test("por etapa, por «ya le hablamos», por precio y por viva", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarColumna(db);

    const { desglose, conteos } = await consultarCola(db, {});
    assert.deepEqual(conteos, { contactado: 2, interesado: 2 }, "el contrato de #89 no se toca");

    const clave = (d: { etapa: string; yaLeHablamos: boolean; precio: boolean; viva: boolean }) =>
      `${d.etapa}/${d.yaLeHablamos ? "hablada" : "virgen"}/${d.precio ? "precio" : "-"}/${d.viva ? "viva" : "-"}`;
    const mapa = Object.fromEntries((desglose ?? []).map((d) => [clave(d), d.n]));
    assert.deepEqual(mapa, {
      "contactado/hablada/precio/-": 1, // silencio-precio
      "contactado/hablada/-/-": 1, // silencio-pelado
      "interesado/hablada/-/viva": 1, // volvió a escribir hace 2 h
      "interesado/virgen/-/-": 1, // nadie le contestó, y ya es vieja
    });
  });

  test("el desglose NO se recorta con el filtro de columna: es la foto entera", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarColumna(db);

    const r = await consultarCola(db, { etapa: "contactado", precio: true });
    const contactado = (r.desglose ?? []).filter((d) => d.etapa === "contactado");
    assert.equal(
      contactado.reduce((n, d) => n + d.n, 0),
      2,
      "las bandas siguen mostrando su tamaño real aunque la columna esté filtrada",
    );
  });

  test("las páginas siguientes no recuentan (como el total y los conteos)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarColumna(db);

    const r = await consultarCola(db, { offset: 2 });
    assert.equal(r.desglose, undefined);
  });
});
