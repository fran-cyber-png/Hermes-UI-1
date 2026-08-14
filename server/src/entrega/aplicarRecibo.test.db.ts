import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarEnvioWa } from "../pruebas/sembrar.js";
import { aplicarRecibo } from "./repositorio.js";

/**
 * EL LECTOR DE RECIBOS, CONTRA UNA BASE DE VERDAD.
 *
 * ══ POR QUÉ ESTE ARCHIVO EXISTE ═════════════════════════════════════════════
 *
 * 🔴 `entrega/dominio.ts` (puro) tenía sus tests y `entrega/paridad.test.ts`
 * cruzaba la escala con el SQL — y aun así **el frente entero de los ✓✓ estuvo
 * apagado en producción sin que nadie se enterara**. El defecto no estaba en la
 * regla: estaba en el bind. `aplicarRecibo` interpolaba `recibo.cuando`, un
 * `Date`, adentro del template, y postgres.js contesta:
 *
 *     The "string" argument must be of type string or an instance of Buffer
 *     or ArrayBuffer. Received an instance of Date
 *
 * El `catch` sólo perdona el `42703` (falta la columna), así que **todos** los
 * recibos morían. Se descubrió leyendo `journalctl` el 14-ago-2026: el webhook
 * escupía «no se pudo aplicar el recibo» una vez por minuto, y en la app ningún
 * saliente mostraba tilde.
 *
 * La lección, que es la misma del veto de la campaña (murió por un `Date` el
 * 5-ago): **un seam que sólo se ejercita contra Meta es un seam sin red.** Los
 * tests puros no pueden ver un error de serialización del driver; hace falta
 * una consulta real. Por eso este archivo es `.test.db.ts` y no `.test.ts`.
 */

const WAMID = "wamid.HBgLNTE5NTkzNDY4OTAVAgARGBIwQ0EwODVGRDcxREM5MTcxNzUA";

async function estadoDe(db: Awaited<ReturnType<typeof baseDePrueba>>, idExterno: string) {
  const [fila] = await db.execute<{ estado_entrega: string | null; estado_entrega_en: Date | null }>(
    sql`SELECT estado_entrega, estado_entrega_en FROM envios_wa WHERE id_externo = ${idExterno}`,
  );
  return fila;
}

test("aplicarRecibo escribe el estado — el bind de la fecha no puede tirar", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEnvioWa(db, { idExterno: WAMID, estado: "enviado" });

  const cuando = new Date("2026-08-14T18:00:00.000Z");
  const filas = await aplicarRecibo(db, {
    mensajes: [`wa:${WAMID}`],
    estado: "entregado",
    cuando,
  });

  assert.equal(filas, 1, "tiene que avanzar exactamente la fila del mensaje");
  const f = await estadoDe(db, WAMID);
  assert.equal(f.estado_entrega, "entregado");
  assert.equal(
    new Date(f.estado_entrega_en!).toISOString(),
    cuando.toISOString(),
    "la hora del recibo se guarda tal cual, no la de ahora",
  );
});

test("el prefijo `wa:` se saca acá: envios_wa guarda el id CRUDO", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEnvioWa(db, { idExterno: WAMID });

  // Sin quitar el prefijo, el WHERE no matchea y el recibo se pierde en silencio.
  const filas = await aplicarRecibo(db, {
    mensajes: [`wa:${WAMID}`],
    estado: "entregado",
    cuando: new Date(),
  });
  assert.equal(filas, 1);
});

test("la escala NUNCA retrocede: un entregado que llega tarde no baja un leído", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEnvioWa(db, { idExterno: WAMID });

  await aplicarRecibo(db, { mensajes: [`wa:${WAMID}`], estado: "leido", cuando: new Date() });
  const filas = await aplicarRecibo(db, {
    mensajes: [`wa:${WAMID}`],
    estado: "entregado",
    cuando: new Date(),
  });

  assert.equal(filas, 0, "no avanza ninguna fila");
  assert.equal((await estadoDe(db, WAMID)).estado_entrega, "leido", "sigue leído");
});

test("un recibo abarca VARIOS mensajes y los mueve de una", async (t) => {
  const db = await baseDePrueba(t);
  const ids = [`${WAMID}A`, `${WAMID}B`, `${WAMID}C`];
  for (const id of ids) await sembrarEnvioWa(db, { idExterno: id });

  const filas = await aplicarRecibo(db, {
    mensajes: ids.map((i) => `wa:${i}`),
    estado: "entregado",
    cuando: new Date(),
  });

  assert.equal(filas, 3);
});

test("un recibo de un mensaje que no mandamos nosotros da 0, no un error", async (t) => {
  const db = await baseDePrueba(t);
  const filas = await aplicarRecibo(db, {
    mensajes: ["wa:wamid.DEOTRAPERSONA"],
    estado: "entregado",
    cuando: new Date(),
  });
  assert.equal(filas, 0);
});

test("`fallido` gana siempre — es lo único que pide una acción", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEnvioWa(db, { idExterno: WAMID });

  await aplicarRecibo(db, { mensajes: [`wa:${WAMID}`], estado: "leido", cuando: new Date() });
  const filas = await aplicarRecibo(db, {
    mensajes: [`wa:${WAMID}`],
    estado: "fallido",
    cuando: new Date(),
  });

  assert.equal(filas, 1, "fallido pisa incluso a leído");
  assert.equal((await estadoDe(db, WAMID)).estado_entrega, "fallido");
});
