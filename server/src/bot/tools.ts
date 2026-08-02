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
  /**
   * Las piezas que esta conversación YA recibió (`plantilla:12`, `hecho:cuotas`),
   * leídas de `envios_wa` antes de armar las tools (F3).
   *
   * Viaja hasta acá —en vez de chequearse solo antes de mandar— para que el
   * modelo se entere **mientras redacta**: si se lo decimos recién al despachar,
   * el turno ya salió prometiendo un flyer que no va a llegar. Incluye lo que la
   * vendedora mandó a mano, que es la mitad que el bot no puede ver de otro modo.
   */
  yaEnviadas: ReadonlySet<string> = new Set(),
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

    // El dedupe POR CONVERSACIÓN, dicho a tiempo: si esta persona ya la recibió
    // —del bot en otro turno o de una vendedora a mano—, mandarla de nuevo es
    // repetirle el mismo archivo. Y saberlo ACÁ es lo que evita que el turno
    // salga prometiendo algo que después el despachador va a bloquear.
    if (yaEnviadas.has(`${pieza.clase}:${pieza.id}`)) {
      return (
        `a esta persona YA le llegó ${id} en esta conversación: no se manda de nuevo. ` +
        "Si hace falta, referite a lo que ya tiene con tus palabras."
      );
    }

    /**
     * ⚠️ UNA PIEZA, UNA VEZ POR TURNO — la mitad barata del dedupe.
     *
     * El modelo puede pedir la misma pieza dos veces en el mismo turno: ahora
     * que su propio texto sobrevive al `tool_use` (ver `agente.ts`), lo normal
     * es que la vuelta siguiente vuelva a narrar «te paso el flyer», y de ahí a
     * volver a llamar la tool hay un paso. Sin esta guarda eso son DOS flyers
     * idénticos al mismo lead, con su espera de 2-6 s en el medio.
     *
     * Acá se corta lo de ESTE turno; lo que ya salió en turnos anteriores lo
     * corta el dedupe por conversación (`bot/piezaAMandar.ts`), que mira
     * `envios_wa`. Son dos guardas distintas porque son dos preguntas distintas
     * («¿ya la pedí?» / «¿ya la recibió?»), y el recolector no sobrevive al turno.
     */
    const yaPedida = recolector.some(
      (a) => a.tipo === "mandar_pieza" && a.clase === pieza.clase && a.id === pieza.id,
    );
    if (yaPedida) {
      return `${id} YA está anotada en este turno: sale UNA sola vez. No la pidas de nuevo.`;
    }

    // La intención se guarda en `bot_respuestas.acciones`: es el rastro con el
    // que se diagnosticó el no-op, y sirve igual ahora que el envío está vivo
    // («qué pidió» y «qué salió» son dos preguntas distintas).
    recolector.push({ tipo: "mandar_pieza", clase: pieza.clase, id: pieza.id });

    /**
     * LA RESPUESTA VOLVIÓ A CONFIRMAR — pero solo lo que de verdad pasa.
     *
     * Acá decía «agendada para enviar» cuando `ejecutar.ts` la descartaba, y el
     * modelo redactaba como si el documento hubiera salido: «Ya tienes en tu
     * chat el temario completo» (Carlos, 1-ago-2026 12:09:38), y quince segundos
     * después el lead: «No tengo nada todavía apenas estoy pidiendo la
     * información». Seis leads esa mañana, misma firma. Después se dio vuelta a
     * «NO se envió», que era la verdad mientras F3 no existía.
     *
     * Con F3 conectado la verdad es una tercera: **todavía no salió, pero va a
     * salir**, justo detrás de este mensaje. Por eso la respuesta promete en
     * FUTURO y sigue prohibiendo el pasado — «ya lo tienes» seguiría siendo
     * falso en el instante en que el modelo lo escribe, y ese instante es el
     * único que el lead lee.
     */
    return (
      `${id} anotada: sale JUSTO DESPUÉS de este mensaje. ` +
      "Anunciala en futuro («te lo paso ahora mismo»). " +
      "NO digas que ya la tiene, que le llegó ni que la revise: todavía no salió."
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
    // Mismo dedupe que `mandar_pieza`, por el mismo motivo: pedir dos veces la
    // misma familia en el turno no puede convertirse en dos idas a Cerberus.
    // Dos familias DISTINTAS sí pasan: son dos intereses reales, y `intereses`
    // tiene su `unique (clave, curso)` para que no se dupliquen en la tabla.
    const yaPedida = recolector.some(
      (a) => a.tipo === "registrar_interes" && a.familia === familia,
    );
    if (yaPedida) return `${familia} ya está anotada en este turno.`;

    recolector.push({ tipo: "registrar_interes", familia });
    // La fila se escribe al CERRAR el turno (`ejecutar.ts`), contra el catálogo
    // vivo de Cerberus — así que en este instante todavía no está y puede fallar
    // (el catálogo puede no tener ninguna edición activa de esa familia). Se
    // dice en futuro por eso, y sigue prohibido contárselo al lead: la regla 7.
    return `${familia} anotada: se registra al cerrar el turno. No se lo menciones al lead.`;
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
