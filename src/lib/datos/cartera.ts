import { useQuery } from '@tanstack/react-query';
import { api } from './cliente';

/** La cartera y el cliente: la cobranza viva, los medios de pago y los segmentos de valor. */

export type Cobranza = {
  saldoUsd: number;
  cuotasPendientes: number;
  enMora: number;
  sinUnPago: number;
  aging: { tramo: string; cuotas: number; saldoUsd: number }[];
  deudores: { personaId: number | null; nombre: string | null; saldoUsd: number; cuotas: number; diasMora: number }[];
};
export type MedioPago = { medio: string; pagos: number; usd: number; aprobacion: number };
export type SegmentoValor = { segmento: string; personas: number; ltvUsd: number; ticket: number };
export type ClienteValor = { personaId: number; nombre: string | null; ltvUsd: number; compras: number; pais: string | null };
export type Cartera = {
  cobranza: Cobranza;
  medios: MedioPago[];
  valor: { segmentos: SegmentoValor[]; top: ClienteValor[] };
};

export function useCartera() {
  return useQuery({ queryKey: ['cartera'], queryFn: () => api<Cartera>('/api/overview/cartera') });
}
