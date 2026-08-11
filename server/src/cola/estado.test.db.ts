import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { MAX_PINES, PinLleno, upsertEstado } from "./estado.js";

/**
 * EL ESTADO PERSONAL DE LA CONVERSACIÓN (#49) — el seam de escritura. Contra la
 * base porque el tope de pines y el upsert son SQL (harness #33).
 */

const clave = (p: string) => `conv:whatsapp:${p}:51999999999`;

test("el tope de pines: la 4ª conversación fijada da PinLleno", async (t) => {
  const db = await baseDePrueba(t);
  for (let i = 0; i < MAX_PINES; i++) {
    await upsertEstado(db, "ana", { clave: clave(`5190000000${i}`), fijada: true });
  }
  await assert.rejects(
    () => upsertEstado(db, "ana", { clave: clave("51900000099"), fijada: true }),
    PinLleno,
    "la 4ª tiene que rebotar con PinLleno (el router lo traduce a 409)",
  );
});

test("re-fijar una ya fijada NO cuenta contra el tope", async (t) => {
  const db = await baseDePrueba(t);
  for (let i = 0; i < MAX_PINES; i++) {
    await upsertEstado(db, "ana", { clave: clave(`5190000000${i}`), fijada: true });
  }
  // Re-fijar la primera (ya está en la banda) no suma: no debe rebotar.
  await assert.doesNotReject(() => upsertEstado(db, "ana", { clave: clave("51900000000"), fijada: true }));
});

test("desfijar libera un lugar en la banda", async (t) => {
  const db = await baseDePrueba(t);
  for (let i = 0; i < MAX_PINES; i++) {
    await upsertEstado(db, "ana", { clave: clave(`5190000000${i}`), fijada: true });
  }
  await upsertEstado(db, "ana", { clave: clave("51900000000"), fijada: false });
  // Con un lugar libre, fijar otra vuelve a entrar sin rebotar.
  await assert.doesNotReject(() => upsertEstado(db, "ana", { clave: clave("51900000099"), fijada: true }));
});

test("el estado es POR VENDEDORA: el tope de ana no toca a bruna", async (t) => {
  const db = await baseDePrueba(t);
  for (let i = 0; i < MAX_PINES; i++) {
    await upsertEstado(db, "ana", { clave: clave(`5190000000${i}`), fijada: true });
  }
  // Bruna arranca con su propia banda vacía: fija sin problema.
  await assert.doesNotReject(() => upsertEstado(db, "bruna", { clave: clave("51900000001"), fijada: true }));
});

test("upsert parcial: tocar favorita no borra el pin de la misma fila", async (t) => {
  const db = await baseDePrueba(t);
  const k = clave("51900000000");
  await upsertEstado(db, "ana", { clave: k, fijada: true });
  await upsertEstado(db, "ana", { clave: k, favorita: true });
  // Tras marcar favorita, el pin sigue puesto (upsert de un solo campo).
  const filas = (await db.execute(
    sql`SELECT fijada, favorita FROM estado_conversacion WHERE vendedora_id = 'ana' AND clave = ${k}`,
  )) as unknown as { fijada: boolean; favorita: boolean }[];
  assert.equal(filas[0].fijada, true);
  assert.equal(filas[0].favorita, true);
});

/**
 * EL ORDEN DE DEPLOY: el código sale antes de que alguien corra `db:push` (ADR
 * 0014). Sin esta degradación, la cola ENTERA responde 500 en esa ventana y la
 * vendedora se queda sin su mesa de trabajo por una tabla de comodidad.
 */
test("sin la tabla `estado_conversacion`, la cola SIGUE sirviendo (degradada, no 500)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900aaa", texto: "hola, quiero info" });
  await db.execute(sql`DROP TABLE estado_conversacion`);

  const r = await consultarCola(db, { vendedoraId: "ana" });
  assert.equal(r.conversaciones.length, 1, "la cola contesta igual: el trabajo pendiente se ve");
  assert.equal(r.sinEstado, true, "y lo dice en voz alta, no finge que nadie fijó nada");

  const fila = r.conversaciones[0] as { fijada: boolean; favorita: boolean; pregunto: boolean };
  assert.equal(fila.fijada, false, "sin estado personal: defaults, no explosión");
  assert.equal(fila.favorita, false);
  assert.equal(fila.pregunto, true, "lo que NO depende de la tabla sigue funcionando");
});

test("degradada, un tab personal no miente con «no hay nada»: devuelve la cola", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900bbb", texto: "hola" });
  await db.execute(sql`DROP TABLE estado_conversacion`);

  const r = await consultarCola(db, { vendedoraId: "ana", tab: "favoritos" });
  assert.equal(r.conversaciones.length, 1, "sin tabla no se puede saber qué es favorito: no filtra");
  assert.equal(r.sinEstado, true);
});
