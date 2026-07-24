import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  sembrarComentario,
  sembrarEstadoConversacion,
  sembrarEtiqueta,
  sembrarMensaje,
} from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { upsertEstado } from "./estado.js";

/**
 * LA COLA POTENCIADA (#49) contra la base: el «no leído» derivado del cursor, la
 * banda de pin sobre los 6 niveles, el filtro de favoritas/categoría, el
 * aislamiento por vendedora y el «pide info» del ÚLTIMO entrante (no histórico).
 */

const clave = (p: string) => `conv:whatsapp:${p}:51999999999`;

interface Fila {
  clave: string;
  persona_id: string | null;
  fijada: boolean;
  favorita: boolean;
  no_leido: boolean;
  pide_info: boolean;
  categorias: string[];
  nivel: number;
}

const filas = async (db: Parameters<typeof sembrarMensaje>[0], opciones = {}) =>
  (await consultarCola(db, { vendedoraId: "ana", ...opciones })).conversaciones as Fila[];

test("no_leido: sin cursor, un entrante deja la conversación SIN LEER", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900aaa" });

  const [fila] = await filas(db);
  assert.equal(fila.no_leido, true, "sin haberla abierto nunca, hay un entrante sin leer");
});

test("no_leido: con el cursor DESPUÉS del último entrante, queda leída", async (t) => {
  const db = await baseDePrueba(t);
  const t0 = new Date(Date.now() - 60_000);
  await sembrarMensaje(db, { personaId: "51900bbb", occurredAt: t0 });
  // El cursor se avanzó a AHORA (después del entrante).
  await sembrarEstadoConversacion(db, { vendedoraId: "ana", clave: clave("51900bbb"), leidoHasta: new Date() });

  const [fila] = await filas(db);
  assert.equal(fila.no_leido, false, "abrió el hilo después del último entrante: leída");
});

test("no_leido: un entrante POSTERIOR al cursor la vuelve a marcar sin leer", async (t) => {
  const db = await baseDePrueba(t);
  // Cursor a -60s; después llega un entrante nuevo (ahora).
  await sembrarEstadoConversacion(db, {
    vendedoraId: "ana",
    clave: clave("51900ccc"),
    leidoHasta: new Date(Date.now() - 60_000),
  });
  await sembrarMensaje(db, { personaId: "51900ccc", occurredAt: new Date() });

  const [fila] = await filas(db);
  assert.equal(fila.no_leido, true, "el entrante nuevo es posterior al cursor: sin leer otra vez");
});

test("no_leido: avanzar el cursor con upsertEstado(leido:true) lo apaga", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900ddd", occurredAt: new Date(Date.now() - 1000) });

  assert.equal((await filas(db))[0].no_leido, true, "arranca sin leer");
  await upsertEstado(db, "ana", { clave: clave("51900ddd"), leido: true });
  assert.equal((await filas(db))[0].no_leido, false, "tras abrir, queda leída");
});

test("la banda de pin ordena una conversación fijada ARRIBA de una viva nivel-0", async (t) => {
  const db = await baseDePrueba(t);
  // Dos vivas nivel-0; la A es más reciente, así que sin pin iría primera.
  await sembrarMensaje(db, { personaId: "51900aaa", occurredAt: new Date() });
  await sembrarMensaje(db, { personaId: "51900bbb", occurredAt: new Date(Date.now() - 30_000) });

  const sinPin = await filas(db);
  assert.equal(sinPin[0].persona_id, "51900aaa", "sin pin: la más reciente arriba");

  // Fijar la B (la más vieja): salta a la banda, arriba de la A.
  await upsertEstado(db, "ana", { clave: clave("51900bbb"), fijada: true });
  const conPin = await filas(db);
  assert.equal(conPin[0].persona_id, "51900bbb", "la fijada va arriba de todo, pese a ser más vieja");
  assert.equal(conPin[0].fijada, true);
  assert.equal(conPin[0].nivel, 0, "dentro de la banda sigue siendo nivel 0 (no se pisa la urgencia)");
});

test("tab=favoritos devuelve SOLO las favoritas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900aaa" });
  await sembrarMensaje(db, { personaId: "51900bbb" });
  await upsertEstado(db, "ana", { clave: clave("51900bbb"), favorita: true });

  const favs = await filas(db, { tab: "favoritos" });
  assert.equal(favs.length, 1, "solo la favorita");
  assert.equal(favs[0].persona_id, "51900bbb");
  assert.equal(favs[0].favorita, true);
});

test("tab=no-leidos devuelve SOLO las sin leer", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900aaa", occurredAt: new Date(Date.now() - 60_000) });
  await sembrarMensaje(db, { personaId: "51900bbb", occurredAt: new Date(Date.now() - 60_000) });
  // La A se leyó; la B no.
  await sembrarEstadoConversacion(db, { vendedoraId: "ana", clave: clave("51900aaa"), leidoHasta: new Date() });

  const sinLeer = await filas(db, { tab: "no-leidos" });
  assert.equal(sinLeer.length, 1);
  assert.equal(sinLeer[0].persona_id, "51900bbb");
});

test("el estado es POR VENDEDORA: el pin de ana es invisible para bruna", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900aaa" });
  await upsertEstado(db, "ana", { clave: clave("51900aaa"), fijada: true });

  const deAna = (await consultarCola(db, { vendedoraId: "ana" })).conversaciones as Fila[];
  const deBruna = (await consultarCola(db, { vendedoraId: "bruna" })).conversaciones as Fila[];
  assert.equal(deAna[0].fijada, true, "ana ve su pin");
  assert.equal(deBruna[0].fijada, false, "bruna NO ve el pin de ana");
});

