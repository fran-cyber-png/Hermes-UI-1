import { describe, it } from "node:test";
import assert from "node:assert";
import { crearAgente, type ClienteAnthropic } from "./agente.js";
import type { Turno, ResumenPieza } from "./acciones.js";
import type { Hecho } from "../hechos/catalogo.js";

function clienteFake(respuestas: Array<{ content: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }>): ClienteAnthropic {
  let idx = 0;
  return {
    messages: {
      create: (() => {
        const r = respuestas[idx] ?? respuestas[respuestas.length - 1]!;
        idx++;
        return Promise.resolve({
          id: "msg_1",
          model: "claude-haiku-4-5",
          role: "assistant" as const,
          type: "message" as const,
          content: r.content as any,
          stop_reason: r.stop_reason as any,
          stop_sequence: null,
          usage: r.usage as any,
        }) as any;
      }) as any,
    },
  };
}

const historial: Turno[] = [
  { rol: "lead", texto: "Hola, me interesa el diplomado de contrainteligencia" },
];

const base = {
  historial,
  contactoCtx: "<contacto>\nEstás hablando con Javier.\n</contacto>",
  hechos: [] as Hecho[],
  piezas: [] as ResumenPieza[],
  lecciones: [] as string[],
  modelo: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
};

describe("crearAgente", () => {
  it("respuesta limpia → texto sin acciones", async () => {
    const agente = crearAgente(
      clienteFake([{
        content: [{ type: "text", text: "¡Hola Javier! Soy Kathy." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }]),
    );
    const r = await agente.responder(base);
    assert.ok("texto" in r);
    if ("texto" in r) {
      assert.ok(r.texto);
      assert.ok(r.texto!.includes("Kathy"));
      assert.strictEqual(r.acciones.length, 0);
    }
  });

  it("tool mandar_pieza → la acción aparece en el array", async () => {
    const piezas: ResumenPieza[] = [
      { clase: "plantilla", id: "5", descripcion: "Flyer Contrainteligencia", enviable: true },
    ];
    const agente = crearAgente(
      clienteFake([
        {
          content: [
            { type: "text", text: "¡Claro! Te paso la información:" },
            { type: "tool_use", id: "toolu_1", name: "mandar_pieza", input: { id: "plantilla:5" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          content: [{ type: "text", text: "Listo, te envié la información." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 80, output_tokens: 30 },
        },
      ]),
    );
    const r = await agente.responder({ ...base, piezas });
    assert.ok("texto" in r);
    if ("texto" in r) {
      const mandarPieza = r.acciones.find((a) => a.tipo === "mandar_pieza");
      assert.ok(mandarPieza);
      if (mandarPieza && mandarPieza.tipo === "mandar_pieza") {
        assert.strictEqual(mandarPieza.id, "5");
      }
    }
  });

  it("texto con precio → guardrail bloquea, texto null + escalar error_bot", async () => {
    const agente = crearAgente(
      clienteFake([{
        content: [{ type: "text", text: "El diplomado cuesta $350 dólares. ¿Te interesa inscribirte?" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }]),
    );
    const r = await agente.responder(base);
    assert.ok("texto" in r);
    if ("texto" in r) {
      assert.strictEqual(r.texto, null);
      const escalar = r.acciones.find((a) => a.tipo === "escalar");
      assert.ok(escalar);
      if (escalar && escalar.tipo === "escalar") {
        assert.strictEqual(escalar.motivo, "error_bot");
      }
    }
  });

  it("texto que dice 'soy un bot' → guardrail bloquea", async () => {
    const agente = crearAgente(
      clienteFake([{
        content: [{ type: "text", text: "Soy un bot automático de Goberna." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }]),
    );
    const r = await agente.responder(base);
    assert.ok("texto" in r);
    if ("texto" in r) {
      assert.strictEqual(r.texto, null);
    }
  });

  it("cliente que lanza error → { error }, nunca throw", async () => {
    const malCliente: ClienteAnthropic = {
      messages: {
        create: (() => Promise.reject(new Error("Bedrock explotó"))) as any,
      },
    };
    const agente = crearAgente(malCliente);
    const r = await agente.responder(base);
    assert.ok("error" in r);
    if ("error" in r) {
      assert.ok((r as { error: string }).error.includes("Bedrock"));
    }
  });

  it("texto vacío → texto null", async () => {
    const agente = crearAgente(
      clienteFake([{
        content: [{ type: "text", text: " " }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10 },
      }]),
    );
    const r = await agente.responder(base);
    assert.ok("texto" in r);
    if ("texto" in r) {
      assert.strictEqual(r.texto, null);
    }
  });

  it("uso incluye tokens del modelo", async () => {
    const agente = crearAgente(
      clienteFake([{
        content: [{ type: "text", text: "Hola" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      }]),
    );
    const r = await agente.responder(base);
    assert.ok("uso" in r);
    if ("uso" in r) {
      assert.strictEqual(r.uso.modelo, "us.anthropic.claude-haiku-4-5-20251001-v1:0");
      assert.ok(r.uso.entrada > 0);
      assert.ok(r.uso.salida > 0);
    }
  });
});
