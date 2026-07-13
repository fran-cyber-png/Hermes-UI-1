export type DetectorId =
  | 'presupuesto-mal-repartido'
  | 'sin-exclusiones'
  | 'anuncio-caro'
  | 'gasto-sin-resultados'
  | 'ganador-sin-escalar'
  | 'pais-sin-replicar';

export type Nivel = 'campana' | 'conjunto' | 'anuncio';

export interface Accion {
  tipo: 'pausar' | 'mover-presupuesto' | 'subir-presupuesto' | 'excluir-publicos' | 'duplicar-a-cuentas';
  descripcion: string;
  antes?: Record<string, unknown>;
  despues?: Record<string, unknown>;
  objetivos: string[];
}

export interface Decision {
  id: string;
  detector: DetectorId;
  nivel: Nivel;
  titulo: string;
  detalle: string;
  /** El gasto en la moneda de LA CUENTA. Sirve para mostrar la decisión individual, nunca para sumar. */
  plataEnJuego: number;
  moneda: string;
  /**
   * El MISMO monto en dólares, convertido con la tasa del negocio. Lo único que se puede sumar
   * entre cuentas: el snapshot mezcla USD, COP y BOB. `null` si no hay tasa para esa moneda —
   * y entonces la decisión queda FUERA del total, no entra como cero.
   */
  plataEnJuegoUsd?: number | null;
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string;
  accion: Accion;
}

export interface FeedResponse {
  decisiones: Decision[];
  campanasAnalizadas: number;
  errores?: { accountId: string; message: string }[];
  modo: 'simulacion' | 'ejecucion';
}
