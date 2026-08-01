import type { Accion, EscaladaMotivo, ResumenPieza } from "./acciones.js";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type HandlerTool = (input: unknown) => string;

/**
 * Crea las 5 tools declarativas. Todas validan y acumulan Acciones en recolector.
 * Ninguna ejecuta efectos: el despachador decide qué hacer después.
 *
 * `familiasValidas` reemplaza la constante hardcodeada de 14 strings:
 * ahora se consulta `alias_curso` al iniciar el pipeline (Fase 2).
 */
export function crearTools(
  recolector: Accion[],
  catalogo: ResumenPieza[],
  familiasValidas: ReadonlySet<string> = FAMILIAS_POR_DEFECTO,
): {
  definiciones: ToolDefinition[];
  handlers: Record<string, HandlerTool>;
} {
  const definiciones: ToolDefinition[] = [];
  const handlers: Record<string, HandlerTool> = {};

  // 1. mandar_pieza
  definiciones.push({
    name: "mandar_pieza",
    description:
      "Manda una pieza del catálogo (flyer, temario, flyer de precio). Usar para enviar información sobre precios, programas o materiales. El id es lo que aparece en <piezas_enviables> como [clase:id].",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "El id completo de la pieza, ej: plantilla:5" },
      },
      required: ["id"],
    },
  });
  handlers["mandar_pieza"] = (input: unknown) => {
    const id = (input as { id?: string } | undefined)?.id;
    if (!id) return "falta el id de la pieza";
    const pieza = catalogo.find((p) => `${p.clase}:${p.id}` === id);
    if (!pieza) return "esa pieza no existe; elegí de la lista de <piezas_enviables>";
    if (!pieza.enviable) return "esa pieza no se puede enviar en este momento";
    // La intención SE SIGUE GUARDANDO aunque no se ejecute: `bot_respuestas.
    // acciones` es el rastro con el que se diagnosticó este bug, y apagarlo nos
    // dejaría ciegos sobre qué piezas pediría el modelo cuando F3 conecte.
    recolector.push({ tipo: "mandar_pieza", clase: pieza.clase, id: pieza.id });
    // PERO SE LE DICE LA VERDAD. Acá decía «pieza … agendada para enviar», y era
    // falso: `ejecutar.ts` la descarta con un console.warn. El modelo le creía y
    // redactaba el acompañamiento como si el documento hubiera salido — «Ya
    // tienes en tu chat el temario completo» (Carlos, 1-ago 12:09:38), a lo que
    // el lead contestó quince segundos después «No tengo nada todavía apenas
    // estoy pidiendo la información». Seis leads esa mañana, misma firma.
    //
    // Una tool que acepta y no ejecuta no produce «no pasa nada»: produce que el
    // modelo MIENTA con confianza. El no-op explícito de `ejecutar.ts` se sentía
    // seguro porque loguea, y el que tenía que enterarse era el modelo.
    //
    // Cuando F3 conecte el envío, esto vuelve a ser una confirmación — y ahí sí
    // será cierta.
    return (
      "NO se envió: el envío de piezas todavía no está conectado. " +
      "NO le digas que ya la tiene, que le llegó ni que la revise. " +
      "Pedile un momento y decile que vos se lo pasás en seguida."
    );
  };

  // 2. registrar_interes
  definiciones.push({
    name: "registrar_interes",
    description:
      "Registra el interés de la persona en una familia de curso específica. Usar cuando la persona muestra interés claro en un programa.",
    input_schema: {
      type: "object",
      properties: {
        familia: { type: "string", description: "El código de familia, ej: DIPCINTE, DIPICOT" },
      },
      required: ["familia"],
    },
  });
  handlers["registrar_interes"] = (input: unknown) => {
    const familia = (input as { familia?: string } | undefined)?.familia;
    if (!familia) return "falta la familia del curso";
    if (!familiasValidas.has(familia)) {
      const lista = [...familiasValidas].slice(0, 10).join(", ");
      return `"${familia}" no es una familia de curso conocida. Algunas conocidas: ${lista}`;
    }
    recolector.push({ tipo: "registrar_interes", familia });
    // Mismo caso que `mandar_pieza`: acá decía «interés en X registrado» y
    // ninguna fila se escribe (`ejecutar.ts` lo descarta). Miente menos —la
    // regla 7 le prohíbe contarle al lead que lo registró— pero le da al modelo
    // una premisa falsa para el resto del turno, y de eso salen los «ya te
    // tengo anotado». La intención se guarda igual, en `acciones`.
    return `anotado ${familia} en el pedido, todavía sin confirmar. No se lo menciones al lead.`;
  };

  // 3. calificar
  definiciones.push({
    name: "calificar",
    description:
      "Califica la temperatura del lead: caliente (listo para comprar), tibio (interesado pero esperando), frio (poco interés). Si ya hay una calificación previa, la reemplaza.",
    input_schema: {
      type: "object",
      properties: {
        temperatura: {
          type: "string",
          enum: ["caliente", "tibio", "frio"],
          description: "La temperatura del lead",
        },
        motivo: { type: "string", description: "Por qué esta calificación" },
      },
      required: ["temperatura", "motivo"],
    },
  });
  handlers["calificar"] = (input: unknown) => {
    const args = input as { temperatura?: string; motivo?: string } | undefined;
    if (!args?.temperatura || !["caliente", "tibio", "frio"].includes(args.temperatura)) {
      return "temperatura debe ser caliente, tibio o frio";
    }
    if (!args?.motivo) return "falta el motivo de la calificación";
    const idx = recolector.findIndex((a) => a.tipo === "calificar");
    const accion: Accion = {
      tipo: "calificar",
      temperatura: args.temperatura as "caliente" | "tibio" | "frio",
      motivo: args.motivo,
    };
    if (idx >= 0) {
      recolector[idx] = accion;
    } else {
      recolector.push(accion);
    }
    return `lead calificado como ${args.temperatura}`;
  };

  // 4. escalar_a_vendedora
  const ESCALADA_VALIDA: EscaladaMotivo[] = [
    "pidio_humano",
    "pregunto_si_es_bot",
    "por_cerrar",
    "sin_respuesta_en_catalogo",
    "frustrado",
    "error_bot",
  ];
  definiciones.push({
    name: "escalar_a_vendedora",
    description:
      "Escala la conversación a una vendedora humana. Usar cuando el lead pide hablar con alguien, pregunta si eres un bot, quiere comprar ya, o la pregunta no tiene respuesta en el catálogo.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ESCALADA_VALIDA,
          description: "El motivo de la escalación",
        },
      },
      required: ["motivo"],
    },
  });
  handlers["escalar_a_vendedora"] = (input: unknown) => {
    const motivo = (input as { motivo?: string } | undefined)?.motivo;
    if (!motivo || !ESCALADA_VALIDA.includes(motivo as EscaladaMotivo)) {
      return `motivo inválido. Válidos: ${ESCALADA_VALIDA.join(", ")}`;
    }
    recolector.push({ tipo: "escalar", motivo: motivo as EscaladaMotivo });
    return `conversación escalada a vendedora (motivo: ${motivo})`;
  };

  // 5. pausar_conversacion
  definiciones.push({
    name: "pausar_conversacion",
    description:
      "Pausa la conversación para que el bot no vuelva a responder. Usar cuando la persona rechaza la oferta o se despide.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["rechazo", "despedida"],
          description: "rechazo: dijo que no le interesa. despedida: se despidió cortésmente.",
        },
      },
      required: ["motivo"],
    },
  });
  handlers["pausar_conversacion"] = (input: unknown) => {
    const motivo = (input as { motivo?: string } | undefined)?.motivo;
    if (motivo !== "rechazo" && motivo !== "despedida") {
      return "motivo debe ser rechazo o despedida";
    }
    recolector.push({ tipo: "pausar", motivo });
    return `conversación pausada (motivo: ${motivo})`;
  };

  return { definiciones, handlers };
}

/** Familias por defecto — cuando alias_curso no está disponible. */
const FAMILIAS_POR_DEFECTO: ReadonlySet<string> = new Set([
  "DIPCINTE",
  "DIPICOT",
  "DIPOPPS",
  "DIPCIBE",
  "GEN5C2G3",
  "GENCDE6AE",
  "DIPOPPSS",
  "DIPGESPA",
  "EPCVETC",
  "GEN15527B",
  "EVGLINTEST",
  "DIPTEEI",
  "DIPDIRS",
  "DIPIAMP",
]);
