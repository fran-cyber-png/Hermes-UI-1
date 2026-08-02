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

  it("🔴 el TEXTO de la vuelta con tool_use sobrevive: nunca un flyer sin palabras", async () => {
    // La regresión que esto fija: el bucle metía el `content` entero en
    // `messages` y hacía `continue`, y `texto` se calculaba recién sobre la
    // respuesta FINAL. Todo lo dicho en la vuelta donde el modelo pide la pieza
    // se perdía. Con `mandar_pieza` conectada (F3) eso es un archivo suelto
    // llegándole al lead desde un número que no conoce, sin una sola palabra.
    const piezas: ResumenPieza[] = [
      { clase: "plantilla", id: "5", descripcion: "Flyer Inteligencia", enviable: true },
    ];
    const agente = crearAgente(
      clienteFake([
        {
          content: [
            { type: "text", text: "Claro Javier, te paso el flyer ahora mismo." },
            { type: "tool_use", id: "toolu_1", name: "mandar_pieza", input: { id: "plantilla:5" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        // El caso peor: la vuelta final no agrega NADA. Antes esto dejaba
        // `texto: null` con la acción cargada.
        { content: [], stop_reason: "end_turn", usage: { input_tokens: 80, output_tokens: 5 } },
      ]),
    );
    const r = await agente.responder({ ...base, piezas });
    assert.ok("texto" in r);
    if (!("texto" in r)) return;
    assert.ok(r.texto, "el texto de la primera vuelta no se puede tirar");
    assert.ok(r.texto!.includes("te paso el flyer"));
    assert.ok(r.acciones.some((a) => a.tipo === "mandar_pieza"));
  });

  it("el texto de las dos vueltas se une, en orden", async () => {
    const piezas: ResumenPieza[] = [
      { clase: "plantilla", id: "5", descripcion: "Flyer", enviable: true },
    ];
    const agente = crearAgente(
      clienteFake([
        {
          content: [
            { type: "text", text: "Te paso el flyer." },
            { type: "tool_use", id: "toolu_1", name: "mandar_pieza", input: { id: "plantilla:5" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          content: [{ type: "text", text: "¿Te queda alguna duda?" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 80, output_tokens: 30 },
        },
      ]),
    );
    const r = await agente.responder({ ...base, piezas });
    assert.ok("texto" in r);
    if (!("texto" in r)) return;
    assert.equal(r.texto, "Te paso el flyer.\n\n¿Te queda alguna duda?");
  });

  it("🔴 un precio dicho ANTES de la tool bloquea igual: el guardrail ve el turno entero", async () => {
    // Sin acumular, el guardrail solo miraba el último pedazo y una cifra dicha
    // en la primera vuelta salía intacta hacia el lead.
    const piezas: ResumenPieza[] = [
      { clase: "plantilla", id: "5", descripcion: "Flyer", enviable: true },
    ];
    const agente = crearAgente(
      clienteFake([
        {
          content: [
            { type: "text", text: "El diplomado cuesta $350 dólares, te paso el flyer." },
            { type: "tool_use", id: "toolu_1", name: "mandar_pieza", input: { id: "plantilla:5" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          content: [{ type: "text", text: "Listo." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 80, output_tokens: 30 },
        },
      ]),
    );
    const r = await agente.responder({ ...base, piezas });
    assert.ok("texto" in r);
    if (!("texto" in r)) return;
    assert.equal(r.texto, null);
    // Y la pieza NO viaja: bloquear el texto tiene que bloquear el turno entero,
    // o el lead recibe el flyer del mensaje que se censuró.
    assert.ok(!r.acciones.some((a) => a.tipo === "mandar_pieza"));
    assert.ok(r.acciones.some((a) => a.tipo === "escalar"));
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

  it("🔴 el bloque <contacto> viaja en TODAS las iteraciones, no solo en la primera", async () => {
    // La regresión: el `<contacto>` (nombre, país, interés) se mandaba solo
    // cuando `iter === 0`. De la segunda vuelta en adelante el system era el
    // string grande a secas, así que el bot olvidaba con quién hablaba **justo
    // después de usar una tool** — que es cuando más lo necesita.
    const systems: unknown[] = [];
    const piezas: ResumenPieza[] = [
      { clase: "plantilla", id: "5", descripcion: "Flyer Inteligencia", enviable: true },
    ];
    const respuestas = [
      {
        content: [
          { type: "text", text: "Te paso la información." },
          { type: "tool_use", id: "toolu_1", name: "mandar_pieza", input: { id: "plantilla:5" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      {
        content: [{ type: "text", text: "Listo, Javier." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 80, output_tokens: 30 },
      },
    ];
    let idx = 0;
    const espia: ClienteAnthropic = {
      messages: {
        create: ((args: { system: unknown }) => {
          systems.push(args.system);
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

    await crearAgente(espia).responder({ ...base, piezas });

    assert.strictEqual(systems.length, 2, "hubo dos vueltas del tool loop");
    for (const [i, system] of systems.entries()) {
      const serializado = JSON.stringify(system);
      assert.ok(
        serializado.includes("Javier"),
        `la iteración ${i} perdió el bloque <contacto>`,
      );
    }
  });

  it("el system cacheado es el PREFIJO: el bloque volátil del contacto va después", async () => {
    // Si el contacto quedara primero, el prefijo dejaría de ser estable turno a
    // turno y el `cache_control` no pegaría nunca.
    let capturado: unknown = null;
    const espia: ClienteAnthropic = {
      messages: {
        create: ((args: { system: unknown }) => {
          capturado ??= args.system;
          return Promise.resolve({
            id: "msg_1",
            model: "claude-haiku-4-5",
            role: "assistant" as const,
            type: "message" as const,
            content: [{ type: "text", text: "Hola" }] as any,
            stop_reason: "end_turn" as any,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 } as any,
          }) as any;
        }) as any,
      },
    };

    await crearAgente(espia).responder(base);

    const bloques = capturado as { text: string; cache_control?: unknown }[];
    assert.ok(Array.isArray(bloques));
    assert.ok(bloques[0]!.cache_control, "el primer bloque es el cacheado");
    assert.ok(bloques[0]!.text.includes("<rol>"), "el primer bloque es el system grande");
    assert.ok(bloques[1]!.text.includes("<contacto>"), "el contacto va segundo");
    assert.strictEqual(bloques[1]!.cache_control, undefined, "el contacto NO se cachea");
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
