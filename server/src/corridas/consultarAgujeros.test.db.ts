import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { botRespuestas } from "../db/bot.js";
import { consultarAgujeros, clasificarAgujero } from "./consultarAgujeros.js";

const LINEA = "51984429504";
const AHORA = new Date("2026-08-02T16:26:41Z");

/**
 * LOS AGUJEROS, contra una Postgres de verdad (#261).
 *
 * El caso que hace falta la base: **traer la PREGUNTA que quedó sin responder**.
 * El motivo de escalada solo dice que faltó un dato; sin la pregunta al lado, no
 * se puede saber CUÁL, y el agujero es imposible de tapar.
 */
test("trae la escalada con la pregunta que la causó", async (t) => {
  const db = await baseDePrueba(t);
  const tel = "51946497307";

  await sembrarMensaje(db, {
    personaId: tel,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "La primera conferencia internacional",
    occurredAt: new Date(AHORA.getTime() - 60_000),
  });
  await db.insert(botRespuestas).values({
    clave: `conv:whatsapp:${tel}:${LINEA}`,
    numeroPropio: LINEA,
    texto: "Entiendo que te interesa saber sobre la primera conferencia internacional. Ese dato no lo tengo.",
    estado: "enviada",
    acciones: [{ tipo: "escalar", motivo: "sin_respuesta_en_catalogo" }],
    creadoEn: AHORA,
  });

  const agujeros = await consultarAgujeros(db, LINEA);
  assert.equal(agujeros.length, 1);
  assert.equal(agujeros[0]!.pregunta, "La primera conferencia internacional");
  assert.equal(agujeros[0]!.clase, "no_supo");
});

test("una escalada por OTRO motivo no es un agujero del catálogo", async (t) => {
  const db = await baseDePrueba(t);
  const tel = "51925523001";
  await db.insert(botRespuestas).values({
    clave: `conv:whatsapp:${tel}:${LINEA}`,
    numeroPropio: LINEA,
    texto: "Te paso el link de pago.",
    estado: "enviada",
    // `por_cerrar` es una escalada SANA: el bot hizo su trabajo y pasa la venta.
    acciones: [{ tipo: "escalar", motivo: "por_cerrar" }],
    creadoEn: AHORA,
  });

  assert.deepEqual(await consultarAgujeros(db, LINEA), []);
});

test("las de OTRA línea no se mezclan", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(botRespuestas).values({
    clave: `conv:whatsapp:51900000000:51941654039`,
    numeroPropio: "51941654039",
    texto: "Ese dato no lo tengo.",
    estado: "enviada",
    acciones: [{ tipo: "escalar", motivo: "sin_respuesta_en_catalogo" }],
    creadoEn: AHORA,
  });

  assert.deepEqual(await consultarAgujeros(db, LINEA), []);
});

/**
 * La clasificación es pura y se testea sin base: son dos defectos DISTINTOS y
 * mezclarlos haría que alguien cargue un dato que ya estaba en el catálogo.
 */
describe("clasificarAgujero", () => {
  const base = { clave: "c", pregunta: "algo", cuando: AHORA };

  it("si solo acusa recibo, el dato FALTA", () => {
    assert.equal(
      clasificarAgujero({ ...base, respuesta: "Entiendo que te interesa saber eso." }).clase,
      "no_supo",
    );
    assert.equal(clasificarAgujero({ ...base, respuesta: null }).clase, "no_supo");
  });

  /**
   * El caso real del corpus: le preguntaron por horarios PRESENCIALES, el bot
   * contestó bien (que es 100% virtual) **y escaló igual**. Ahí no falta ningún
   * dato: sobra el escalado.
   */
  it("si contestó de verdad, el que sobra es el escalado", () => {
    assert.equal(
      clasificarAgujero({
        ...base,
        respuesta: "Te aclaro que el diplomado es 100% virtual: clases en vivo por Zoom.",
      }).clase,
      "supo_y_escalo",
    );
  });

  it("la lectura dice qué hacer, no solo qué pasó", () => {
    const a = clasificarAgujero({ ...base, respuesta: null });
    assert.match(a.lectura, /catálogo/);
  });
});
