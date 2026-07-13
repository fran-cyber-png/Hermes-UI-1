import { useQuery } from '@tanstack/react-query';
import { api } from './cliente';

/** La persona canónica del grafo: su historia entera, en una línea de tiempo. */

export type EventoPersona = {
  fecha: string;
  tipo: 'compra' | 'pago' | 'reportado' | 'perdido' | 'reembolso';
  titulo: string;
  detalle: string;
  montoUsd: number | null;
};

export type Persona360 = {
  id: number;
  nombre: string | null;
  identidades: { tipo: string; valor: string }[];
  resumen: {
    compras: number;
    ltvUsd: number;
    primeraCompra: string | null;
    ultimaCompra: string | null;
    diasDesdeUltima: number | null;
    paises: string[];
    reembolsos: number;
    enCuotas: boolean;
  };
  inferencias: { texto: string; tono: 'valor' | 'riesgo' | 'neutro' }[];
  timeline: EventoPersona[];
};

export type PersonaBusqueda = { id: number; nombre: string | null; detalle: string };

export function useBuscarGente(q: string) {
  return useQuery({
    queryKey: ['gente', 'buscar', q],
    queryFn: () => api<{ personas: PersonaBusqueda[] }>(`/api/gente/buscar?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
}

export function usePersona360(id: number | null) {
  return useQuery({
    queryKey: ['gente', id],
    queryFn: () => api<Persona360>(`/api/gente/${id}`),
    enabled: id != null,
  });
}
