import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarGestion, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { etapaEfectiva } from "./etapaEfectivaSql.js";

/**
 * LA ETAPA EFECTIVA CONTRA LA BASE (#88, ADR 0013) — y su PARIDAD SQL ≡ TS.
 *
 * La regla vive dos veces por necesidad (la cola pagina en la base, así que la
 * etapa se calcula en SQL; la función pura es la definición canónica) y UNA vez
 * por diseño: este archivo es el candado que impide que diverjan, igual que
 * `urgencia.paridad.test.db.ts` lo es para la urgencia (#37). Siembra los casos
 * de la precedencia del dueño, pide la cola (el camino SQL) y verifica fila por
 * fila contra `etapaEfectiva(...)` (el camino puro).
 */

const NUMERO = "51999999999"; // el numeroPropio por defecto de sembrarMensaje
const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);
const claveDe = (personaId: string) => `conv:whatsapp:${personaId}:${NUMERO}`;

type Fila = {
  clave: string;
  persona_id: string | null;
  respondida: boolean;
  etapa_manual: string | null;
  etapa_efectiva: string;
};

async function colaPorPersona(db: Parameters<typeof consultarCola>[0]) {
  const filas = (await consultarCola(db, {})).conversaciones as Fila[];
  return new Map(filas.map((f) => [f.persona_id, f]));
}

describe("etapa efectiva en la cola (SQL) — la precedencia del dueño", () => {
  test("sin gestión: respondida → contactado; sin responder → interesado", async (t) => {
    const db = await baseDePrueba(t);
    // Le respondimos: entrante y después un saliente.
    await sembrarMensaje(db, { personaId: "p-respondida", occurredAt: hace(5) });
    await sembrarMensaje(db, { personaId: "p-respondida", direccion: "saliente", occurredAt: hace(1) });
    // Nadie le respondió todavía.
    await sembrarMensaje(db, { personaId: "p-nueva", occurredAt: hace(3) });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-respondida")?.etapa_efectiva, "contactado", "respondimos = contactado, sin arrastrar nada");
    assert.equal(por.get("p-respondida")?.etapa_manual, null, "no hubo gestión: la etapa es derivada");
    assert.equal(por.get("p-nueva")?.etapa_efectiva, "interesado");
  });

  test("manual interesado + respondida → contactado (el piso derivado empuja)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-piso", occurredAt: hace(5) });
    await sembrarMensaje(db, { personaId: "p-piso", direccion: "saliente", occurredAt: hace(1) });
    await sembrarGestion(db, { clave: claveDe("p-piso"), etapa: "interesado" });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-piso")?.etapa_efectiva, "contactado");
  });

  test("manual cotizado + no respondida → cotizado (la manual avanzada gana; no baja)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-cotizada", occurredAt: hace(5) });
    await sembrarGestion(db, { clave: claveDe("p-cotizada"), etapa: "cotizado" });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-cotizada")?.etapa_efectiva, "cotizado");
    assert.equal(por.get("p-cotizada")?.respondida, false);
  });

  test("manual cierre → cierre", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-cerrada", occurredAt: hace(5) });
    await sembrarGestion(db, { clave: claveDe("p-cerrada"), etapa: "cierre" });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-cerrada")?.etapa_efectiva, "cierre");
  });

  test("perdido es TERMINAL: respondida no lo resucita", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-perdida", occurredAt: hace(5) });
    await sembrarMensaje(db, { personaId: "p-perdida", direccion: "saliente", occurredAt: hace(1) });
    await sembrarGestion(db, { clave: claveDe("p-perdida"), etapa: "perdido" });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-perdida")?.etapa_efectiva, "perdido");
  });

  test("la ÚLTIMA gestión manda (append-only): cotizado y después perdido = perdido", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-historia", occurredAt: hace(5) });
    await sembrarGestion(db, { clave: claveDe("p-historia"), etapa: "cotizado", creadoAt: hace(4) });
    await sembrarGestion(db, { clave: claveDe("p-historia"), etapa: "perdido", creadoAt: hace(2) });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-historia")?.etapa_efectiva, "perdido");
  });

  test("dos gestiones con el MISMO creado_at: gana la última asentada (id), no el azar", async (t) => {
    const db = await baseDePrueba(t);
    // El escenario real: dos gestiones seguidas caen en el mismo tick del reloj
    // (o un backfill las insertó con el mismo timestamp). Sin desempate, el
    // DISTINCT ON elige CUALQUIERA — y la etapa de la conversación queda al azar.
    const empate = hace(2);
    await sembrarMensaje(db, { personaId: "p-empate", occurredAt: hace(5) });
    await sembrarGestion(db, { clave: claveDe("p-empate"), etapa: "cotizado", creadoAt: empate });
    await sembrarGestion(db, { clave: claveDe("p-empate"), etapa: "perdido", creadoAt: empate });

    const por = await colaPorPersona(db);
    assert.equal(
      por.get("p-empate")?.etapa_efectiva,
      "perdido",
      "el desempate es id DESC: la última fila insertada ES la etapa declarada",
    );
  });

  test("los valores viejos se normalizan al leer: 'venta'→cierre, 'nuevo'+respondida→contactado", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-venta-vieja", occurredAt: hace(5) });
    await sembrarGestion(db, { clave: claveDe("p-venta-vieja"), etapa: "venta" });
    await sembrarMensaje(db, { personaId: "p-nuevo-viejo", occurredAt: hace(5) });
    await sembrarMensaje(db, { personaId: "p-nuevo-viejo", direccion: "saliente", occurredAt: hace(1) });
    await sembrarGestion(db, { clave: claveDe("p-nuevo-viejo"), etapa: "nuevo" });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-venta-vieja")?.etapa_efectiva, "cierre");
    assert.equal(por.get("p-nuevo-viejo")?.etapa_efectiva, "contactado");
  });

  test("los comentarios FB/IG juegan con la misma regla: respondido → contactado", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarComentario(db, { personaId: "c-nuevo", occurredAt: hace(3) });
    await sembrarComentario(db, { personaId: "c-atendido", occurredAt: hace(3), status: "contactado" });

    const por = await colaPorPersona(db);
    assert.equal(por.get("c-nuevo")?.etapa_efectiva, "interesado");
    assert.equal(por.get("c-atendido")?.etapa_efectiva, "contactado");
  });

  test("fuera de la ventana de 30 días no entra, ni con gestión asentada", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-vieja", occurredAt: hace(31 * 24) });
    await sembrarGestion(db, { clave: claveDe("p-vieja"), etapa: "cotizado" });

    const { conversaciones } = await consultarCola(db, {});
    assert.equal(conversaciones.length, 0, "la cola y sus etapas comparten la MISMA ventana de 30 días");
  });
});

