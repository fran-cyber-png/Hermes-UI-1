import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LAS DOS RESPUESTAS SUGERIDAS del panel derecho.
 *
 * El server decide cuáles (`server/src/sugerencias/`, la misma cabeza que la
 * auto-respuesta nocturna) y devuelve la vista previa **ya resuelta**: el
 * `{precio}` sale de Cerberus en ese instante. Por eso `staleTime` es corto y
 * por eso esto no se persiste en IndexedDB: un precio de ayer en una cotización
 * es plata perdida (ADR 0007).
 */

export type Intencion = 'presentarse' | 'flyer' | 'temario' | 'precio' | 'seguimiento' | 'reactivar';

export interface Sugerencia {
  plantillaId: number;
  nombre: string;
  intencion: Intencion;
  /** «Pasar el precio», «Reactivar»… lo que el botón hace. */
  rotulo: string;
  /** Por qué corresponde ahora. */
  porque: string;
  totalPasos: number;
  conImagen: boolean;
  vistaPrevia: { texto: string; faltantes: string[] };
  pasos: { orden: number; conImagen: boolean }[];
}

export interface EstadoDeVenta {
  esPrimerContacto: boolean;
  curso: string | null;
  pidioInfo: boolean;
  cotizada: boolean;
  enfriada: boolean;
  vioMaterial: boolean;
}

export function useSugerencias(clave: string | null, nombre: string | null, activo: boolean) {
  return useQuery({
    queryKey: ['sugerencias', clave],
    queryFn: ({ signal }) =>
      api<{ sugerencias: Sugerencia[]; estado: EstadoDeVenta }>(
        `/api/sugerencias?clave=${encodeURIComponent(clave ?? '')}` +
          (nombre ? `&nombre=${encodeURIComponent(nombre)}` : ''),
        // Techo de espera, igual que la ficha. Sin esto el bloque se queda en
        // dos rectángulos grises para siempre cuando la conexión se traba —
        // verificado el 25-jul, con el proxy de fotos colgado comiéndose el cupo
        // de conexiones del navegador. Un esqueleto eterno no dice nada; el
        // error sí, y encima ofrece la salida a las secuencias.
        { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) },
      ),
    enabled: activo && Boolean(clave?.startsWith('conv:')),
    staleTime: 60_000,
    retry: false,
  });
}
