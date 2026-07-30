import { describe, it } from "node:test";
import assert from "node:assert";
import { crearTools } from "./tools.js";
import type { Accion, ResumenPieza } from "./acciones.js";

const catalogo: ResumenPieza[] = [
  { clase: "plantilla", id: "5", descripcion: "Flyer Contrainteligencia", enviable: true },
  { clase: "hecho", id: "cuotas", descripcion: "Se puede en 2 cuotas", enviable: false },
];

describe("crearTools", () => {
  it("mandar_pieza con id existente → acumula, devuelve confirmación", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["mandar_pieza"]!({ id: "plantilla:5" });
    assert.ok(result.includes("agendada"));
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "mandar_pieza",
      clase: "plantilla",
      id: "5",
    });
  });

  it("mandar_pieza con id inexistente → no acumula, devuelve error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["mandar_pieza"]!({ id: "plantilla:99" });
    assert.ok(result.includes("no existe"));
    assert.strictEqual(recolector.length, 0);
  });

  it("mandar_pieza con pieza no enviable → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["mandar_pieza"]!({ id: "hecho:cuotas" });
    assert.ok(result.includes("no se puede enviar"));
    assert.strictEqual(recolector.length, 0);
  });

  it("registrar_interes con familia válida → acumula", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["registrar_interes"]!({ familia: "DIPCINTE" });
    assert.ok(result.includes("registrado"));
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "registrar_interes",
      familia: "DIPCINTE",
    });
  });

  it("registrar_interes con familia inválida → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["registrar_interes"]!({ familia: "INVENTADA" });
    assert.ok(result.includes("no es una familia"));
    assert.strictEqual(recolector.length, 0);
  });

  it("calificar dos veces → queda la última", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    handlers["calificar"]!({ temperatura: "frio", motivo: "no responde" });
    handlers["calificar"]!({ temperatura: "caliente", motivo: "quiere pagar" });
    assert.strictEqual(recolector.length, 1);
    const accion = recolector[0];
    assert.strictEqual(accion.tipo, "calificar");
    if (accion.tipo === "calificar") {
      assert.strictEqual(accion.temperatura, "caliente");
      assert.strictEqual(accion.motivo, "quiere pagar");
    }
  });

  it("calificar con temperatura inválida → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["calificar"]!({ temperatura: "hirviendo", motivo: "x" });
    assert.ok(result.includes("debe ser"));
    assert.strictEqual(recolector.length, 0);
  });

  it("escalar_a_vendedora con motivo válido → acumula", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["escalar_a_vendedora"]!({ motivo: "pidio_humano" });
    assert.ok(result.includes("escalada"));
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "escalar",
      motivo: "pidio_humano",
    });
  });

  it("escalar_a_vendedora con motivo inválido → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["escalar_a_vendedora"]!({ motivo: "quiero_hablar" });
    assert.ok(result.includes("inválido"));
    assert.strictEqual(recolector.length, 0);
  });

  it("pausar_conversacion → acumula", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["pausar_conversacion"]!({ motivo: "rechazo" });
    assert.ok(result.includes("pausada"));
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "pausar",
      motivo: "rechazo",
    });
  });

  it("pausar_conversacion con motivo inválido → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["pausar_conversacion"]!({ motivo: "aburrido" });
    assert.ok(result.includes("debe ser"));
    assert.strictEqual(recolector.length, 0);
  });

  it("5 tools definidas", () => {
    const { definiciones } = crearTools([], catalogo);
    const nombres = definiciones.map((d) => d.name);
    assert.deepStrictEqual(nombres.sort(), [
      "calificar",
      "escalar_a_vendedora",
      "mandar_pieza",
      "pausar_conversacion",
      "registrar_interes",
    ]);
  });
});
