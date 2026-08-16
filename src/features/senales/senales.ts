import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { ColorCategoria } from '../../dominio/paletaCategorias';

/**
 * LAS ETIQUETAS AUTOMÁTICAS — «Cotizado» y «Se enfrió», calculadas por el server.
 *
 * NO tienen fila en ninguna tabla: se derivan del hilo en cada consulta
 * (ADR 0016). El front no las computa ni las cachea largo: `staleTime` corto,
 * porque «se enfrió» es una función del reloj y una etiqueta de hace media hora
 * puede estar diciendo algo que ya no es cierto.
 */

export interface EtiquetaAutomatica {
  clave: 'cotizado' | 'enfriado';
  rotulo: string;
  color: ColorCategoria;
  /** Por qué está puesta. Va al `title`: la señal se explica, no se impone. */
  detalle: string;
}

export interface Senal {
  clave: string;
  etiquetas: EtiquetaAutomatica[];
  corroborada: boolean;
  enfriamiento: { enfriada: boolean; diasDeSilencio: number | null; motivo: string };
  cotizacion: { esCotizacion: boolean; motivo: string; ocurridoEn: string } | null;
}

export function useSenales(claves: string[]) {
  const lista = claves.filter(Boolean).sort();
  return useQuery({
    queryKey: ['senales', lista.join(',')],
    queryFn: () =>
      api<{ senales: Record<string, Senal>; umbralDias: number }>(
        `/api/senales?claves=${encodeURIComponent(lista.join(','))}`,
      ),
    enabled: lista.length > 0,
    // Corto a propósito: el enfriamiento se mide contra `now()` del server.
    staleTime: 60_000,
  });
}
