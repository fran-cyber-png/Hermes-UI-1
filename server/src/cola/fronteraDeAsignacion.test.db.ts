import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola } from "./consultarCola.js";

/**
 * LA FRONTERA: LO DE OTRA VENDEDORA NO SE SIRVE.
 *
 * ── Lo que pasó el 14-ago-2026 ──────────────────────────────────────────────
 *
 * Entró una vendedora nueva a la línea compartida y su primera pantalla fueron
 * **1.158 conversaciones de Luz**, ninguna suya. El reparto existía desde el
 * 4-ago, pero era un FILTRO: `?mios=1` recortaba la vista y bastaba un clic
 * para ver el trabajo ajeno.
 *
 * El pedido del dueño fue «asegurarnos 100 % que no se crucen los datos», y a
 * eso un recorte del navegador no puede contestar que sí: los datos ya
 * viajaron. Estos tests fijan que el recorte viva en el `WHERE`.
 *
 * ── Lo que NO prueban, y hay que tenerlo claro ──────────────────────────────
 *
 * Que el hilo y la ficha sigan sirviendo cualquier conversación por su clave.
 * Eso es un modelo de permisos y Hermes no lo tiene. Lo que se garantiza es que
 * **no aparezca en la cola de quien no la trabaja**.
 */

const LINEA = "51984429504";
const LUZ = "luz";
const SINDY = "Sindy";

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

/**
 * La frontera es OPT-IN por vendedora (`HERMES_COLA_AISLADA`). Estos tests la
 * encienden a mano: sin eso el comportamiento es el de siempre, y el test
 * pasaría verde sin probar nada.
 */
function conColaAislada(t: { after: (fn: () => void) => void }, quienes: string) {
  const antes = process.env.HERMES_COLA_AISLADA;
  process.env.HERMES_COLA_AISLADA = quienes;
  t.after(() => {
    if (antes === undefined) delete process.env.HERMES_COLA_AISLADA;
    else process.env.HERMES_COLA_AISLADA = antes;
  });
}

async function nombresQueVe(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  vendedoraId: string | undefined,
) {
  const r = (await consultarCola(db, { vendedoraId, limite: 50 } as never)) as {
    conversaciones?: { persona_nombre: string | null }[];
  };
  return (r.conversaciones ?? []).map((c) => c.persona_nombre);
}

/** Tres conversaciones: una de Luz, una de Sindy, una sin dueña. */
async function sembrarLaMesa(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "DE_LUZ", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "DE_SINDY", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000003", personaNombre: "SIN_DUENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", LUZ);
  await asignar(db, "51900000002", SINDY);
}

test("🔴 una vendedora nueva NO ve las conversaciones de otra", async (t) => {
  const db = await baseDePrueba(t);
  conColaAislada(t, "sindy");
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(!ve.includes("DE_LUZ"), `no puede ver lo de Luz — vio: ${ve.join(", ")}`);
  assert.ok(ve.includes("DE_SINDY"), "tiene que ver lo suyo");
});

test("lo que NO tiene dueña se sigue viendo: es de quien lo agarre", async (t) => {
  const db = await baseDePrueba(t);
  conColaAislada(t, "sindy,luz");
  await sembrarLaMesa(db);

  for (const quien of ["sindy", "luz"]) {
    const ve = await nombresQueVe(db, quien);
    assert.ok(ve.includes("SIN_DUENA"), `${quien} tiene que ver lo huérfano — vio: ${ve.join(", ")}`);
  }
});

/**
 * 🔴 El caso que rompe la frontera si se compara de un solo lado: en producción
 * conviven `Sindy` (lo escribe Cerberus) y `sindy` (lo que ella tipea). Con
 * comparación exacta, sus propias conversaciones le quedarían invisibles — y
 * eso no se ve como un error, se ve como una cola vacía.
 */
test("`Sindy` y `sindy` son la misma persona: ve lo suyo", async (t) => {
  const db = await baseDePrueba(t);
  conColaAislada(t, "Sindy"); // ← declarada con mayúscula, entra en minúscula
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, "sindy"); // ← entra en minúscula
  assert.ok(ve.includes("DE_SINDY"), `se compara normalizando — vio: ${ve.join(", ")}`);
});

test("la supervisora ve todo: es quien reparte lo que todavía no tiene dueña", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  conColaAislada(t, "jefa");
  const antes = process.env.HERMES_SUPERVISORES;
  process.env.HERMES_SUPERVISORES = "jefa";
  t.after(() => {
    if (antes === undefined) delete process.env.HERMES_SUPERVISORES;
    else process.env.HERMES_SUPERVISORES = antes;
  });

  const ve = await nombresQueVe(db, "jefa");
  for (const n of ["DE_LUZ", "DE_SINDY", "SIN_DUENA"]) {
    assert.ok(ve.includes(n), `la supervisora tiene que ver ${n} — vio: ${ve.join(", ")}`);
  }
});

test("sin identidad (un servicio) no se recorta nada", async (t) => {
  const db = await baseDePrueba(t);
  conColaAislada(t, "sindy,luz");
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, undefined);
  assert.equal(ve.length, 3, `un servicio ve las tres — vio: ${ve.join(", ")}`);
});

test("🔴 sin declararla, la frontera NO se aplica: el comportamiento viejo es el probado", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db); // sin `conColaAislada`

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(ve.includes("DE_LUZ"), `apagada, ve todo — vio: ${ve.join(", ")}`);
});
