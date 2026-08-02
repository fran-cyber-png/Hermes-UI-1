import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarEnvioWa, sembrarMensaje } from "../pruebas/sembrar.js";
import { botPausas, botRespuestas } from "../db/bot.js";
import { deUnDato } from "../procedencia/pieza.js";
import { candidatosDeReenganche } from "./correrReenganche.js";
import { MOTIVO_REENGANCHE, decidirReenganche } from "./reenganche.js";

/**
 * EL SQL DEL REENGANCHE, contra una Postgres de verdad (ADR 0008).
 *
 * Los tests puros de `reenganche.test.ts` fijan las REGLAS; acá se fija lo que
 * ninguna función pura puede ver: que la consulta traiga los hechos crudos que
 * esas reglas esperan, **en el orden que esperan**. El caso que más importa es
 * el de los textos del lead: `esDespedida` solo cuenta sobre el ÚLTIMO mensaje,
 * así que si el `array_agg` volviera en orden cronológico en vez de al revés,
 * el veredicto miraría el mensaje equivocado y ningún test puro lo notaría.
 */

const LINEA = "51984429504";
const AHORA = new Date("2026-08-01T20:00:00Z"); // 15:00 en Lima
const VENTANA = { followupHoraDesde: 9, followupHoraHasta: 20 };
const haceH = (h: number) => new Date(AHORA.getTime() - h * 3600_000);

const claveDe = (telefono: string) => `conv:whatsapp:${telefono}:${LINEA}`;

/** Una conversación atendida: el lead preguntó, le mandamos el material con flyer. */
async function conversacionConMaterial(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  telefono: string,
  o: { entranteH?: number; salienteH?: number; textos?: string[] } = {},
): Promise<void> {
  for (const [i, texto] of (o.textos ?? ["quiero información"]).entries()) {
    await sembrarMensaje(db, {
      personaId: telefono,
      numeroPropio: LINEA,
      direccion: "entrante",
      texto,
      // El primero es el más viejo: el orden importa y por eso se siembra así.
      occurredAt: haceH((o.entranteH ?? 6) + (o.textos?.length ?? 1) - i),
    });
  }
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "saliente",
    texto: "Te dejo el temario 👇",
    mediaClase: "imagen",
    occurredAt: haceH(o.salienteH ?? 5),
  });
}

test("la conversación que recibió el material y se calló entra, con sus hechos", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionConMaterial(db, "51999111222");

  const [c] = await candidatosDeReenganche(db, LINEA, AHORA);
  assert.ok(c, "tiene que haber un candidato");
  assert.equal(c.clave, claveDe("51999111222"));
  assert.equal(c.recibioElMaterial, true, "el adjunto saliente ES el material");
  assert.equal(c.tienePausa, false);
  assert.equal(c.yaHuboReenganche, false);
  assert.ok(c.ultimoSalienteEn && c.ultimoEntranteEn);
  assert.ok(c.ultimoSalienteEn > c.ultimoEntranteEn, "la pelota es nuestra");

  assert.deepEqual(decidirReenganche(c, AHORA, VENTANA), { manda: true });
});

test("los textos del lead vuelven del MÁS RECIENTE al más viejo", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionConMaterial(db, "51999111333", {
    textos: ["hola", "¿tienen cuotas?", "gracias por la atención"],
  });

  const [c] = await candidatosDeReenganche(db, LINEA, AHORA);
  assert.equal(c!.textosDelLead[0], "gracias por la atención");
  // Y por eso la despedida se ve: es el último que escribió.
  const v = decidirReenganche(c!, AHORA, VENTANA);
  assert.equal(v.manda, false);
  assert.equal(v.manda === false && v.motivo, "se_despidio");
});

test("«recibió el material» también se cumple con una PIEZA sin adjunto", async (t) => {
  const db = await baseDePrueba(t);
  const telefono = "51999111444";
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "¿se puede en cuotas?",
    occurredAt: haceH(6),
  });
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "saliente",
    texto: "Se puede pagar en 2 cuotas",
    occurredAt: haceH(5),
  });
  await sembrarEnvioWa(db, {
    telefono,
    numeroPropio: LINEA,
    vendedoraId: "bot",
    texto: "Se puede pagar en 2 cuotas",
    procedencia: deUnDato({
      clave: "cuotas",
      editada: false,
      contenido: { texto: "Se puede pagar en 2 cuotas" },
      via: "bot",
    }),
    creadoAt: haceH(5),
  });

  const [c] = await candidatosDeReenganche(db, LINEA, AHORA);
  assert.equal(c!.recibioElMaterial, true, "una pieza estampada cuenta como material");
});

test("sin material (solo texto suelto nuestro) NO califica", async (t) => {
  const db = await baseDePrueba(t);
  const telefono = "51999111555";
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "hola",
    occurredAt: haceH(6),
  });
  await sembrarMensaje(db, {
    personaId: telefono,
    numeroPropio: LINEA,
    direccion: "saliente",
    texto: "¡Hola! ¿Con quién tengo el gusto?",
    occurredAt: haceH(5),
  });

  const [c] = await candidatosDeReenganche(db, LINEA, AHORA);
  assert.equal(c!.recibioElMaterial, false);
  const v = decidirReenganche(c!, AHORA, VENTANA);
  assert.equal(v.manda === false && v.motivo, "sin_material");
});

test("la pausa y el reenganche previo se leen de sus tablas", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionConMaterial(db, "51999111666");
  await conversacionConMaterial(db, "51999111777");

  await db.insert(botPausas).values({ clave: claveDe("51999111666"), motivo: "rechazo" });
  await db.insert(botRespuestas).values({
    clave: claveDe("51999111777"),
    numeroPropio: LINEA,
    texto: "…",
    estado: "enviada",
    motivo: MOTIVO_REENGANCHE,
    creadoEn: haceH(3),
  });

  const c = await candidatosDeReenganche(db, LINEA, AHORA);
  const porClave = new Map(c.map((x) => [x.clave, x]));
  assert.equal(porClave.get(claveDe("51999111666"))!.tienePausa, true);
  assert.equal(porClave.get(claveDe("51999111777"))!.yaHuboReenganche, true);
  // Y los dos se descartan, cada uno con SU motivo.
  const motivos = c.map((x) => {
    const v = decidirReenganche(x, AHORA, VENTANA);
    return v.manda ? "manda" : v.motivo;
  });
  assert.deepEqual(new Set(motivos), new Set(["pausada", "ya_hubo_reenganche"]));
});

test("una conversación de OTRA línea no aparece", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionConMaterial(db, "51999111888");
  const c = await candidatosDeReenganche(db, "51986394450", AHORA);
  assert.equal(c.length, 0, "el reenganche es por línea: cada número es su propia cartera");
});

test("el que escribió último aparece igual, y lo descarta la regla (no el SQL)", async (t) => {
  // El SQL es un prefiltro SUPERCONJUNTO a propósito: si filtrara acá, el
  // simulacro no podría contar por qué se descartó cada uno.
  const db = await baseDePrueba(t);
  await conversacionConMaterial(db, "51999111999", { entranteH: 6, salienteH: 5 });
  await sembrarMensaje(db, {
    personaId: "51999111999",
    numeroPropio: LINEA,
    direccion: "entrante",
    texto: "¿y cuánto cuesta?",
    occurredAt: haceH(1),
  });

  const [c] = await candidatosDeReenganche(db, LINEA, AHORA);
  assert.ok(c, "sigue viniendo en la consulta");
  const v = decidirReenganche(c!, AHORA, VENTANA);
  assert.equal(v.manda === false && v.motivo, "la_pelota_es_suya");
});