test("categoria filtra por la etiqueta asignada y la fila trae sus categorías", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900aaa" });
  await sembrarMensaje(db, { personaId: "51900bbb" });
  await sembrarEtiqueta(db, { clave: clave("51900aaa"), etiqueta: "Precio" });

  const conCategoria = await filas(db, { categoria: "precio" });
  assert.equal(conCategoria.length, 1, "solo la que lleva la etiqueta");
  assert.equal(conCategoria[0].persona_id, "51900aaa");
  assert.deepEqual(conCategoria[0].categorias, ["precio"], "la fila trae sus categorías (en minúsculas)");
});

test("pide_info es del ÚLTIMO entrante, no un bool_or histórico", async (t) => {
  const db = await baseDePrueba(t);
  // Pidió precio, después dijo que no. Lo ÚLTIMO manda: el chip NO se prende.
  await sembrarMensaje(db, { personaId: "51900aaa", texto: "hola, ¿cuánto cuesta?", occurredAt: new Date(Date.now() - 60_000) });
  await sembrarMensaje(db, { personaId: "51900aaa", texto: "no gracias, mejor lo dejo por ahora", occurredAt: new Date() });

  const [fila] = await filas(db);
  assert.equal(fila.pide_info, false, "lo último fue «no gracias»: no pide info");
});

test("pide_info se prende si el último entrante SÍ pide", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900bbb", texto: "hola", occurredAt: new Date(Date.now() - 60_000) });
  await sembrarMensaje(db, { personaId: "51900bbb", texto: "quiero saber el precio", occurredAt: new Date() });

  const [fila] = await filas(db);
  assert.equal(fila.pide_info, true, "lo último pide precio: el chip se prende");
});

test("un audio POSTERIOR no apaga «pide info»: manda el último entrante CON TEXTO", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900ccc", texto: "quiero saber el precio", occurredAt: new Date(Date.now() - 60_000) });
  // Manda un audio después: no dice nada nuevo, no puede borrar el pedido.
  await sembrarMensaje(db, { personaId: "51900ccc", texto: null, mediaClase: "audio", occurredAt: new Date() });

  const [fila] = await filas(db);
  assert.equal(fila.pide_info, true, "el audio no tiene palabras: la última palabra sigue siendo el pedido");
});

test("una conversación FIJADA sigue en la cola aunque se caiga de la ventana de 30 días", async (t) => {
  const db = await baseDePrueba(t);
  const viejo = new Date(Date.now() - 45 * 24 * 3600_000); // 45 días: fuera de la ventana
  await sembrarMensaje(db, { personaId: "51900ddd", texto: "hablamos el mes pasado", occurredAt: viejo });

  assert.equal((await filas(db)).length, 0, "sin fijar, a los 45 días ya no está en la cola");

  await upsertEstado(db, "ana", { clave: clave("51900ddd"), fijada: true });
  const conPin = await filas(db);
  assert.equal(conPin.length, 1, "fijada, vuelve a aparecer: si no, no se puede ni desfijar");
  assert.equal(conPin[0].fijada, true);
});

test("intencion=por-vencer devuelve solo lo que tiene la ventana de Meta corriendo", async (t) => {
  const db = await baseDePrueba(t);
  // Un comentario reciente (ventana de Meta abierta) y un chat de WhatsApp (sin ventana).
  await sembrarComentario(db, { personaId: "fb-nueva", texto: "¿precio?" });
  await sembrarMensaje(db, { personaId: "51900eee", texto: "hola" });

  const porVencer = await filas(db, { intencion: "por-vencer" });
  assert.equal(porVencer.length, 1, "solo el comentario con ventana abierta");
  assert.equal(porVencer[0].persona_id, "fb-nueva");
});

test("marcar SIN LEER deja la conversación sin leer, sin borrar el resto del historial", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900fff", texto: "hola", occurredAt: new Date(Date.now() - 60_000) });

  await upsertEstado(db, "ana", { clave: clave("51900fff"), leido: true });
  assert.equal((await filas(db))[0].no_leido, false, "tras abrir, leída");

  await upsertEstado(db, "ana", { clave: clave("51900fff"), leido: false });
  assert.equal((await filas(db))[0].no_leido, true, "marcada a mano: vuelve a estar sin leer");
});

test("el cursor NO se traga un mensaje que la ingesta trae con retraso", async (t) => {
  const db = await baseDePrueba(t);
  const hace5min = new Date(Date.now() - 5 * 60_000);
  await sembrarMensaje(db, { personaId: "51900ggg", texto: "hola", occurredAt: hace5min });

  // La vendedora abre el hilo: el cursor va al último mensaje VISIBLE (hace 5 min),
  // no a `now()`.
  await upsertEstado(db, "ana", { clave: clave("51900ggg"), leido: true });
  assert.equal((await filas(db))[0].no_leido, false);

  // Ahora la ingesta trae un mensaje que OCURRIÓ hace 2 minutos (después del que
  // leyó, pero antes de que abriera). Con un cursor en `now()` quedaría tapado.
  await sembrarMensaje(db, {
    personaId: "51900ggg",
    texto: "¿me pasás el precio?",
    occurredAt: new Date(Date.now() - 2 * 60_000),
  });
  assert.equal(
    (await filas(db))[0].no_leido,
    true,
    "el mensaje que llegó tarde NO puede quedar marcado como leído: nadie lo vio",
  );
});
