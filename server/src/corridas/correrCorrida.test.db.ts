import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { botRespuestas } from "../db/bot.js";
import { corridas, corridaRespuestas } from "../db/corridas.js";
import { enviosWa } from "../db/schema.js";
import { CONFIG_BOT_POR_DEFECTO } from "../bot/config.js";
import { correrCorrida, conversacionesDelCorpus } from "./correrCorrida.js";
import type { ClienteAnthropic } from "../bot/agente.js";

/**
 * LA CORRIDA, contra una Postgres de verdad (#257).
 *
 * Lo que se fija acá es lo que ningún test puro puede ver:
 *
 *  1. Que una Corrida **no toque `bot_respuestas`**. Es el corpus con el que se
 *     mide al bot; una Corrida que escriba ahí corrompe la medición y borra la
 *     diferencia entre lo que pasó y lo que habría pasado.
 *  2. Que **no emita ningún envío**, heredado de #255 pero verificado acá otra
 *     vez: es el camino por el que 255 conversaciones reales pasan por el motor.
 *  3. Que el hilo llegue **recortado hasta el último entrante**. Es el defecto
 *     que se rompe en silencio: sin el recorte, el motor ve su propia respuesta
 *     de entonces como último mensaje, decide que el turno no es suyo y salta.
 *     La Corrida devolvería «sin_respuesta» en todo y se leería como que el bot
 *     dejó de contestar — cuando lo que pasó es que se le preguntó mal.
 */

const LINEA = "51984429504";
const AHORA = new Date("2026-08-03T15:00:00Z");
const claveDe = (t: string) => `conv:whatsapp:${t}:${LINEA}`;

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
          usage: { input_tokens: 100, output_tokens: 20 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any,
    },
  };
}

const cfg = { ...CONFIG_BOT_POR_DEFECTO, lineas: [LINEA], modo: "automatico" as const };

/** Una conversación que el bot ya atendió: la persona escribió, el bot contestó. */
async function conversacionAtendida(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  telefono: string,
  dijoElBot: string,
): Promise<void> {
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "hola, cuánto cuesta el diplomado",
    occurredAt: new Date(AHORA.getTime() - 3 * 60_000),
  });
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "saliente",
    texto: dijoElBot,
    occurredAt: new Date(AHORA.getTime() - 2 * 60_000),
  });
  await db.insert(botRespuestas).values({
    clave: claveDe(telefono),
    numeroPropio: LINEA,
    texto: dijoElBot,
    estado: "enviada",
    acciones: [],
    creadoEn: new Date(AHORA.getTime() - 2 * 60_000),
  });
}

test("una Corrida no escribe en bot_respuestas ni emite envíos", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionAtendida(db, "51999111222", "Lo que dije entonces.");

  const antes = (await db.select().from(botRespuestas)).length;

  const r = await correrCorrida(db, cfg, clienteQueContesta("Lo que diría ahora."), AHORA, {
    rotulo: "prueba",
    lanzadaPor: "tester",
    numeroPropio: LINEA,
    limite: 10,
  });

  const despues = await db.select().from(botRespuestas);
  assert.equal(despues.length, antes, "el corpus real no se toca");

  const envios = await db.select().from(enviosWa);
  assert.equal(envios.length, 0, "una Corrida no puede mandarle nada a nadie");

  assert.equal(r.corridas, 1);
});

test("guarda las DOS mitades del diff: lo que dijo entonces y lo que diría ahora", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionAtendida(db, "51999111333", "ENTONCES");

  const r = await correrCorrida(db, cfg, clienteQueContesta("AHORA"), AHORA, {
    rotulo: "diff",
    lanzadaPor: "tester",
    numeroPropio: LINEA,
    limite: 10,
  });

  const [fila] = await db
    .select()
    .from(corridaRespuestas)
    .where(eq(corridaRespuestas.corridaId, r.id));

  assert.ok(fila, "la Corrida asentó su respuesta");
  assert.equal(fila!.textoOriginal, "ENTONCES", "lo de entonces se COPIA, no se referencia");
  assert.equal(fila!.texto, "AHORA");
});

/**
 * El recorte del hilo. Sin él, el último mensaje que el motor ve es la respuesta
 * del propio bot, `debeResponder` decide que el turno no es suyo, y la Corrida
 * entera sale «sin_respuesta» — que se lee como un bot roto y no como un Replay
 * mal armado.
 */
test("el hilo llega recortado al último entrante: el bot responde, no salta", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionAtendida(db, "51999111444", "mi respuesta de entonces");

  const r = await correrCorrida(db, cfg, clienteQueContesta("contesto de nuevo"), AHORA, {
    rotulo: "recorte",
    lanzadaPor: "tester",
    numeroPropio: LINEA,
    limite: 10,
  });

  const [fila] = await db
    .select()
    .from(corridaRespuestas)
    .where(eq(corridaRespuestas.corridaId, r.id));

  assert.notEqual(
    fila!.estado,
    "sin_respuesta",
    "si sale sin_respuesta, el hilo llegó con el saliente al final y el motor saltó",
  );
  assert.equal(fila!.texto, "contesto de nuevo");
});

test("la Corrida queda terminada, con su costo y su contexto", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionAtendida(db, "51999111555", "algo");

  const r = await correrCorrida(db, cfg, clienteQueContesta("otra cosa"), AHORA, {
    rotulo: "con la regla nueva",
    lanzadaPor: "estephano",
    numeroPropio: LINEA,
    limite: 10,
  });

  const [c] = await db.select().from(corridas).where(eq(corridas.id, r.id));
  assert.equal(c!.estado, "terminada");
  assert.equal(c!.rotulo, "con la regla nueva");
  assert.equal(c!.lanzadaPor, "estephano");
  assert.ok(c!.tokensSalida > 0, "el costo queda registrado: decide cuántas más se pueden correr");
  // El contexto es lo que hace comparables dos corridas.
  assert.equal((c!.contexto as { modelo?: string }).modelo, cfg.modelo);
});

test("el corpus se toma de lo que el bot ya atendió, no de la cola entera", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionAtendida(db, "51999111666", "una");
  // Una conversación que el bot NUNCA tocó: hay mensajes, pero ninguna respuesta
  // suya. No tiene con qué compararse, así que no entra al Replay.
  await sembrarMensaje(db, {
    personaId: "51999111777",
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "hola",
    occurredAt: AHORA,
  });

  const conv = await conversacionesDelCorpus(db, LINEA, 50);
  assert.equal(conv.length, 1);
  assert.equal(conv[0]!.clave, claveDe("51999111666"));
});
