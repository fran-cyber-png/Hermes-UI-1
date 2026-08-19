import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarGestion, sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { etapaEfectiva } from "./etapaEfectivaSql.js";

/**
 * EL EMBUDO DE CAMPAÑA CONTRA LA BASE — su PARIDAD SQL ≡ TS (ADR 0063).
 *
 * Gemelo de `etapaEfectiva.paridad.test.db.ts`, que cubre el de ventas. La regla
 * vive dos veces por necesidad —la cola pagina en la base— y una sola por
 * diseño: esto es lo que impide que diverjan.
 *
 * 🔴 **Lo que sólo se puede ver acá y no en el test puro**: que la CONSULTA elija
 * el embudo correcto. `consultarCola` deriva el módulo de las líneas de quien
 * pide (`moduloDe`), y ese cableado es exactamente el tipo de cosa que se rompe
 * sin que ninguna función pura se entere — la lección de ADR 0024.
 */

const LINEA = "51963139984"; // la de campaña en producción
const OPERADORA = "centurion:betto.romero";
const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);
const claveDe = (personaId: string) => `conv:whatsapp:${personaId}:${LINEA}`;

type Fila = {
  persona_id: string | null;
  respondida: boolean;
  precio_enviado: boolean;
  etapa_manual: string | null;
  etapa_efectiva: string;
};

/** La cola COMO LA VE la operadora de campaña: de ahí sale el módulo. */
async function colaDeCampana(db: Parameters<typeof consultarCola>[0]) {
  const filas = (await consultarCola(db, { vendedoraId: OPERADORA }))
    .conversaciones as Fila[];
  return new Map(filas.map((f) => [f.persona_id, f]));
}

describe("el embudo de campaña contra la base", () => {
  test("🔴 una etapa declarada de campaña SOBREVIVE — no se la come el piso", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLineaDeVendedora(db, LINEA, [OPERADORA], "campana");
    // Contestó: el piso derivado es `contactado`.
    await sembrarMensaje(db, { personaId: "p-comprometida", numeroPropio: LINEA, occurredAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: "p-comprometida",
      numeroPropio: LINEA,
      direccion: "saliente",
      occurredAt: hace(1),
    });
    await sembrarGestion(db, { clave: claveDe("p-comprometida"), etapa: "comprometido" });

    const por = await colaDeCampana(db);
    const fila = por.get("p-comprometida");
    assert.equal(fila?.etapa_efectiva, "comprometido", "el SQL tiene que usar la escala de campaña");
    // Y la paridad: la función pura, con el MISMO módulo, dice lo mismo.
    assert.equal(
      etapaEfectiva(fila!.etapa_manual, fila!.respondida, fila!.precio_enviado, true, true, false, "campana"),
      fila?.etapa_efectiva,
    );
  });

  test("🔴 un precio en el hilo NO asciende a «cotizado» del lado de campaña", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLineaDeVendedora(db, LINEA, [OPERADORA], "campana");
    await sembrarMensaje(db, { personaId: "p-precio", numeroPropio: LINEA, occurredAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: "p-precio",
      numeroPropio: LINEA,
      direccion: "saliente",
      texto: "El aporte es de S/ 50",
      occurredAt: hace(1),
    });

    const por = await colaDeCampana(db);
    assert.equal(
      por.get("p-precio")?.etapa_efectiva,
      "contactado",
      "hablar de plata en una campaña no es haber cotizado nada",
    );
  });

  test("el arranque se comparte: sin respuesta cae en «Te esperan»", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLineaDeVendedora(db, LINEA, [OPERADORA], "campana");
    await sembrarMensaje(db, { personaId: "p-nueva", numeroPropio: LINEA, occurredAt: hace(3) });

    const por = await colaDeCampana(db);
    assert.equal(por.get("p-nueva")?.etapa_efectiva, "interesado");
  });

  test("«perdido» sigue siendo terminal", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLineaDeVendedora(db, LINEA, [OPERADORA], "campana");
    await sembrarMensaje(db, { personaId: "p-no", numeroPropio: LINEA, occurredAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: "p-no",
      numeroPropio: LINEA,
      direccion: "saliente",
      occurredAt: hace(1),
    });
    await sembrarGestion(db, { clave: claveDe("p-no"), etapa: "perdido" });

    const por = await colaDeCampana(db);
    assert.equal(por.get("p-no")?.etapa_efectiva, "perdido");
  });

  /**
   * 🔴 LA OTRA MITAD, y es la que hace que este archivo no pase en verde por
   * casualidad: la MISMA gestión, del lado de VENTAS, tiene que caer al piso.
   * Si algún día esto empieza a devolver «comprometido», es que las etapas de
   * campaña se colaron en la escala de la Escuela.
   */
  test("🔴 la misma declaración en una línea de VENTAS cae al piso", async (t) => {
    const db = await baseDePrueba(t);
    const LINEA_VENTAS = "51984429504";
    await sembrarLineaDeVendedora(db, LINEA_VENTAS, ["luz"]);
    await sembrarMensaje(db, { personaId: "p-vta", numeroPropio: LINEA_VENTAS, occurredAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: "p-vta",
      numeroPropio: LINEA_VENTAS,
      direccion: "saliente",
      occurredAt: hace(1),
    });
    await sembrarGestion(db, {
      clave: `conv:whatsapp:p-vta:${LINEA_VENTAS}`,
      etapa: "comprometido",
    });

    const filas = (await consultarCola(db, { vendedoraId: "luz" })).conversaciones as Fila[];
    const fila = filas.find((f) => f.persona_id === "p-vta");
    assert.equal(fila?.etapa_efectiva, "contactado", "en ventas «comprometido» no está en la escala");
  });
});
