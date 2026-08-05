/**
 * QUÉ DICE META DE UNA PLANTILLA — puro, y sesgado a lo conservador.
 *
 * ══ POR QUÉ NINGÚN ENUM ESTÁ CERRADO ════════════════════════════════════════
 *
 * Los enums de Meta crecen sin avisarnos, y este archivo se escribió mirando la
 * documentación oficial en agosto de 2026 con una lista de sorpresas concretas:
 *
 *   · `status` tiene **diez** valores en el edge (`ARCHIVED` sólo ahí) y nueve
 *     en el nodo — y **`IN_REVIEW` NO EXISTE**, aunque el Business Manager
 *     muestre «In-Review» y toda la prosa de la doc lo nombre. Ramificar por
 *     `IN_REVIEW` es escribir una rama que nunca entra.
 *   · `LIMIT_EXCEEDED`, `PENDING_DELETION` y `DELETED` existen y casi nadie los
 *     contempla.
 *
 * Por eso la traducción es la misma decisión que `TIPO_IVI` (ADR 0021): un
 * valor desconocido **cae en la rama conservadora, nunca en la permisiva y
 * nunca en un throw**. Concretamente: lo que no se reconoce **NO se puede
 * mandar**. El costo de equivocarse en esa dirección es una campaña que no
 * sale; en la otra, mandar con una plantilla pausada y comerse un 132015 por
 * cada destinatario.
 *
 * ══ Y POR QUÉ `NONE` NO SIGNIFICA «SIN MOTIVO» ══════════════════════════════
 *
 * Meta usa DOS enums parecidos y distintos para el motivo:
 *
 *   · `rejected_reason` en el NODO: seis valores, y `NONE` acá sí es «no fue
 *     rechazada» (una `APPROVED` viene con `NONE`);
 *   · `reason` en el WEBHOOK: ocho valores, y ahí `NONE` **significa que la
 *     plantilla fue PAUSADA**. Un `if (reason === 'NONE') { todo bien }` se come
 *     el aviso de pausa en silencio.
 *
 * Los dos no se parsean con el mismo tipo. `INCORRECT_CATEGORY` sólo existe en
 * el segundo, y cerrarlos juntos hace que uno de los dos tire.
 */

/** Lo que Meta devuelve por plantilla. Ningún campo se asume presente. */
export interface PlantillaDeMeta {
  id?: string;
  name?: string;
  language?: string;
  /** El enum de Meta, tal cual vino. Se guarda crudo a propósito. */
  status?: string;
  category?: string;
  /** `{score, date}` — es un OBJETO. `quality_rating` del NÚMERO es un string. */
  quality_score?: { score?: string; date?: number } | null;
  rejected_reason?: string | null;
  components?: unknown[];
}

/**
 * ¿SE PUEDE MANDAR? Lista blanca, no lista negra.
 *
 * Sólo `APPROVED` habilita el envío. Todo lo demás —incluido un estado que
 * todavía no existe— no. Con lista negra, un `PAUSED_V2` que Meta invente
 * mañana pasaría el filtro y mandaría hasta que un humano lo notara.
 */
export function sePuedeMandar(p: PlantillaDeMeta): boolean {
  return p.status === "APPROVED";
}

/** Las tres cosas que una persona necesita saber, en criollo. */
export interface LecturaDePlantilla {
  /** Qué le pasa, en una frase. */
  titulo: string;
  /** El detalle, o `null` si el título alcanza. */
  detalle: string | null;
  /** `bien` se puede usar · `espera` todavía no · `problema` hay que hacer algo. */
  tono: "bien" | "espera" | "problema";
  enviable: boolean;
}

/**
 * LA LECTURA DE CADA ESTADO. Un estado desconocido dice que no se reconoce
 * —con el valor a la vista, para poder buscarlo— y NO se puede mandar.
 */
export function leerEstado(p: PlantillaDeMeta): LecturaDePlantilla {
  const enviable = sePuedeMandar(p);
  switch (p.status) {
    case "APPROVED":
      return { titulo: "Aprobada", detalle: null, tono: "bien", enviable };
    case "PENDING":
      return {
        titulo: "En revisión",
        detalle: "Meta responde en hasta 24 horas.",
        tono: "espera",
        enviable,
      };
    case "REJECTED":
      return { titulo: "Rechazada", detalle: leerRechazo(p.rejected_reason), tono: "problema", enviable };
    case "PAUSED":
      return {
        titulo: "Pausada por calidad",
        detalle:
          "Meta la pausó porque la gente la reportó o no la leyó. Se despausa sola: 3 h la primera vez, 6 h la segunda, y a la tercera queda deshabilitada.",
        tono: "problema",
        enviable,
      };
    case "DISABLED":
      return {
        titulo: "Deshabilitada",
        detalle: "Se pausó demasiadas veces por calidad. No vuelve: hay que crear otra.",
        tono: "problema",
        enviable,
      };
    case "IN_APPEAL":
      return { titulo: "Apelada", detalle: "Esperando la decisión de Meta.", tono: "espera", enviable };
    case "LIMIT_EXCEEDED":
      return {
        titulo: "Fuera de cupo",
        detalle: "La cuenta llegó al máximo de plantillas.",
        tono: "problema",
        enviable,
      };
    case "PENDING_DELETION":
    case "DELETED":
      return { titulo: "Borrada", detalle: null, tono: "problema", enviable };
    case "ARCHIVED":
      return { titulo: "Archivada", detalle: null, tono: "espera", enviable };
    default:
      /**
       * NO SE RECONOCE. Se dice el valor crudo en vez de inventar una lectura:
       * quien lo lea puede buscarlo en la doc de Meta, y mientras tanto la
       * plantilla no se puede mandar.
       */
      return {
        titulo: "Estado que no reconocemos",
        detalle: `Meta dice «${p.status ?? "(nada)"}». Por las dudas no se manda.`,
        tono: "problema",
        enviable: false,
      };
  }
}

