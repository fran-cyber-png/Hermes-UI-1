import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { consultarCola } from "./consultarCola.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";

/**
 * 🔴 LA COLA DEGRADA, NUNCA TUMBA — con UNA tabla opcional ausente y con VARIAS.
 *
 * Este archivo existe porque la auditoría del 12-ago-2026 midió que con dos
 * tablas ausentes la cola **tiraba 500**: `mencionaTabla` miraba `err.message`,
 * que en drizzle es el SQL ENTERO y por lo tanto nombra todas las tablas de la
 * consulta. El loop apagaba banderas equivocadas, se quedaba sin ninguna y
 * explotaba — justo en el escenario para el que la degradación existe: la
 * ventana entre N4 y N5, cuando el código nuevo corre contra el schema viejo.
 */

const OPCIONALES = [
  "estado_conversacion",
  "clientes_padron",
  "bot_calificaciones",
  "conversacion_asignada",
  "curso_ruteo",
] as const;

type Db = Awaited<ReturnType<typeof baseDePrueba>>;

async function sinTablas(db: Db, tablas: readonly string[]) {
  for (const t of tablas) await db.execute(sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`));
}

async function unaConversacion(db: Db) {
  await sembrarMensaje(db, { personaId: "51900000001", direccion: "entrante", texto: "hola" });
}

for (const tabla of OPCIONALES) {
  test(`sin \`${tabla}\` la cola se sirve igual`, async (t) => {
    const db = await baseDePrueba(t);
    await unaConversacion(db);
    await sinTablas(db, [tabla]);

    const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: "luz" });
    assert.equal(r.conversaciones.length, 1, `con ${tabla} ausente igual hay que servir la fila`);
  });
}

/**
 * 🔴 EL CASO QUE ROMPÍA. Dos ausentes a la vez no es raro: es exactamente lo que
 * pasa cuando un deploy trae dos migraciones y todavía no se aplicó ninguna.
 */
test("🔴 con DOS tablas opcionales ausentes también degrada, no tira 500", async (t) => {
  const db = await baseDePrueba(t);
  await unaConversacion(db);
  await sinTablas(db, ["estado_conversacion", "clientes_padron"]);

  const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: "luz" });
  assert.equal(r.conversaciones.length, 1);
  assert.equal(r.sinEstado, true);
  assert.equal(r.sinPadron, true);
});

test("y con las CINCO ausentes sigue sirviendo la cola", async (t) => {
  const db = await baseDePrueba(t);
  await unaConversacion(db);
  await sinTablas(db, OPCIONALES);

  const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: "luz" });
  assert.equal(r.conversaciones.length, 1, "la cola es lo último que se puede caer");
});

/**
 * ⚠️ Y apaga LO QUE FALTA, no cualquier cosa: apagar de más sirve la cola sin el
 * dueño ni el veredicto del bot aunque esas tablas estén perfectas, y eso se ve
 * como datos que desaparecieron.
 */
test("apaga solo la bandera de la tabla que falta", async (t) => {
  const db = await baseDePrueba(t);
  await unaConversacion(db);
  await sinTablas(db, ["clientes_padron"]);

  const r = await consultarCola(db, { limit: 30, offset: 0, vendedoraId: "luz" });
  assert.equal(r.sinPadron, true);
  assert.equal(r.sinBot, undefined, "`bot_calificaciones` está: no hay que apagarla");
  assert.equal(r.sinAsignacion, undefined, "`conversacion_asignada` está");
  assert.equal(r.sinEstado, undefined, "`estado_conversacion` está");
});
