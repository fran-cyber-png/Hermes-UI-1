import type Anthropic from "@anthropic-ai/sdk";
import { validarSalida } from "./guardrails.js";
import { armarSystemPrompt, armarContextoContacto } from "./prompt.js";
import { crearTools } from "./tools.js";
import { trocear } from "./chunker.js";
import type { Accion, RespuestaBot, Turno, ResumenPieza } from "./acciones.js";
import type { Hecho } from "../hechos/catalogo.js";

export interface ClienteAnthropic {
  messages: Pick<Anthropic["messages"], "create">;
}

interface EntradaAgente {
  historial: Turno[];
  contactoCtx: string;
  hechos: Hecho[];
  piezas: ResumenPieza[];
  lecciones: string[];
  modelo: string;
  familiasValidas?: ReadonlySet<string>;
  /** Lo que esta conversación ya recibió (`plantilla:12`). Ver `crearTools`. */
  piezasYaEnviadas?: ReadonlySet<string>;
}

type ContentBlock = 
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

type MessageParam =
  | { role: "user"; content: string | ContentBlock[] }
  | { role: "assistant"; content: string | ContentBlock[] };

const MAX_ITERATIONS = 4;

function acumularUso(
  resultado: Anthropic.Messages.Message,
  modelo: string,
): RespuestaBot["uso"] {
  const u = resultado.usage;
  const extra = u as unknown as Record<string, number> | undefined;
  return {
    entrada: u?.input_tokens ?? 0,
    salida: u?.output_tokens ?? 0,
    cacheEscritura: extra?.cache_creation_input_tokens ?? 0,
    cacheLectura: extra?.cache_read_input_tokens ?? 0,
    modelo,
  };
}

/** Los bloques de texto de UNA respuesta, unidos y recortados. */
function textoDe(content: ContentBlock[]): string {
  return content
    .filter((c): c is Extract<ContentBlock, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

export function crearAgente(cliente: ClienteAnthropic) {
  return {
    async responder(
      entrada: EntradaAgente,
    ): Promise<RespuestaBot | { error: string; codigo: string }> {
      const sistemaGrande = armarSystemPrompt({
        hechos: entrada.hechos,
        piezas: entrada.piezas,
        lecciones: entrada.lecciones,
      });

      const acciones: Accion[] = [];
      const { definiciones, handlers } = crearTools(
        acciones,
        entrada.piezas,
        entrada.familiasValidas,
        entrada.piezasYaEnviadas,
      );

      const messages: MessageParam[] = [];
      for (const t of entrada.historial) {
        if (!t.texto) continue;
        const role = t.rol === "lead" ? "user" : "assistant";
        messages.push({ role: role as "user" | "assistant", content: t.texto });
      }

      try {
        let uso: RespuestaBot["uso"] = {
          entrada: 0,
          salida: 0,
          cacheEscritura: 0,
          cacheLectura: 0,
          modelo: entrada.modelo,
        };

        /**
         * EL SYSTEM ES EL MISMO EN TODAS LAS ITERACIONES — y antes no lo era.
         *
         * El bloque `<contacto>` (nombre, país, interés registrado, señales)
         * viajaba **solo cuando `iter === 0`**; de la segunda vuelta en adelante
         * el system era el string grande a secas. O sea que el bot olvidaba con
         * quién estaba hablando **justo después de usar una tool** — que es
         * exactamente cuando más lo necesita: registró el interés y en la vuelta
         * siguiente ya no sabe el nombre de la persona a la que le va a escribir.
         *
         * Se arma una vez, fuera del loop, con el mismo orden de bloques siempre:
         * el `cache_control` va sobre el bloque grande —que es idéntico turno a
         * turno— y el bloque volátil del contacto queda **después**, sin cachear.
         * Ese orden es lo que hace que el caché siga pegando: un prefijo estable
         * seguido de lo que cambia.
         */
        const system: Anthropic.Messages.MessageCreateParamsNonStreaming["system"] = [
          {
            type: "text" as const,
            text: sistemaGrande,
            cache_control: { type: "ephemeral" as const },
          },
          ...(entrada.contactoCtx
            ? [{ type: "text" as const, text: entrada.contactoCtx }]
            : []),
        ];

        /**
         * ⚠️ EL TEXTO DE CADA VUELTA SE GUARDA — antes se TIRABA.
         *
         * Cuando `stop_reason` es `tool_use`, la respuesta del modelo trae dos
         * cosas: los bloques `tool_use` **y el texto con el que las acompaña**
         * («¡Claro! Te paso el flyer 👇»). El bucle metía el `content` entero en
         * `messages` y hacía `continue`, y `texto` se calculaba recién sobre la
         * respuesta FINAL: todo lo dicho en las vueltas intermedias se perdía.
         *
         * Mientras `mandar_pieza` era un no-op no se notaba. Conectada, el modo
         * de falla es concreto: el modelo narra en la misma vuelta en que pide la
         * pieza, termina el turno sin agregar nada, y **al lead le llega el flyer
         * sin una sola palabra** — un archivo suelto de un número que no conoce.
         *
         * Se acumula en orden y se une al final. El guardrail corre sobre el
         * TEXTO COMPLETO, no sobre el último pedazo: una cifra de precio dicha en
         * la primera vuelta tiene que bloquear igual.
         */
        const textos: string[] = [];

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {

          const response = await cliente.messages.create({
            model: entrada.modelo,
            max_tokens: 2000,
            system,
            messages: messages as Anthropic.Messages.MessageParam[],
            tools: definiciones,
          });

          uso = acumularUso(response, entrada.modelo);

          const content = response.content as ContentBlock[];

          const textoDeLaVuelta = textoDe(content);
          if (textoDeLaVuelta) textos.push(textoDeLaVuelta);

          if (response.stop_reason === "tool_use") {
            const toolUses = content.filter(
              (c): c is Extract<ContentBlock, { type: "tool_use" }> => c.type === "tool_use",
            );

            messages.push({
              role: "assistant",
              content: content as any,
            });

            const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
            for (const tu of toolUses) {
              const handler = handlers[tu.name];
              const result = handler ? handler(tu.input) : `tool desconocida: ${tu.name}`;
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: result,
              });
            }

            messages.push({
              role: "user",
              content: toolResults as any,
            });
            continue;
          }

          // Todo lo que dijo en el turno, en orden: lo de las vueltas con tool
          // incluido. Renglón en blanco entre vueltas porque son mensajes
          // distintos del mismo turno, no una frase partida.
          const texto = textos.join("\n\n").trim();

          if (texto) {
            const veredicto = validarSalida(texto);
            if (!veredicto.ok) {
              return {
                texto: null,
                acciones: [{ tipo: "escalar", motivo: "error_bot" }],
                uso,
              };
            }
          }

          // Post-proceso: trocear para verificar que no sea demasiado largo
          const textoFinal = texto || null;

          return {
            texto: textoFinal,
            acciones,
            uso,
          };
        }

        // Agotamos iteraciones: cuatro vueltas pidiendo tools sin cerrar el turno
        // es una máquina trabada, no una conversación. Se descarta el texto
        // acumulado Y **las acciones**: si `mandar_pieza` sobreviviera acá, el
        // lead recibiría el flyer de un turno que nunca llegó a redactarse.
        return {
          texto: null,
          acciones: [{ tipo: "escalar", motivo: "error_bot" }],
          uso,
        };
      } catch (err) {
        return {
          error: `El agente falló: ${(err as Error).message}`,
          codigo: "agente_fallo",
        };
      }
    },
  };
}

export { trocear };
