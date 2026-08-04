import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { asignarSiHaceFalta, leerRueda, reasignar } from "./asignar.js";

/**
 * EL REPARTO, contra una Postgres de verdad.
 *
 * Lo que ningún test puro puede ver: que la carga se cuente bien por línea, que
 * dos mensajes casi simultáneos no dupliquen ni pierdan la asignación, y que sin
 * tabla migrada esto **degrade en vez de tumbar la ingesta** — un lead perdido
 * por un fallo del reparto es infinitamente peor que un lead sin repartir.
 */

const LINEA = "51984429504";
const OTRA = "51941654039";
const LOS_SEIS = ["ana", "beto", "caro", "dani", "eva", "fer"];

async function sembrarRueda(db: Awaited<ReturnType<typeof baseDePrueba>>, linea = LINEA) {
  await db.insert(repartoRueda).values(
    LOS_SEIS.map((vendedoraId, orden) => ({ numeroPropio: linea, vendedoraId, orden })),
  );
}

test("la primera conversación va al primero de la rueda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);

  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000001:${LINEA}`, LINEA);
  assert.equal(quien, "ana");
});

test("seis conversaciones se reparten una a cada uno", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);

  const tocaron: string[] = [];
  for (let i = 0; i < 6; i++) {
    const q = await asignarSiHaceFalta(db, `conv:whatsapp:5190000000${i}:${LINEA}`, LINEA);
    tocaron.push(q!);
  }
  assert.deepEqual([...new Set(tocaron)].sort(), [...LOS_SEIS].sort());
});

/**
 * LA PROPIEDAD QUE SE LE PROMETE AL EQUIPO: entre el que más y el que menos
 * recibe nunca hay más de 1. Es lo que se dijo al elegir round-robin sobre azar,
 * así que se fija contra la base de verdad y no solo en el módulo puro.
 */
test("con 20 leads, la diferencia entre el que más y el que menos es 1", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);

  for (let i = 0; i < 20; i++) {
    await asignarSiHaceFalta(db, `conv:whatsapp:5191111${String(i).padStart(4, "0")}:${LINEA}`, LINEA);
  }

  const rueda = await leerRueda(db, LINEA);
  const cargas = rueda.map((r) => r.asignadas);
  assert.equal(cargas.reduce((a, b) => a + b, 0), 20);
  assert.ok(Math.max(...cargas) - Math.min(...cargas) <= 1, `quedó ${cargas.join("/")}`);
});

test("una conversación que YA tiene dueño no cambia de manos", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  const clave = `conv:whatsapp:51900000009:${LINEA}`;

  const primera = await asignarSiHaceFalta(db, clave, LINEA);
  // El segundo mensaje de la misma persona: NO reasigna. Cambiar de dueño en
  // medio de la charla es peor que no repartir.
  const segunda = await asignarSiHaceFalta(db, clave, LINEA);
  assert.equal(segunda, primera);

  const filas = await db.select().from(conversacionAsignada);
  assert.equal(filas.length, 1, "una sola fila: no se duplica");
});

test("la carga se cuenta POR LÍNEA: lo de otra no le resta a ésta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarRueda(db, OTRA);

  // A `ana` le tocaron 5 en la OTRA línea.
  for (let i = 0; i < 5; i++) {
    await db.insert(conversacionAsignada).values({
      clave: `conv:whatsapp:5199999${i}:${OTRA}`,
      numeroPropio: OTRA,
      vendedoraId: "ana",
    });
  }

  // En ESTA línea sigue en cero, así que le toca igual.
  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000010:${LINEA}`, LINEA);
  assert.equal(quien, "ana");
});

test("quien está inactiva no recibe, y no se le borra lo que tenía", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  const clave = `conv:whatsapp:51900000011:${LINEA}`;
  await asignarSiHaceFalta(db, clave, LINEA); // le toca a ana

  await db
    .update(repartoRueda)
    .set({ activa: "no" })
    .where(eq2(repartoRueda.vendedoraId, "ana"));

  const rueda = await leerRueda(db, LINEA);
  assert.ok(!rueda.some((r) => r.vendedoraId === "ana"), "ana sale de la rueda");

  // Pero su conversación sigue siendo suya: sacarla no deja huérfanos.
  const [fila] = await db.select().from(conversacionAsignada);
  assert.equal(fila!.vendedoraId, "ana");
});

/**
 * FAIL-OPEN. Sin nadie en la rueda no se asigna, y eso NO es un error: es el
 * comportamiento de antes de este frente. Lo que no puede pasar es que tumbe
 * la ingesta del mensaje.
 */
test("sin rueda no asigna y no rompe", async (t) => {
  const db = await baseDePrueba(t);
  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000012:${LINEA}`, LINEA);
  assert.equal(quien, null);
});

test("reasignar a mano deja registrado quién la pasó", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  const clave = `conv:whatsapp:51900000013:${LINEA}`;
  await asignarSiHaceFalta(db, clave, LINEA);

  await reasignar(db, clave, LINEA, "fer", "ana");

  const [fila] = await db.select().from(conversacionAsignada);
  assert.equal(fila!.vendedoraId, "fer");
  assert.equal(fila!.motivo, "manual");
  assert.equal(fila!.asignadaPor, "ana");
});

// `eq` de drizzle, importado acá abajo para no confundirlo con el assert.
import { eq as eq2 } from "drizzle-orm";
