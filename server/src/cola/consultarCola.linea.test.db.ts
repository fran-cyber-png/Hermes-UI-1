import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * EL RECORTE POR LÍNEA (#50) — la cola de UN número propio de Goberna.
 *
 * Existe porque el equipo dejó de vender por un solo número: la línea de la
 * Escuela y la de cada vendedora entran a la MISMA cola. Sin esto, la vendedora
 * nueva lee las conversaciones de la otra para llegar a las suyas.
 *
 * Va contra la base porque es SQL, y porque el defecto que hay que impedir es
 * silencioso: un filtro que no filtra no se ve distinto de uno que sí, salvo en
 * el conteo.
 */

const ESCUELA = "51986394450";
const WALTER = "51941654039";

type Fila = { clave: string; numero_propio: string | null; persona_nombre: string | null };

async function sembrarLasDosLineas(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarMensaje(db, { personaId: "51900111", personaNombre: "Marta", numeroPropio: ESCUELA });
  await sembrarMensaje(db, { personaId: "51900222", personaNombre: "Jorge", numeroPropio: ESCUELA });
  await sembrarMensaje(db, { personaId: "51900333", personaNombre: "Luis", numeroPropio: WALTER });
}

test("sin línea, la cola trae las dos — el comportamiento de cuando había una sola", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasDosLineas(db);

  const { conversaciones } = await consultarCola(db, {});
  assert.equal(conversaciones.length, 3);
});

test("con línea, la cola trae SOLO la de ese número propio", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasDosLineas(db);

  const { conversaciones } = await consultarCola(db, { linea: WALTER });
  assert.equal(conversaciones.length, 1);
  const fila = conversaciones[0] as Fila;
  assert.equal(fila.persona_nombre, "Luis");
  assert.equal(fila.numero_propio, WALTER);
});

test("la otra línea sigue viendo lo suyo: el recorte no es destructivo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasDosLineas(db);

  const { conversaciones } = await consultarCola(db, { linea: ESCUELA });
  assert.equal(conversaciones.length, 2);
  const nombres = (conversaciones as Fila[]).map((c) => c.persona_nombre).sort();
  assert.deepEqual(nombres, ["Jorge", "Marta"]);
});

test("una línea que nadie usó da VACÍO, nunca la cola de otro", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasDosLineas(db);

  // El día uno de un número recién vinculado. Que devolviera «todo» sería la
  // forma más cara de fallar: la vendedora nueva abriría la app creyendo que esas
  // conversaciones son suyas.
  const { conversaciones, total } = await consultarCola(db, { linea: "51900000001" });
  assert.equal(conversaciones.length, 0);
  assert.equal(total, 0);
});

test("los comentarios de FB/IG se caen del recorte: no llegaron por ninguna línea", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasDosLineas(db);
  await sembrarComentario(db, { canal: "facebook", personaId: "fb:1", personaNombre: "Comentarista" });

  // Sin filtro, el comentario es una fila más de la mesa.
  assert.equal((await consultarCola(db, {})).conversaciones.length, 4);

  // Con filtro, no: un comentario no entró por el número de Walter, así que
  // dejarlo adentro haría que «solo la línea de Walter» mostrara algo que no es
  // de Walter ni de ninguna línea.
  const { conversaciones } = await consultarCola(db, { linea: WALTER });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "Luis");
});

test("el desglose del embudo también se recorta: la banda cuenta ESTA línea, no la mesa entera", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasDosLineas(db);

  const { desglose } = await consultarCola(db, { linea: WALTER });
  const n = (desglose ?? []).reduce((acc, f) => acc + f.n, 0);
  // Sin esto la cola mostraba 1 fila y la banda decía 3: dos respuestas
  // distintas a la misma pregunta, en la misma pantalla.
  assert.equal(n, 1);
});

test("una conversación de la MISMA persona por las dos líneas son dos filas, y cada filtro ve la suya", async (t) => {
  const db = await baseDePrueba(t);
  // El caso que obliga a que la clave lleve el número propio: para ella son dos
  // chats distintos, porque le escribió a dos números que no sabe que somos los
  // mismos.
  await sembrarMensaje(db, { personaId: "51900444", personaNombre: "Ana", numeroPropio: ESCUELA });
  await sembrarMensaje(db, { personaId: "51900444", personaNombre: "Ana", numeroPropio: WALTER });

  assert.equal((await consultarCola(db, {})).conversaciones.length, 2);

  const soloWalter = (await consultarCola(db, { linea: WALTER })).conversaciones as Fila[];
  assert.equal(soloWalter.length, 1);
  assert.equal(soloWalter[0].numero_propio, WALTER);
});
