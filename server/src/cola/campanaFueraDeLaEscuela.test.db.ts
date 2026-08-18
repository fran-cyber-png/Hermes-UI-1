import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { COMO_SUPERVISORA, COMO_VENDEDORA, comoRol } from "../pruebas/rol.js";
import { PROPOSITO_CAMPANA } from "../numeros/campana.js";
import { consultarCola, contarPorEtapaEfectiva } from "./consultarCola.js";
import { consultarRadar } from "./consultarRadar.js";

/**
 * LA CAMPAÑA NO ENTRA A LA MESA DE LA ESCUELA — ni la cola, ni el Pipeline, ni
 * el radar (`numeros/campana.ts`, decisión del dueño del 18-ago-2026).
 *
 * ── Por qué hace falta un test con base y no alcanzan los puros ─────────────
 *
 * La regla pura ya está fijada (`numeros/campana.test.ts`) y su gemelo SQL
 * también (`campana.paridad.test.db.ts`). Lo que **ninguno de los dos ve** es si
 * el predicado llegó a estar EN las consultas: es el defecto de ADR 0024 —la
 * regla impecable y el cableado ausente— y acá es exactamente el modo de fallar
 * que importa, porque la consulta sale igual de verde sin el `AND`.
 *
 * ── 🔴 EL SUJETO DE ESTOS TESTS ES UN SUPERVISOR, A PROPÓSITO ──────────────
 *
 * Todas las demás fronteras de Hermes se abren con el rol. Ésta no, y si alguien
 * la enchufa donde vive `veTodo` estos tests se ponen rojos — que es lo único
 * que impide que la excepción se «unifique» con las otras dentro de seis meses.
 */

/** Los dos planos, con los números reales de producción. */
const ESCUELA = "51984429504";
const CAMPANA = "51963139984";

/** Quien atiende la campaña. En producción es `usuario2` + `centurion:betto.romero`. */
const DE_LA_CAMPANA = "usuario2";

async function sembrarLosDosPlanos(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  // La grafía de `numero_vendedora` es la que empuja Cerberus (mayúscula), y el
  // token trae la del login: si esto se comparara exacto, quien atiende la
  // campaña perdería su propia cola.
  await sembrarLineaDeVendedora(db, ESCUELA, ["Luz"], "vendedora");
  await sembrarLineaDeVendedora(db, CAMPANA, ["Usuario2"], PROPOSITO_CAMPANA);
  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "LEAD_ESCUELA",
    texto: "hola, quiero el diploma",
    numeroPropio: ESCUELA,
  });
  await sembrarMensaje(db, {
    personaId: "51900000002",
    personaNombre: "LEAD_CAMPANA",
    texto: "hola, apoyo la candidatura",
    numeroPropio: CAMPANA,
  });
}

async function nombresEnLaCola(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  vendedoraId: string,
  rol = COMO_VENDEDORA,
) {
  const r = await consultarCola(db, { vendedoraId, limit: 50 }, rol);
  return (r.conversaciones as { persona_nombre: string | null }[]).map((c) => c.persona_nombre);
}

describe("la línea de campaña no se sirve a la Escuela", () => {
  test("🔴 un SUPERVISOR de ventas no ve el lead de la campaña — el rol no abre esta puerta", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const ve = await nombresEnLaCola(db, "alex", COMO_SUPERVISORA);
    assert.ok(ve.includes("LEAD_ESCUELA"), `tiene que ver la Escuela — vio: ${ve.join(", ")}`);
    assert.ok(!ve.includes("LEAD_CAMPANA"), `no puede ver la campaña — vio: ${ve.join(", ")}`);
  });

  test("🔴 un ADMIN tampoco: alan y usuario1 son admin, y el pedido los nombra", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const ve = await nombresEnLaCola(db, "alan", comoRol("admin"));
    assert.ok(!ve.includes("LEAD_CAMPANA"), `no puede ver la campaña — vio: ${ve.join(", ")}`);
  });

  test("una vendedora de la Escuela tampoco la ve", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const ve = await nombresEnLaCola(db, "luz");
    assert.ok(!ve.includes("LEAD_CAMPANA"), `no puede ver la campaña — vio: ${ve.join(", ")}`);
  });

  test("quien SÍ atiende la campaña la ve — el recorte es por línea, no un apagón", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const ve = await nombresEnLaCola(db, DE_LA_CAMPANA);
    assert.ok(ve.includes("LEAD_CAMPANA"), `tiene que ver lo suyo — vio: ${ve.join(", ")}`);
  });

  test("🔴 y los CONTEOS tampoco la cuentan: el número de la cabecera y las filas dicen lo mismo", async (t) => {
    // La frontera del padrón se escribió mal una vez justo así: recortaba las
    // filas y dejaba el total sin tocar, o sea una cabecera que afirma lo que la
    // lista no muestra.
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const r = await consultarCola(db, { vendedoraId: "alex", limit: 50 }, COMO_SUPERVISORA);
    assert.equal(r.total, 1, "el total tiene que ser el de las filas que se sirven");
    assert.equal((r.conversaciones as unknown[]).length, 1);
  });

  test("🔴 lo que NO entró por ninguna línea nuestra pasa igual — los comentarios de FB/IG", async (t) => {
    // Un `NOT IN` a secas los tiraría a todos: `NULL NOT IN (...)` es NULL, o
    // sea falso en un WHERE. Y ese defecto se leería como «se cayeron los
    // comentarios», nunca como una frontera de más.
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);
    await sembrarComentario(db, { personaNombre: "COMENTARIO_FB", canal: "facebook" });

    const ve = await nombresEnLaCola(db, "alex", COMO_SUPERVISORA);
    assert.ok(ve.includes("COMENTARIO_FB"), `el comentario tiene que pasar — vio: ${ve.join(", ")}`);
  });

  test("una línea SIN registrar no se veda: la frontera es de lo declarado", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);
    // En producción hay tráfico por `51987654321`, que no tiene fila en `numeros_wa`.
    await sembrarMensaje(db, {
      personaId: "51900000003",
      personaNombre: "LINEA_SUELTA",
      numeroPropio: "51987654321",
    });

    const ve = await nombresEnLaCola(db, "alex", COMO_SUPERVISORA);
    assert.ok(ve.includes("LINEA_SUELTA"), `no hay propósito que leer — vio: ${ve.join(", ")}`);
  });

  test("🔴 el EMBUDO del Dashboard tampoco la suma", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const conCampana = await contarPorEtapaEfectiva(db, null, DE_LA_CAMPANA);
    const sinCampana = await contarPorEtapaEfectiva(db, null, "alex");
    const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
    assert.equal(total(conCampana), 2, "quien atiende la campaña ve las dos");
    assert.equal(total(sinCampana), 1, "el supervisor de ventas ve una sola");
  });

  test("🔴 y el RADAR tampoco", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLosDosPlanos(db);

    const ve = (await consultarRadar(db, new Date(), null, "alex")).map((c) => c.persona_nombre);
    assert.ok(ve.includes("LEAD_ESCUELA"), `tiene que ver la Escuela — vio: ${ve.join(", ")}`);
    assert.ok(!ve.includes("LEAD_CAMPANA"), `no puede ver la campaña — vio: ${ve.join(", ")}`);
  });
});
