import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola } from "./consultarCola.js";

/**
 * LO QUE TIENE DUEÑA Y NO SOY YO, VA DESPUÉS.
 *
 * ── Lo que reportó Luz el 14-ago-2026 ───────────────────────────────────────
 *
 * «Veo otros chats y se quedan arriba, no puedo dar un buen seguimiento».
 * Medido: su línea (`51984429504`) tiene 1.158 conversaciones repartidas entre
 * seis personas, y el orden ponía `no_leido DESC` antes que todo lo demás. Un
 * chat **de otra vendedora**, viejo y con veinte mensajes sin leer que ella no
 * iba a contestar nunca, le tapaba sus propios leads del día — y cuanto más
 * abandonada la conversación ajena, más arriba quedaba.
 *
 * ── Lo que este test fija, y lo que NO ──────────────────────────────────────
 *
 * Fija que lo ajeno pierda contra lo propio y contra lo que no tiene dueño,
 * **aun teniendo más sin leer**. No fija que desaparezca: el reparto es un
 * filtro y no un permiso, así que la conversación ajena se sigue sirviendo —
 * abajo. Un test que la esperara ausente estaría pidiendo una frontera que
 * Hermes no tiene.
 */

const LINEA = "51984429504";
const YO = "luz";

async function asignar(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  telefono: string,
  aQuien: string,
) {
  await db.insert(conversacionAsignada).values({
    clave: `conv:whatsapp:${telefono}:${LINEA}`,
    numeroPropio: LINEA,
    vendedoraId: aQuien,
    motivo: "manual",
    asignadaPor: "test",
  });
}

/** Los nombres en el orden en que la cola los devuelve. */
async function orden(db: Awaited<ReturnType<typeof baseDePrueba>>, vendedoraId?: string) {
  const r = (await consultarCola(db, { vendedoraId, limite: 20 } as never)) as {
    conversaciones?: { persona_nombre: string | null }[];
  };
  return (r.conversaciones ?? []).map((c) => c.persona_nombre);
}

test("una conversación AJENA con más sin leer queda debajo de la mía", async (t) => {
  const db = await baseDePrueba(t);

  // La ajena tiene MÁS sin leer y es igual de vieja: con el orden anterior ganaba.
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "MIA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");
  await asignar(db, "51900000002", YO);

  const nombres = await orden(db, YO);
  assert.ok(
    nombres.indexOf("MIA") < nombres.indexOf("AJENA"),
    `la mía tiene que ir primero — salió: ${nombres.join(", ")}`,
  );
});

test("🔴 lo ajeno NO desaparece: sigue en la cola, abajo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, YO);
  assert.ok(nombres.includes("AJENA"), "el reparto es un filtro, no un permiso: se sigue sirviendo");
});

test("lo SIN DUEÑO no se castiga: es de quien lo agarre", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000003", personaNombre: "LIBRE", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, YO);
  assert.ok(
    nombres.indexOf("LIBRE") < nombres.indexOf("AJENA"),
    `sin dueño va antes que ajena — salió: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 EL CASO QUE ROMPE EL ARREGLO SI SE COMPARA DE UN SOLO LADO.
 *
 * En producción conviven `Luz` (lo empuja Cerberus a `numero_vendedora`) y
 * `luz` (lo que ella tipea al entrar, de donde sale el `vendedoraId`). Con
 * comparación exacta, sus propias conversaciones le aparecerían como ajenas y
 * el orden haría exactamente lo contrario de lo que promete.
 */
test("`Luz` y `luz` son la misma persona: su conversación no se le va al fondo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "MIA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");
  await asignar(db, "51900000002", "Luz"); // ← como lo escribe Cerberus

  const nombres = await orden(db, "luz"); // ← como entra ella
  assert.ok(
    nombres.indexOf("MIA") < nombres.indexOf("AJENA"),
    `se compara normalizando los dos lados — salió: ${nombres.join(", ")}`,
  );
});

test("sin vendedora (un servicio) el orden queda como antes: nada se reordena", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, undefined);
  assert.ok(nombres.includes("AJENA"), "sin identidad no hay «ajeno» que castigar");
});
