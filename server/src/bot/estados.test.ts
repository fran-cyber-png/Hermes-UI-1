import { describe, it } from "node:test";
import assert from "node:assert";
import {
  transicionar,
  debeResponder,
  esTerminal,
  describirEstado,
  accionDesdeAgente,
  ESTADOS_ACTIVOS,
  ESTADOS_TERMINALES,
  type EstadoConversacion,
  type AccionEstado,
} from "./estados.js";

describe("estados del bot", () => {
  it("10 estados, sin duplicados", () => {
    const todos = [
      ...ESTADOS_ACTIVOS,
      ...ESTADOS_TERMINALES,
      "desconocido" as EstadoConversacion,
    ];
    // desconocido está en la lista pero no en activos ni terminales
    assert.equal(todos.length, 10);
    const set = new Set(todos);
    assert.equal(set.size, todos.length); // no hay duplicados entre activos y terminales
  });

  describe("transicionar", () => {
    it("saludo_inicial → saludo desde cualquier estado", () => {
      assert.deepEqual(transicionar("desconocido", { tipo: "saludo_inicial" }), {
        estado: "saludo",
        terminal: false,
      });
      assert.deepEqual(transicionar("enfriado", { tipo: "saludo_inicial" }), {
        estado: "saludo",
        terminal: false,
      });
    });

    it("bot_respondio avanza: desconocido → saludo → identificando → calificando → informando", () => {
      assert.deepEqual(transicionar("desconocido", { tipo: "bot_respondio" }), {
        estado: "saludo",
        terminal: false,
      });
      assert.deepEqual(transicionar("saludo", { tipo: "bot_respondio" }), {
        estado: "identificando",
        terminal: false,
      });
      assert.deepEqual(transicionar("identificando", { tipo: "bot_respondio" }), {
        estado: "calificando",
        terminal: false,
      });
      assert.deepEqual(transicionar("calificando", { tipo: "bot_respondio" }), {
        estado: "informando",
        terminal: false,
      });
    });

    it("bot_respondio en informando/cotizando/enfriado no cambia de fase", () => {
      for (const e of ["informando", "cotizando", "enfriado"] as EstadoConversacion[]) {
        assert.deepEqual(transicionar(e, { tipo: "bot_respondio" }), {
          estado: e,
          terminal: false,
        });
      }
    });

    it("lead_respondio desde enfriado vuelve a calificando", () => {
      assert.deepEqual(transicionar("enfriado", { tipo: "lead_respondio" }), {
        estado: "calificando",
        terminal: false,
      });
    });

    it("lead_respondio en otros estados no cambia nada", () => {
      assert.deepEqual(transicionar("calificando", { tipo: "lead_respondio" }), {
        estado: "calificando",
        terminal: false,
      });
    });

    it("interes_registrado → informando desde cualquier estado activo", () => {
      for (const e of ESTADOS_ACTIVOS) {
        assert.deepEqual(transicionar(e, { tipo: "interes_registrado" }), {
          estado: "informando",
          terminal: false,
        });
      }
    });

    it("escalacion → escalado (terminal)", () => {
      assert.deepEqual(transicionar("informando", { tipo: "escalacion", motivo: "por_cerrar" }), {
        estado: "escalado",
        terminal: true,
      });
    });

    it("pausa → pausado (terminal)", () => {
      assert.deepEqual(transicionar("calificando", { tipo: "pausa", motivo: "rechazo" }), {
        estado: "pausado",
        terminal: true,
      });
    });

    it("sin_respuesta → enfriado desde activos", () => {
      for (const e of ESTADOS_ACTIVOS) {
        assert.deepEqual(transicionar(e, { tipo: "sin_respuesta" }), {
          estado: "enfriado",
          terminal: false,
        });
      }
    });

    it("venta_cerrada → completado (terminal)", () => {
      assert.deepEqual(transicionar("informando", { tipo: "venta_cerrada" }), {
        estado: "completado",
        terminal: true,
      });
    });

    it("estados terminales no transicionan salvo excepciones", () => {
      // pausado no cambia con nada
      assert.deepEqual(transicionar("pausado", { tipo: "bot_respondio" }), {
        estado: "pausado",
        terminal: true,
      });
      assert.deepEqual(transicionar("completado", { tipo: "lead_respondio" }), {
        estado: "completado",
        terminal: true,
      });

      // escalado + lead_respondio → calificando (el lead vuelve a hablar)
      assert.deepEqual(transicionar("escalado", { tipo: "lead_respondio" }), {
        estado: "calificando",
        terminal: false,
      });

      // escalado + venta_cerrada → completado
      assert.deepEqual(transicionar("escalado", { tipo: "venta_cerrada" }), {
        estado: "completado",
        terminal: true,
      });
    });
  });

  describe("debeResponder", () => {
    it("los activos sí responden", () => {
      for (const e of ESTADOS_ACTIVOS) {
        assert.equal(debeResponder(e), true, `${e} debe responder`);
      }
    });

    it("los terminales y desconocido no responden", () => {
      for (const e of [...ESTADOS_TERMINALES, "desconocido" as EstadoConversacion]) {
        assert.equal(debeResponder(e), false, `${e} no debe responder`);
      }
    });
  });

  describe("esTerminal", () => {
    it("solo los terminales son terminales", () => {
      for (const e of ESTADOS_TERMINALES) {
        assert.equal(esTerminal(e), true);
      }
      for (const e of ESTADOS_ACTIVOS) {
        assert.equal(esTerminal(e), false);
      }
      assert.equal(esTerminal("desconocido"), false);
    });
  });

  describe("describirEstado", () => {
    it("todos los estados tienen descripción", () => {
      const todos: EstadoConversacion[] = [
        "desconocido",
        "saludo",
        "identificando",
        "calificando",
        "informando",
        "cotizando",
        "escalado",
        "pausado",
        "enfriado",
        "completado",
      ];
      for (const e of todos) {
        const d = describirEstado(e);
        assert.ok(typeof d === "string" && d.length > 10, `${e} tiene descripción`);
      }
    });
  });

  describe("accionDesdeAgente", () => {
    it("escalar → escalacion", () => {
      assert.deepEqual(
        accionDesdeAgente([{ tipo: "escalar", motivo: "pidio_humano" }]),
        { tipo: "escalacion", motivo: "pidio_humano" },
      );
    });

    it("pausar → pausa", () => {
      assert.deepEqual(
        accionDesdeAgente([{ tipo: "pausar", motivo: "rechazo" }]),
        { tipo: "pausa", motivo: "rechazo" },
      );
    });

    it("registrar_interes → interes_registrado", () => {
      assert.deepEqual(
        accionDesdeAgente([{ tipo: "registrar_interes", familia: "DIPCINTE" }]),
        { tipo: "interes_registrado" },
      );
    });

    it("escalar gana sobre pausar (orden de precedencia)", () => {
      assert.deepEqual(
        accionDesdeAgente([
          { tipo: "pausar", motivo: "despedida" },
          { tipo: "escalar", motivo: "pidio_humano" },
        ]),
        { tipo: "escalacion", motivo: "pidio_humano" },
      );
    });

    it("sin acciones relevantes → null", () => {
      assert.equal(
        accionDesdeAgente([{ tipo: "mandar_pieza", clase: "hecho", id: "cuotas" }]),
        null,
      );
    });

    it("lista vacía → null", () => {
      assert.equal(accionDesdeAgente([]), null);
    });
  });
});
