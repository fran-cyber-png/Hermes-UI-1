import type { ClasePieza } from "../piezas/direccion.js";

/** Lo que el agente decide hacer. NUNCA ejecuta efectos: el despachador lo hace después. */
export type Accion =
  | { tipo: "mandar_pieza"; clase: ClaseQueElBotManda; id: string }
  | { tipo: "registrar_interes"; familia: string }
  | { tipo: "calificar"; temperatura: "caliente" | "tibio" | "frio"; motivo: string }
  | { tipo: "escalar"; motivo: EscaladaMotivo }
  | { tipo: "pausar"; motivo: "rechazo" | "despedida" };

export type EscaladaMotivo =
  | "pidio_humano"
  | "pregunto_si_es_bot"
  | "por_cerrar"
  | "sin_respuesta_en_catalogo"
  | "frustrado"
  | "error_bot";

export interface Turno {
  rol: "lead" | "nosotros";
  texto: string;
}

/**
 * LO QUE EL BOT PUEDE MANDAR — un subconjunto explícito de `ClasePieza`.
 *
 * `hsm` queda AFUERA a propósito, y no es un olvido: una plantilla aprobada
 * existe para atravesar la ventana de 24 h cerrada, y el bot solo actúa DENTRO
 * de una conversación viva, donde el texto libre está permitido y es mejor.
 * Darle una HSM al bot sería darle la capacidad de escribirle a alguien que no
 * está hablando con él.
 *
 * Se escribe como `Exclude<…>` y no como una lista a mano para que agregar una
 * clase nueva obligue a decidir si el bot la puede mandar, en vez de dejar dos
 * listas que se separan en silencio (la lección de #37).
 */
export type ClaseQueElBotManda = Exclude<ClasePieza, "hsm">;

export interface ResumenPieza {
  clase: ClaseQueElBotManda;
  id: string;
  descripcion: string;
  enviable: boolean;
}

export interface RespuestaBot {
  texto: string | null;
  acciones: Accion[];
  uso: {
    entrada: number;
    salida: number;
    cacheEscritura: number;
    cacheLectura: number;
    modelo: string;
  };
}

export interface ErrorBot {
  error: string;
  codigo: string;
  reintentable: boolean;
}
