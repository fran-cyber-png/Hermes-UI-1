import { useQuery } from '@tanstack/react-query';
import { api } from './cliente';

/** La inteligencia comercial de Cerberus: el tiempo, la cobranza, el catálogo y el embudo. */

export type MesVentas = { mes: string; ventasUsd: number; ventas: number };
export type ProductoMix = { producto: string; categoria: string | null; ventas: number; usd: number; ticket: number };
export type EmbudoEstados = {
  total: number;
  cobradas: number;
  enProceso: number;
  anuladas: number;
  reembolsadas: number;
  tasaReembolso: number;
  tasaCuotas: number;
};
export type Latencia = {
  p50: number | null;
  p90: number | null;
  fueraDeVentana: number;
  /** El universo MEDIBLE: pagos válidos CON fecha de confirmación. Los percentiles salen de acá. */
  total: number;
  /** Pagos válidos sin fecha de confirmación: invisibles al percentil. El p90 real solo puede ser peor. */
  sinConfirmar: number;
  porSede: { sede: string; p50: number | null; p90: number | null; pagos: number; tarde: number }[];
};
export type Sede = { sede: string; ventas: number; usd: number; ticket: number; clientes: number };
export type Bundle = { a: string; b: string; juntas: number };
export type Comercial = {
  serie: MesVentas[];
  mix: ProductoMix[];
  embudo: EmbudoEstados;
  latencia: Latencia;
  sedes: Sede[];
  bundles: Bundle[];
};

export function useComercial() {
  return useQuery({
    queryKey: ['comercial'],
    queryFn: () => api<Comercial>('/api/overview/comercial'),
  });
}