describe("paridad SQL ≡ TS de la etapa efectiva (ADR 0013)", () => {
  test("fila por fila, la etapa del SQL es la que calcularía etapaEfectiva con los mismos datos", async (t) => {
    const db = await baseDePrueba(t);
    // Un conjunto que cubre TODAS las ramas de la precedencia: derivadas puras,
    // piso que empuja, manual que gana, perdido terminal y valores viejos.
    await sembrarMensaje(db, { personaId: "p1", occurredAt: hace(5) }); // interesado derivado
    await sembrarMensaje(db, { personaId: "p2", occurredAt: hace(5) }); // contactado derivado
    await sembrarMensaje(db, { personaId: "p2", direccion: "saliente", occurredAt: hace(1) });
    await sembrarMensaje(db, { personaId: "p3", occurredAt: hace(5) }); // piso empuja a manual interesado
    await sembrarMensaje(db, { personaId: "p3", direccion: "saliente", occurredAt: hace(1) });
    await sembrarGestion(db, { clave: claveDe("p3"), etapa: "interesado" });
    await sembrarMensaje(db, { personaId: "p4", occurredAt: hace(5) }); // manual cotizado gana
    await sembrarGestion(db, { clave: claveDe("p4"), etapa: "cotizado" });
    await sembrarMensaje(db, { personaId: "p5", occurredAt: hace(5) }); // perdido terminal
    await sembrarMensaje(db, { personaId: "p5", direccion: "saliente", occurredAt: hace(1) });
    await sembrarGestion(db, { clave: claveDe("p5"), etapa: "perdido" });
    await sembrarMensaje(db, { personaId: "p6", occurredAt: hace(5) }); // valor viejo 'venta'
    await sembrarGestion(db, { clave: claveDe("p6"), etapa: "venta" });
    await sembrarComentario(db, { personaId: "c1", occurredAt: hace(3) }); // comentario sin responder
    await sembrarComentario(db, { personaId: "c2", occurredAt: hace(3), status: "contactado" });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    assert.equal(filas.length, 8, "el conjunto de paridad entra entero en la ventana");

    for (const fila of filas) {
      assert.equal(
        fila.etapa_efectiva,
        etapaEfectiva(fila.etapa_manual, fila.respondida),
        `la fila ${fila.clave} salió con «${fila.etapa_efectiva}» del SQL pero la función pura dice otra cosa`,
      );
    }
  });
});
