import { describe, it, expect } from "vitest";
import {
  motivoParaNoProbar,
  lecturaDeSilencio,
  TOPE_MENSAJE,
  type DetalleDeRespuesta,
} from "./entrenamiento";

const detalle = (p: Partial<DetalleDeRespuesta>): DetalleDeRespuesta => ({
  estado: "enviada",
  motivo: null,
  acciones: [],
  modelo: null,
  tokensEntrada: null,
  tokensSalida: null,
  ...p,
});

describe("motivoParaNoProbar", () => {
  it("con mensaje y línea, se puede probar", () => {
    expect(motivoParaNoProbar({ mensaje: "hola", esperando: false, linea: "51984429504" })).toBe(null);
  });

  it("un mensaje en blanco no se manda", () => {
    expect(motivoParaNoProbar({ mensaje: "   ", esperando: false, linea: "5198" })).toMatch(/Escribí/);
  });

  it("sin línea elegida, dice cuál falta — no falla en silencio", () => {
    expect(motivoParaNoProbar({ mensaje: "hola", esperando: false, linea: null })).toMatch(/línea/);
  });

  it("mientras espera no se puede mandar otro", () => {
    expect(motivoParaNoProbar({ mensaje: "hola", esperando: true, linea: "5198" })).toMatch(/Esperá/);
  });

  /**
   * El caso de ADR 0024: el tope tiene que decir CUÁNTO te pasaste. Un «no se
   * pudo» genérico manda a buscar el problema al lado equivocado.
   */
  it("pasado el tope, dice por cuánto", () => {
    const motivo = motivoParaNoProbar({
      mensaje: "x".repeat(TOPE_MENSAJE + 7),
      esperando: false,
      linea: "5198",
    });
    expect(motivo).toMatch(/7 caracteres/);
  });

  it("justo en el tope todavía entra", () => {
    expect(
      motivoParaNoProbar({ mensaje: "x".repeat(TOPE_MENSAJE), esperando: false, linea: "5198" }),
    ).toBe(null);
  });
});

describe("lecturaDeSilencio", () => {
  /**
   * Que el bot no hable NO es un error de la pantalla: es lo que una persona
   * real habría visto (nada). La lectura tiene que mandar a mirar el freno, no
   * a buscar un bug de red.
   */
  it("una respuesta bloqueada se explica como freno, no como falla", () => {
    const texto = lecturaDeSilencio(detalle({ estado: "bloqueada", motivo: "pausado" }));
    expect(texto).toMatch(/freno/i);
    expect(texto).toMatch(/pausado/);
  });

  it("el estado desconocido no rompe: se nombra tal cual", () => {
    const texto = lecturaDeSilencio(detalle({ estado: "algo_nuevo" }));
    expect(texto).toContain("algo_nuevo");
  });

  it("sin motivo no inventa uno", () => {
    expect(lecturaDeSilencio(detalle({ estado: "sin_respuesta" }))).not.toMatch(/Motivo/);
  });
});