/**
 * EL MOTIVO DEL RECHAZO — y la advertencia de que casi nunca hay detalle.
 *
 * Meta sólo explica el porqué cuando el motivo es `INVALID_FORMAT`, y **sólo
 * por webhook** (`rejection_info`). Para los otros cinco manda el enum pelado:
 * el texto vive en Business Support Home, a mano. Decirlo es parte de la
 * lectura — si no, la pantalla parece rota cuando en realidad Meta no mandó nada.
 */
export function leerRechazo(motivo: string | null | undefined): string {
  switch (motivo) {
    case "ABUSIVE_CONTENT":
      return "Meta la marcó como contenido abusivo.";
    case "INVALID_FORMAT":
      return "El formato no le gustó (variables pegadas, o al principio o al final del texto).";
    case "PROMOTIONAL":
      return "Demasiado promocional para la categoría en la que se registró.";
    case "TAG_CONTENT_MISMATCH":
      return "El contenido no coincide con la categoría declarada.";
    case "INCORRECT_CATEGORY":
      return "Está en la categoría equivocada.";
    case "SCAM":
      return "Meta la marcó como estafa.";
    case "NONE":
    case null:
    case undefined:
      // En el NODO, `NONE` sobre una rechazada significa que Meta no mandó el
      // motivo — pasa seguido. En el WEBHOOK significa otra cosa (pausada) y
      // por eso ese enum se lee aparte.
      return "Meta no dijo el motivo. Está en Business Support Home.";
    default:
      return `Motivo que no reconocemos: «${motivo}». Está en Business Support Home.`;
  }
}

/**
 * LA CALIDAD. `UNKNOWN` es «todavía no hay datos», NO «está bien».
 *
 * Es el mismo criterio que `edad_del_dato: null` en Ivi: el silencio no puede
 * leerse como buena noticia. Una plantilla recién aprobada siempre está en
 * `UNKNOWN`, y ahí es justamente cuando Meta aplica *pacing* — retiene parte de
 * los mensajes para juntar feedback antes de soltar el resto.
 */
export function leerCalidad(p: PlantillaDeMeta): { texto: string; tono: "bien" | "espera" | "problema" } {
  switch (p.quality_score?.score) {
    case "GREEN":
      return { texto: "Buena", tono: "bien" };
    case "YELLOW":
      return { texto: "Media — algunas quejas o poca lectura", tono: "espera" };
    case "RED":
      return { texto: "Baja — Meta la va a pausar", tono: "problema" };
    case "UNKNOWN":
    case undefined:
    case null:
      return { texto: "Sin medir todavía", tono: "espera" };
    default:
      return { texto: `Sin medir (Meta dice «${p.quality_score?.score}»)`, tono: "espera" };
  }
}

/**
 * ⚠️ UN `200` DE META NO GARANTIZA QUE EL MENSAJE SALGA.
 *
 * La respuesta de cada envío trae `messages[].message_status`, que puede ser
 * `accepted` o **`held_for_quality_assessment`**. Lo segundo es el *pacing*:
 * Meta retiene el mensaje para juntar feedback, y **si las señales son malas
 * los siguientes se DESCARTAN**. Aplica a plantillas nuevas, a las despausadas
 * y a cualquiera sin calidad `GREEN` — o sea, exactamente a una campaña recién
 * aprobada.
 *
 * Sin leer este campo, «salieron 88» puede querer decir «Meta aceptó 88 POSTs y
 * retuvo una parte». Es la versión con nombre propio de una cicatriz ya
 * conocida: los 200 de Meta son acuses, no mensajes.
 */
export function fueRetenido(respuestaDeEnvio: unknown): boolean {
  if (typeof respuestaDeEnvio !== "object" || respuestaDeEnvio === null) return false;
  const mensajes = (respuestaDeEnvio as { messages?: unknown }).messages;
  if (!Array.isArray(mensajes)) return false;
  return mensajes.some(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as { message_status?: unknown }).message_status === "held_for_quality_assessment",
  );
}
