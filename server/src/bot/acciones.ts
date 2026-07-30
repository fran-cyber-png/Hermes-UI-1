/** Lo que el agente decide hacer. NUNCA ejecuta efectos: el despachador lo hace después. */
export type Accion =
  | { tipo: "mandar_pieza"; clase: "plantilla" | "hecho" | "gancho" | "acuse"; id: string }
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

export interface ResumenPieza {
  clase: "plantilla" | "hecho" | "gancho" | "acuse";
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
