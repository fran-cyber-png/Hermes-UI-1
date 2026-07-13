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
  total: number;
  porSede: { sede: string; p50: number | null; p90: number | null; pagos: number; tarde: number }[];
};
export type Comercial = { serie: MesVentas[]; mix: ProductoMix[]; embudo: EmbudoEstados; latencia: Latencia };

export function useComercial() {
  return useQuery({
    queryKey: ['comercial'],
    queryFn: () => api<Comercial>('/api/overview/comercial'),
  });
}
