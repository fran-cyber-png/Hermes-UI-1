import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { hiloDe } from "./hilo.js";

/**
 * DOS LÍNEAS PROPIAS, LA MISMA PERSONA: SON DOS CHATS (#50).
 *
 * Este es el bug que se destapa el día que hay un segundo número, y por eso no
 * se podía ver hasta ahora: con una sola línea, filtrar o no filtrar da lo mismo.
 *
 * `GET /conversacion/:telefono` filtraba solo por `persona_id`. Si la misma
 * persona le escribió a la línea de la Escuela y a la de otra vendedora, los dos
 * hilos se servían como uno solo — y la respuesta podía salir por el número que
 * el lead no conoce. Para él eso no es «Goberna otra vez»: es un desconocido
 * escribiéndole en otro chat, y la respuesta se pierde en un hilo que nadie mira.
 *
 * La cola ya agrupaba bien (`conv:<canal>:<persona>:<numeroPropio>`). Era la
 * conversación abierta la que no.
 */

const LEAD = "51961506674";
const LINEA_A = "51986394450";
const LINEA_B = "51999888777";

test("el hilo se sirve por LÍNEA: dos números propios a la misma persona no se mezclan", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_A, texto: "hola, vi el diplomado de OSINT" });
  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_A, texto: "¿cuánto sale?" });
  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_B, texto: "hola, me interesa el de gestión" });

  const a = await hiloDe(db, LEAD, LINEA_A);
  const b = await hiloDe(db, LEAD, LINEA_B);

  assert.equal(a.length, 2, "la línea A ve SOLO lo suyo");
  assert.equal(b.length, 1, "la línea B ve SOLO lo suyo");

  const textosA = a.map((m) => (m as { texto: string }).texto);
  assert.ok(!textosA.some((tx) => tx.includes("gestión")), "un mensaje de la otra línea NO puede aparecer acá");
});

test("sin `numeroPropio` se sirve todo — el comportamiento viejo, para no romper a quien no lo manda", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_A, texto: "por la A" });
  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_B, texto: "por la B" });

  const todo = await hiloDe(db, LEAD);

  // Es el comportamiento de hoy y se conserva a propósito: hay consumidores que
  // todavía no mandan la línea, y dejarlos sin conversación sería peor. Lo que no
  // puede pasar —que un ENVÍO salga por la línea equivocada— lo frena la guarda #0.
  assert.equal(todo.length, 2);
});

test("un número propio que nadie usó devuelve VACÍO, no el hilo de otro", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_A, texto: "por la A" });

  const nada = await hiloDe(db, LEAD, "51900000000");

  assert.equal(nada.length, 0, "sin coincidencia no se cae al hilo de otra línea");
});

test("el filtro tolera el formato: `+51 986…` es la misma línea que `51986…`", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA_A, texto: "por la A" });

  const conFormato = await hiloDe(db, LEAD, "+51 986 394 450");

  assert.equal(conFormato.length, 1, "un espacio o un `+` no pueden esconder el hilo");
});
