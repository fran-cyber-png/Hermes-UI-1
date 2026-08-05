import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada } from "../db/reparto.js";
import { intereses } from "../db/schema.js";
import { consultarRadar } from "../cola/consultarRadar.js";
import { contarPorEtapaEfectiva } from "../cola/consultarCola.js";
import { soloMisClavesSql } from "./personal.js";
import { sql } from "drizzle-orm";

/**
 * EL DASHBOARD PERSONAL, CONTRA UNA BASE DE VERDAD.
 *
 * La regla de quién es supervisor está testeada pura en `personal.test.ts`. Lo
 * que solo se puede ver con base es lo otro: que el recorte **efectivamente
 * recorte** las cinco consultas del Dashboard, y que no recorte de más.
 *
 * Los dos defectos que este archivo existe para atrapar son mudos:
 *   · un recorte que no recorta (la fuga que el frente vino a cerrar), y
 *   · un recorte que se come lo propio por una diferencia de mayúsculas — el
 *     `Luz`/`luz` que ya vive en producción.
 */

const BOT = "51984429504";

/** Un lead que escribió a la línea del bot, con dueño o sin él. */
async function llega(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  personaId: string,
  duena: string | null,
) {
  await sembrarMensaje(db, { personaId, personaNombre: `Lead ${personaId}`, numeroPropio: BOT });
  const clave = `conv:whatsapp:${personaId}:${BOT}`;
  if (duena) {
    await db
      .insert(conversacionAsignada)
      .values({ clave, vendedoraId: duena, numeroPropio: BOT, asignadaPor: "test" });
  }
  return clave;
}

test("el radar acotado devuelve SOLO las conversaciones de esa vendedora", async (t) => {
  const db = await baseDePrueba(t);
  await llega(db, "51900000001", "ana");
  await llega(db, "51900000002", "ana");
  await llega(db, "51900000003", "beto");
  await llega(db, "51900000004", null); // sin dueño

  const deAna = await consultarRadar(db, new Date(), "ana");
  const todo = await consultarRadar(db, new Date(), null);

  assert.deepEqual(
    deAna.map((c) => c.persona_id).sort(),
    ["51900000001", "51900000002"],
  );
  assert.equal(todo.length, 4, "sin recorte se sirve todo, como siempre");
});

/**
 * 🔴 ESTRICTO QUIERE DECIR ESTRICTO. Lo que no tiene dueño NO aparece — y hay
 * que fijarlo con un test porque es la mitad cara de la decisión: medido en VPS1
 * el 5-ago-2026, 130 de las 213 conversaciones del radar no tienen dueño. La
 * premisa es que el supervisor las asigna; hasta que lo haga, esas 130 solo se
 * ven desde el Dashboard del supervisor.
 */
test("lo que NO tiene dueño no aparece en el radar de nadie acotado", async (t) => {
  const db = await baseDePrueba(t);
  await llega(db, "51900000004", null);

  const deAna = await consultarRadar(db, new Date(), "ana");

  assert.equal(deAna.length, 0);
});

/**
 * Los comentarios de FB/IG se caen enteros y no es un olvido: su clave es
 * `int:<id>` y el reparto asigna `conv:…`, así que no hay forma de que sean de
 * alguien. Se fija acá para que quien lo lea después sepa que fue una decisión.
 */
test("un comentario de FB/IG no puede ser de nadie: no entra al radar acotado", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { canal: "facebook", tipo: "comentario", personaId: "fb-1" });
  await llega(db, "51900000001", "ana");

  const deAna = await consultarRadar(db, new Date(), "ana");
  const todo = await consultarRadar(db, new Date(), null);

  assert.deepEqual(deAna.map((c) => c.fuente), ["chat"]);
  assert.equal(
    todo.filter((c) => c.fuente === "comentario").length,
    1,
    "sin recorte el comentario sigue estando",
  );
});

/**
 * 🔴 EL DEFECTO MUDO DEL REPARTO, otra vez. Cerberus empuja `Luz` y ella entra
 * como `luz`: con comparación exacta, sus 78 conversaciones son invisibles para
 * ella misma y la pantalla no tiene forma de decirlo — se ve como «no me
 * asignaron nada». Lo que reabre el agujero es normalizar de UN lado.
 */
test("la grafía del vendedora_id no le esconde a nadie lo suyo", async (t) => {
  const db = await baseDePrueba(t);
  await llega(db, "51900000001", "Luz"); // como lo escribe Cerberus
  await llega(db, "51900000002", " LUZ "); // y con espacios, por las dudas

  const comoEntra = await consultarRadar(db, new Date(), "luz"); // como se tipea al entrar

  assert.equal(comoEntra.length, 2);
});

test("el embudo cuenta lo mismo que el radar sirve: solo lo asignado", async (t) => {
  const db = await baseDePrueba(t);
  await llega(db, "51900000001", "ana");
  await llega(db, "51900000002", "beto");
  await llega(db, "51900000003", null);

  const deAna = await contarPorEtapaEfectiva(db, "ana");
  const todo = await contarPorEtapaEfectiva(db, null);

  const sumar = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0);
  assert.equal(sumar(deAna), 1, "una sola conversación es de ana");
  assert.equal(sumar(todo), 3, "sin recorte, las tres");
});

/**
 * `intereses` se cuelga de la clave de la conversación, así que «qué piden» usa
 * el MISMO recorte y no una segunda definición. El test cruza las dos cosas: si
 * alguien escribiera otro criterio acá, el cuadro diría un curso que el radar no
 * puede mostrar.
 */
test("«qué piden» se recorta por la misma clave que el radar", async (t) => {
  const db = await baseDePrueba(t);
  const deAna = await llega(db, "51900000001", "ana");
  const deBeto = await llega(db, "51900000002", "beto");
  await db.insert(intereses).values([
    { clave: deAna, curso: "Gestión Pública", vendedoraId: "ana" },
    { clave: deBeto, curso: "Inteligencia", vendedoraId: "beto" },
  ]);

  const filas = await db.execute<{ curso: string; n: number }>(sql`
    SELECT curso, count(*)::int AS n FROM intereses
    WHERE ${soloMisClavesSql(sql`clave`, "ana")}
    GROUP BY curso
  `);

  assert.deepEqual(filas.map((f) => f.curso), ["Gestión Pública"]);
});

/**
 * Fail-closed hasta el fondo: un recorte con la vendedora vacía no puede
 * degradar en «todas». Es el caso que no debería pasar nunca — y por eso mismo
 * el que nadie iría a mirar si un día pasa.
 */
test("un recorte con vendedora vacía no devuelve nada, jamás todo", async (t) => {
  const db = await baseDePrueba(t);
  await llega(db, "51900000001", "ana");

  const conVacio = await consultarRadar(db, new Date(), "");

  assert.equal(conVacio.length, 0);
});
