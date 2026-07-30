import { describe, it } from "node:test";
import assert from "node:assert";
import { decidir, type HechosParaDecidir } from "./decision.js";

const base: HechosParaDecidir = {
  modo: "automatico",
  lineaHabilitada: true,
  pausa: null,
  huboSalienteHumanoDespuesDe: null,
  entranteEsRepetido: false,
  turnosHoy: 0,
  maxTurnosDia: 40,
  respuestasUltimaHoraLinea: 0,
  maxRespuestasHoraLinea: 60,
  transporteConectado: true,
  frenado: false,
};

describe("decidir", () => {
  it("caso feliz: todo OK → responder", () => {
    assert.deepStrictEqual(decidir(base), { accion: "responder" });
  });

  it("apagado → saltar", () => {
    assert.deepStrictEqual(decidir({ ...base, modo: "apagado" }), {
      accion: "saltar",
      motivo: "apagado",
    });
  });

  it("linea no habilitada → saltar", () => {
    assert.deepStrictEqual(decidir({ ...base, lineaHabilitada: false }), {
      accion: "saltar",
      motivo: "linea_no_habilitada",
    });
  });

  it("frenado → saltar", () => {
    assert.deepStrictEqual(decidir({ ...base, frenado: true }), {
      accion: "saltar",
      motivo: "frenado",
    });
  });

  it("pausa indefinida → saltar", () => {
    assert.deepStrictEqual(
      decidir({ ...base, pausa: { motivo: "rechazo", hasta: null } }),
      { accion: "saltar", motivo: "pausado" },
    );
  });

  it("pausa vigente → saltar", () => {
    const futuro = new Date(Date.now() + 3600_000);
    assert.deepStrictEqual(
      decidir({ ...base, pausa: { motivo: "spam", hasta: futuro } }),
      { accion: "saltar", motivo: "pausado" },
    );
  });

  it("pausa vencida → no salta por pausa, sigue evaluando", () => {
    const pasado = new Date(Date.now() - 3600_000);
    assert.deepStrictEqual(
      decidir({ ...base, pausa: { motivo: "spam", hasta: pasado } }),
      { accion: "responder" },
    );
  });

  it("vendedora activa → saltar", () => {
    assert.deepStrictEqual(
      decidir({ ...base, huboSalienteHumanoDespuesDe: new Date() }),
      { accion: "saltar", motivo: "vendedora_activa" },
    );
  });

  it("spam → saltar", () => {
    assert.deepStrictEqual(decidir({ ...base, entranteEsRepetido: true }), {
      accion: "saltar",
      motivo: "spam",
    });
  });

  it("tope de turnos → saltar", () => {
    assert.deepStrictEqual(
      decidir({ ...base, turnosHoy: 40, maxTurnosDia: 40 }),
      { accion: "saltar", motivo: "tope_turnos" },
    );
  });

  it("tope de línea → saltar", () => {
    assert.deepStrictEqual(
      decidir({ ...base, respuestasUltimaHoraLinea: 60, maxRespuestasHoraLinea: 60 }),
      { accion: "saltar", motivo: "tope_linea" },
    );
  });

  it("transporte desconectado → saltar", () => {
    assert.deepStrictEqual(decidir({ ...base, transporteConectado: false }), {
      accion: "saltar",
      motivo: "desconectado",
    });
  });

  it("el orden fijado: dos motivos válidos → gana el primero", () => {
    const futuro = new Date(Date.now() + 3600_000);
    assert.deepStrictEqual(
      decidir({
        ...base,
        frenado: true,
        pausa: { motivo: "rechazo", hasta: futuro },
      }),
      { accion: "saltar", motivo: "frenado" },
    );
  });

  it("el orden fijado: pausa gana sobre spam", () => {
    const futuro = new Date(Date.now() + 3600_000);
    assert.deepStrictEqual(
      decidir({
        ...base,
        pausa: { motivo: "spam", hasta: futuro },
        entranteEsRepetido: true,
        turnosHoy: 100,
      }),
      { accion: "saltar", motivo: "pausado" },
    );
  });

  it("modo sombra también es válido para responder", () => {
    assert.deepStrictEqual(decidir({ ...base, modo: "sombra" }), {
      accion: "responder",
    });
  });
});
