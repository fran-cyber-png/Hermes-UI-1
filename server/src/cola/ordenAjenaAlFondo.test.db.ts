import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola } from "./consultarCola.js";

/**
 * LO QUE TIENE DUEÑA Y NO SOY YO, VA DESPUÉS.
 *
 * ── Lo que reportó Luz el 14-ago-2026 ───────────────────────────────────────
 *
 * «Veo otros chats y se quedan arriba, no puedo dar un buen seguimiento».
 * Medido: su línea (`51984429504`) tiene 1.158 conversaciones repartidas entre
 * seis personas, y el orden ponía `no_leido DESC` antes que todo lo demás. Un
 * chat **de otra vendedora**, viejo y con veinte mensajes sin leer que ella no
 * iba a contestar nunca, le tapaba sus propios leads del día — y cuanto más
 * abandonada la conversación ajena, más arriba quedaba.
 *
 * ── 🔴 QUIÉN VE UNA CONVERSACIÓN AJENA, DESPUÉS DE LA FRONTERA ──────────────
 *
 * **El docblock que estaba acá afirmaba lo contrario de lo que hoy es cierto**,
 * y hay que decirlo porque es la clase de comentario al que uno le cree: decía
 * «el reparto es un filtro y no un permiso, así que la conversación ajena se
 * sigue sirviendo — abajo», y que «un test que la esperara ausente estaría
 * pidiendo una frontera que Hermes no tiene». Hermes ahora la tiene: la
 * frontera de `cola/asignadaSql.ts` **no sirve** lo ajeno a una vendedora, y ese
 * caso lo fija `fronteraDeAsignacion.test.db.ts`.
 *
 * O sea que el orden que este archivo mide sólo lo puede observar quien ve más
 * de una dueña en la misma mesa: **supervisor y admin**. Por eso los tests
 * corren con rol de supervisora — no es andamio, es el único escenario donde la
 * pregunta existe.
 *
 * ⚠️ **Y el orden no se puede reemplazar por la frontera.** La supervisora es
 * quien reparte: necesita ver el trabajo de las seis y necesita que el suyo no
 * quede sepultado abajo del chat abandonado de otra. Si algún día alguien borra
 * `ajenaVaDespues` de `bandaPinOrdenSql` «porque ya está la frontera», la
 * pantalla de quien supervisa vuelve al 14-ago.
 */

const LINEA = "51984429504";
const YO = "luz";

/**
 * ⚠️ Lo único que queda del entorno en este archivo, y es transitorio: quién es
 * supervisora sale hoy de `HERMES_SUPERVISORES` (`padron/supervisor.ts`).
 * `consultarCola` lo resuelve una vez y lo baja como booleano; el día que el rol
 * viva en la tabla `equipo`, esto se reemplaza por sembrar una fila.
 */
function comoSupervisora(t: { after: (fn: () => void) => void }, quien: string) {
  const antes = process.env.HERMES_SUPERVISORES;
  process.env.HERMES_SUPERVISORES = quien;
  t.after(() => {
    if (antes === undefined) delete process.env.HERMES_SUPERVISORES;
    else process.env.HERMES_SUPERVISORES = antes;
  });
}

async function asignar(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  telefono: string,
  aQuien: string,
) {
  await db.insert(conversacionAsignada).values({
    clave: `conv:whatsapp:${telefono}:${LINEA}`,
    numeroPropio: LINEA,
    vendedoraId: aQuien,
    motivo: "manual",
    asignadaPor: "test",
  });
}

/** Los nombres en el orden en que la cola los devuelve. */
async function orden(db: Awaited<ReturnType<typeof baseDePrueba>>, vendedoraId?: string) {
  const r = await consultarCola(db, { vendedoraId, limit: 20 });
  return (r.conversaciones as { persona_nombre: string | null }[]).map((c) => c.persona_nombre);
}

test("una conversación AJENA con más sin leer queda debajo de la mía", async (t) => {
  const db = await baseDePrueba(t);
  comoSupervisora(t, YO);

  // La ajena tiene MÁS sin leer y es igual de vieja: con el orden anterior ganaba.
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "MIA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");
  await asignar(db, "51900000002", YO);

  const nombres = await orden(db, YO);
  assert.ok(
    nombres.indexOf("MIA") < nombres.indexOf("AJENA"),
    `la mía tiene que ir primero — salió: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 EL TEST QUE CAMBIÓ DE SIGNO, Y ES EL QUE HAY QUE LEER DOS VECES.
 *
 * Se llamaba «lo ajeno NO desaparece: sigue en la cola, abajo» y afirmaba que el
 * reparto era un filtro. Para una vendedora eso **ya no es cierto** y la
 * frontera existe justamente para que no lo sea. Lo que sigue siendo cierto es
 * para quien supervisa: ahí lo ajeno se sirve, y va al fondo.
 */
test("🔴 para quien SUPERVISA, lo ajeno no desaparece: sigue en la cola, abajo", async (t) => {
  const db = await baseDePrueba(t);
  comoSupervisora(t, YO);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, YO);
  assert.ok(nombres.includes("AJENA"), "quien reparte tiene que ver lo repartido");
});

/**
 * EL CONTRAPUNTO, y va en este archivo a propósito: es la mitad que el docblock
 * viejo negaba. La MISMA siembra, la MISMA persona, sin el rol.
 */
test("🔴 y para una VENDEDORA lo ajeno no se sirve: no hay orden que discutir", async (t) => {
  const db = await baseDePrueba(t);
  comoSupervisora(t, "otra");
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, YO);
  assert.ok(!nombres.includes("AJENA"), `la frontera manda — salió: ${nombres.join(", ")}`);
});

test("lo SIN DUEÑO no se castiga: es de quien lo agarre", async (t) => {
  const db = await baseDePrueba(t);
  comoSupervisora(t, YO);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000003", personaNombre: "LIBRE", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, YO);
  assert.ok(
    nombres.indexOf("LIBRE") < nombres.indexOf("AJENA"),
    `sin dueño va antes que ajena — salió: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 EL CASO QUE ROMPE EL ARREGLO SI SE COMPARA DE UN SOLO LADO.
 *
 * En producción conviven `Luz` (lo empuja Cerberus a `numero_vendedora`) y
 * `luz` (lo que ella tipea al entrar, de donde sale el `vendedoraId`). Con
 * comparación exacta, sus propias conversaciones le aparecerían como ajenas y
 * el orden haría exactamente lo contrario de lo que promete.
 */
test("`Luz` y `luz` son la misma persona: su conversación no se le va al fondo", async (t) => {
  const db = await baseDePrueba(t);
  comoSupervisora(t, YO);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "MIA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");
  await asignar(db, "51900000002", "Luz"); // ← como lo escribe Cerberus

  const nombres = await orden(db, "luz"); // ← como entra ella
  assert.ok(
    nombres.indexOf("MIA") < nombres.indexOf("AJENA"),
    `se compara normalizando los dos lados — salió: ${nombres.join(", ")}`,
  );
});

test("sin vendedora (un servicio) el orden queda como antes: nada se reordena", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "AJENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", "ventas12");

  const nombres = await orden(db, undefined);
  assert.ok(nombres.includes("AJENA"), "sin identidad no hay «ajeno» que castigar");
});
