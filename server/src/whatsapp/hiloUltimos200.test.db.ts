import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { hiloDe, MENSAJES_DEL_HILO } from "./hilo.js";

/**
 * EL HILO SERVÍA LOS 200 MENSAJES MÁS VIEJOS.
 *
 * `ORDER BY occurred_at ASC LIMIT 200` no es «los últimos 200»: es los PRIMEROS
 * 200. En una conversación larga la vendedora abría el chat y veía cómo empezó
 * hace tres meses, con los mensajes de hoy fuera de la respuesta — y sin ningún
 * síntoma, porque un hilo con 200 burbujas se ve completo.
 *
 * Se descubrió construyendo «responder citando», y ahí duele el doble: una cita
 * apunta casi siempre a algo reciente, o sea a lo único que el tope dejaba afuera.
 *
 * Lo que este archivo fija son las DOS mitades, y hacen falta las dos: cuáles
 * mensajes vienen (los últimos) y en qué orden (ascendente, como se lee un chat).
 */

const LEAD = "51961506674";
const LINEA = "51986394450";

/** `n` mensajes, uno por minuto, el más viejo primero. El texto es su número. */
async function sembrarConversacionLarga(db: Awaited<ReturnType<typeof baseDePrueba>>, n: number) {
  const base = Date.now() - n * 60_000;
  for (let i = 0; i < n; i++) {
    await sembrarMensaje(db, {
      personaId: LEAD,
      numeroPropio: LINEA,
      texto: `mensaje ${i}`,
      occurredAt: new Date(base + i * 60_000),
    });
  }
}

test("🔴 con más de 200 mensajes se sirven los ÚLTIMOS, no los primeros", async (t) => {
  const db = await baseDePrueba(t);
  const total = MENSAJES_DEL_HILO + 5;
  await sembrarConversacionLarga(db, total);

  const hilo = await hiloDe(db, LEAD, LINEA);
  const textos = hilo.map((m) => (m as { texto: string }).texto);

  assert.equal(hilo.length, MENSAJES_DEL_HILO);
  // El primero que se sirve es el número 5 (los cinco más viejos quedan afuera)
  // y el último es el más nuevo: eso es «los últimos 200».
  assert.equal(textos[0], `mensaje ${total - MENSAJES_DEL_HILO}`);
  assert.equal(textos[textos.length - 1], `mensaje ${total - 1}`);
  assert.ok(!textos.includes("mensaje 0"), "el más viejo NO puede entrar cuando hay que recortar");
});

test("y salen en orden ascendente — un chat se lee de arriba para abajo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarConversacionLarga(db, MENSAJES_DEL_HILO + 5);

  const hilo = await hiloDe(db, LEAD, LINEA);
  const fechas = hilo.map((m) => new Date((m as { occurred_at: string }).occurred_at).getTime());

  for (let i = 1; i < fechas.length; i++) {
    assert.ok(fechas[i] >= fechas[i - 1], `el mensaje ${i} vino antes que el ${i - 1}`);
  }
});

test("por debajo del tope no cambia nada: vienen todos y en orden", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarConversacionLarga(db, 4);

  const hilo = await hiloDe(db, LEAD, LINEA);

  assert.deepEqual(
    hilo.map((m) => (m as { texto: string }).texto),
    ["mensaje 0", "mensaje 1", "mensaje 2", "mensaje 3"],
  );
});

test("el recorte respeta la LÍNEA: no se llena con los 200 de otro número propio", async (t) => {
  const db = await baseDePrueba(t);
  // La otra línea es la que tiene el volumen. Si el recorte se hiciera antes del
  // filtro, el hilo de esta quedaría vacío teniendo mensajes.
  for (let i = 0; i < MENSAJES_DEL_HILO + 10; i++) {
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: "51999888777", texto: `otra ${i}` });
  }
  await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, texto: "el único de esta línea" });

  const hilo = await hiloDe(db, LEAD, LINEA);

  assert.equal(hilo.length, 1);
  assert.equal((hilo[0] as { texto: string }).texto, "el único de esta línea");
});
