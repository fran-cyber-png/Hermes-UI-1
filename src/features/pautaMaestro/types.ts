export interface FilaPauta {
  id: string;
  nombre: string;
  pais: string;
  accountId: string;
  accountName: string;
  curso: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  moneda: string;
}

export interface PautaMaestro {
  creadoAt: string | null;
  edadMinutos: number | null;
  campanas: FilaPauta[];
  cursos: string[];
  paises: string[];
}

export interface AdDetallePauta {
  id: string;
  nombre: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  impresiones: number | null;
  alcance: number | null;
  frecuencia: number | null;
  fatiga: boolean;
  fatigaDeltaCtr: number | null;
  fatigaDeltaFrecuencia: number | null;
  diasConDatos: number | null;
  thumbnailUrl: string | null;
  body: string | null;
  title: string | null;
  reacciones: number | null;
  comentarios: number | null;
  compartidos: number | null;
  guardados: number | null;
  leads: number | null;
}

export interface AdsetDetallePauta {
  id: string;
  nombre: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  publicosIncluidos: string[];
  publicosExcluidos: string[];
  ads: AdDetallePauta[];
}

export interface PautaDetalle {
  id: string;
  nombre: string;
  pais: string;
  accountId: string;
  accountName: string;
  curso: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  moneda: string;
  creadoAt: string | null;
  edadMinutos: number | null;
  adsets: AdsetDetallePauta[];
}

export interface PuntoSeriePauta {
  fecha: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
}

export interface SeriePauta {
  id: string;
  nombre: string;
  puntos: PuntoSeriePauta[];
}

export interface CompararPauta {
  serie: SeriePauta[];
  detalles: PautaDetalle[];
}

export interface PuntoSnapshotPauta {
  fecha: string;
  campanas: {
    id: string;
    nombre: string;
    gasto: number;
    resultados: number | null;
    costoPorResultado: number | null;
  }[];
}

export interface SnapshotsPauta {
  puntos: PuntoSnapshotPauta[];
}

export type RangoFiltro = "hoy" | "7d" | "30d" | "mes" | "mesPasado" | "todo";

/** Fila aplanada de un anuncio (creativo) para rankings y tarjetas. */
export interface FilaAd {
  id: string;
  nombre: string;
  campanaId: string;
  campanaNombre: string;
  adsetId: string;
  adsetNombre: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  impresiones: number | null;
  alcance: number | null;
  frecuencia: number | null;
  fatiga: boolean;
  fatigaDeltaCtr: number | null;
  fatigaDeltaFrecuencia: number | null;
  diasConDatos: number | null;
  thumbnailUrl: string | null;
  body: string | null;
  title: string | null;
  reacciones: number | null;
  comentarios: number | null;
  compartidos: number | null;
  guardados: number | null;
  leads: number | null;
  moneda: string;
}

/** Fila aplanada de un conjunto (adset) para ranking. */
export interface FilaAdset {
  id: string;
  nombre: string;
  campanaId: string;
  campanaNombre: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  ctr: number | null;
  cpc: number | null;
  frecuencia: number | null;
  moneda: string;
}
