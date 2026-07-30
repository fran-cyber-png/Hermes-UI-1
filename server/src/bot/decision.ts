export interface HechosParaDecidir {
  modo: "apagado" | "sombra" | "automatico";
  lineaHabilitada: boolean;
  pausa: { motivo: string; hasta: Date | null } | null;
  huboSalienteHumanoDespuesDe: Date | null;
  entranteEsRepetido: boolean;
  turnosHoy: number;
  maxTurnosDia: number;
  respuestasUltimaHoraLinea: number;
  maxRespuestasHoraLinea: number;
  transporteConectado: boolean;
  frenado: boolean;
}

export type MotivoSalto =
  | "apagado"
  | "linea_no_habilitada"
  | "frenado"
  | "pausado"
  | "vendedora_activa"
  | "spam"
  | "tope_turnos"
  | "tope_linea"
  | "desconectado";

export type Decision =
  | { accion: "responder" }
  | { accion: "saltar"; motivo: MotivoSalto };

/** Evalúa en ORDEN FIJO (del más barato al más caro). El test recorre el orden entero. */
export function decidir(h: HechosParaDecidir): Decision {
  if (h.modo === "apagado") return { accion: "saltar", motivo: "apagado" };
  if (!h.lineaHabilitada) return { accion: "saltar", motivo: "linea_no_habilitada" };
  if (h.frenado) return { accion: "saltar", motivo: "frenado" };
  if (h.pausa && (h.pausa.hasta === null || h.pausa.hasta > new Date())) {
    return { accion: "saltar", motivo: "pausado" };
  }
  if (h.huboSalienteHumanoDespuesDe) return { accion: "saltar", motivo: "vendedora_activa" };
  if (h.entranteEsRepetido) return { accion: "saltar", motivo: "spam" };
  if (h.turnosHoy >= h.maxTurnosDia) return { accion: "saltar", motivo: "tope_turnos" };
  if (h.respuestasUltimaHoraLinea >= h.maxRespuestasHoraLinea) {
    return { accion: "saltar", motivo: "tope_linea" };
  }
  if (!h.transporteConectado) return { accion: "saltar", motivo: "desconectado" };
  return { accion: "responder" };
}
