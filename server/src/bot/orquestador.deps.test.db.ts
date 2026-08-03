import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { botRespuestas } from "../db/bot.js";
import { enviosWa } from "../db/schema.js";
import { CONFIG_BOT_POR_DEFECTO } from "./config.js";
import { procesarConversacion, type FilaRespuestaBot } from "./orquestador.js";
import type { ClienteAnthropic } from "./agente.js";

/**
 * EL MOTOR CORRIENDO SIN TRANSPORTE (#255).
 *
 * Lo que se fija acá no es que el pipeline «funcione»: es que **correrlo no sea
 * mandar**. Antes de esto, la única forma de ver trabajar al bot era dejar que
 * un mensaje saliera hacia una persona, y por eso cada intento de afinarlo
 * costaba tráfico pagado.
 *
 * La garantía es por CONSTRUCCIÓN, no por bandera: sin gestor no hay a dónde
 * mandar. El paso 14 ya salía por `sin_transporte` desde siempre —ese camino no
 * se inventó acá—, así que lo que se verifica es que el `null` explícito llegue
 * hasta ahí y que nadie lo reemplace por el gestor global de vuelta.
 *
 * Los dos asserts que importan son NEGATIVOS, y son negativos a propósito: que
 * no exista ni una fila en `envios_wa`, y que no exista ni una en
 * `bot_respuestas`. Un test que solo mirara el valor de retorno pasaría igual
 * con un bot que mandó de verdad.
 */

const LINEA = "51984429504";
const TELEFONO = "51999888777";
const CLAVE = `conv:whatsapp:${TELEFONO}:${LINEA}`;
const AHORA = new Date("2026-08-03T15:00:00Z");

/**
 * Un modelo que contesta siempre lo mismo. No hay red: el agente se inyecta.
 * El `as any` es el mismo de `agente.test.ts`: el tipo real del SDK es un
 * `APIPromise` con campos privados que un doble no puede fabricar.
 */
function clienteQueContesta(texto: string): ClienteAnthropic {
  return {
    messages: {
      create: (() =>
        Promise.resolve({
          id: "msg_1",
          model: CONFIG_BOT_POR_DEFECTO.modelo,
          role: "assistant" as const,
          type: "message" as const,
          content: [{ type: "text", text: texto }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any,
    },
  };
}

const configAutomatico = {
  ...CONFIG_BOT_POR_DEFECTO,
  lineas: [LINEA],
  // `automatico` a propósito: en `sombra` el paso 14 ni intenta enviar, así que
  // el test no probaría nada. Se le pide al bot que MANDE y se verifica que,
  // sin transporte, igual no sale nada.
  modo: "automatico" as const,
};

test("sin transporte, el motor piensa y NO emite ningún envío", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "hola, quiero información del diplomado",
    occurredAt: new Date(AHORA.getTime() - 60_000),
  });

  await procesarConversacion(CLAVE, LINEA, configAutomatico, clienteQueContesta("Hola, te cuento."), AHORA, {
    base: db,
    gestor: null, // ← la garantía
  });

  const envios = await db.select().from(enviosWa);
  assert.equal(envios.length, 0, "sin transporte no puede salir ni un envío");
});

test("con destino inyectado, la respuesta NO toca el corpus de bot_respuestas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "cuánto cuesta",
    occurredAt: new Date(AHORA.getTime() - 60_000),
  });

  const asentadas: FilaRespuestaBot[] = [];

  await procesarConversacion(CLAVE, LINEA, configAutomatico, clienteQueContesta("Te paso el precio."), AHORA, {
    base: db,
    gestor: null,
    guardarRespuesta: async (fila) => {
      asentadas.push(fila);
    },
  });

  // `bot_respuestas` es el corpus con el que se mide al bot: si una corrida de
  // prueba escribiera ahí, cada experimento contaminaría la medición.
  const enElCorpus = await db.select().from(botRespuestas);
  assert.equal(enElCorpus.length, 0, "una corrida no escribe en el corpus real");

  assert.equal(asentadas.length, 1, "la respuesta se asentó en el destino inyectado");
  assert.equal(asentadas[0]!.clave, CLAVE);
});

test("sin deps, el pipeline sigue asentando en bot_respuestas (producción no cambia)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "hola",
    occurredAt: new Date(AHORA.getTime() - 60_000),
  });

  // Se inyecta la base —el test no puede hablarle a la de producción— pero NO
  // se dice nada del destino ni del transporte. Es el camino de producción: el
  // default tiene que seguir siendo `bot_respuestas`.
  await procesarConversacion(CLAVE, LINEA, configAutomatico, clienteQueContesta("Hola."), AHORA, {
    base: db,
    gestor: null,
  });

  const enElCorpus = await db.select().from(botRespuestas);
  assert.equal(enElCorpus.length, 1, "sin destino inyectado, la respuesta va al corpus de siempre");
});

/**
 * La distinción que un `?? gestorWhatsappSiActivo()` borraría: **no decir nada
 * sobre el gestor** (producción) tiene que ser distinguible de **decir `null`**
 * (la garantía). Si alguien «simplifica» esa línea a un `??`, este test cae —
 * porque `null` volvería a resolverse al gestor global.
 */
test("`gestor: null` no es lo mismo que no pasar gestor", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "hola",
    occurredAt: new Date(AHORA.getTime() - 60_000),
  });

  await procesarConversacion(CLAVE, LINEA, configAutomatico, clienteQueContesta("Hola."), AHORA, {
    base: db,
    gestor: null,
  });

  const [fila] = await db.select().from(botRespuestas);
  // Llegó al paso 14 en modo automático y no encontró transporte: la respuesta
  // quedó asentada, y ningún envío salió.
  assert.ok(fila, "la respuesta se asentó igual: pensar no depende de poder mandar");
  const envios = await db.select().from(enviosWa);
  assert.equal(envios.length, 0);
});
