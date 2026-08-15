import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * MI LÍNEA — la auto-vinculación desde la app (decisión del dueño, 15-ago-2026).
 *
 * Hasta acá vincular una línea era D13: un operador mirando `/vincular` o el
 * panel de Cerberus, y la app de la vendedora "no vincula, solo ve". Esto abre
 * una puerta segunda: una vendedora SIN línea propia trae la suya, sola, desde
 * `PanelUsuario`. Server: `server/src/routes/miLinea.ts`.
 */

export interface MiLinea {
  numero: string | null;
  sesion?: { estado: string };
}

export function useMiLinea() {
  return useQuery({
    queryKey: ['mi-linea'],
    queryFn: () => api<MiLinea>('/api/whatsapp/mi-linea'),
    // Como `useLineas`: esto cambia cuando alguien vincula, casi nunca sin que
    // una persona lo provoque a propósito.
    staleTime: 5 * 60_000,
  });
}

export type EstadoAutoVinculacion =
  | { estado: 'expirado' }
  | { estado: 'vinculando' }
  | { estado: 'esperando_qr'; qr: string }
  | { estado: 'conectado'; numero: string }
  | { estado: 'baneado'; ban: { codigo: string; expira: string } }
  | { estado: 'error'; motivo: string };

/**
 * El polling del pareo en vuelo — mismo ritmo que la consola HTML de operador
 * (`routes/vincular.ts`). Solo corre mientras `activo` (después de iniciar), y
 * se apaga solo al llegar a un estado terminal (lo decide quien llama, no acá).
 */
export function useEstadoAutoVinculacion(activo: boolean) {
  return useQuery({
    queryKey: ['mi-linea', 'vincular', 'estado'],
    queryFn: () => api<EstadoAutoVinculacion>('/api/whatsapp/mi-linea/vincular/estado'),
    enabled: activo,
    refetchInterval: activo ? 1500 : false,
    staleTime: 0,
  });
}

export function useIniciarAutoVinculacion() {
  return useMutation({
    mutationFn: (numero: string) =>
      api<{ estado: string }>('/api/whatsapp/mi-linea/vincular', {
        method: 'POST',
        body: JSON.stringify({ numero }),
      }),
  });
}

/** Invalida lo que cambia cuando la línea propia queda conectada. */
export function useInvalidarMiLinea() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['mi-linea'] });
    // `PanelUsuario` (vía `useLineas`) y el selector de la barra leen de acá:
    // sin esto, la línea recién conectada no aparece hasta la próxima recarga.
    void qc.invalidateQueries({ queryKey: ['lineas-whatsapp'] });
  };
}

export function useCancelarAutoVinculacion() {
  const invalidar = useInvalidarMiLinea();
  return useMutation({
    mutationFn: () =>
      api<{ estado: string; cancelada: boolean }>('/api/whatsapp/mi-linea/vincular', { method: 'DELETE' }),
    onSettled: invalidar,
  });
}
