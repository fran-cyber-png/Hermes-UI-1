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
  plataEnJuego: number;
  moneda: string;
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
