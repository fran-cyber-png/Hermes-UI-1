import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import type { RespuestaBandeja } from './bandeja';
import {
  verAutoRespuesta,
  type ModoAutoRespuesta,
  type RespuestaAutoRespuesta,
  type VistaAutoRespuesta,
} from './estado';

/**
 * EL PUENTE con `GET /api/autorespuesta`, el cambio de modo
 * (`PUT /api/autorespuesta/modo`) y la bandeja de revisión
 * (`GET /bandeja` · `POST /aprobar` · `POST /descartar`).
 *
 * El estado se refresca cada 30 s: puede cambiar SIN que nadie toque el chip
 * —el freno automático lo apaga solo ante un ban o un error de envío, y las
 * preparadas caducan solas— y una pantalla que siga diciendo «encendida» o
 * «12 esperando» en ese caso estaría mintiendo.
 *
 * `retry: false` a propósito: si el server no contesta, se dice «sin señal» en
 * vez de insistir; y ante un error la vista NO cae a «apagada», que sería la
 * mentira cómoda.
 */

export const CLAVE_AUTORESPUESTA = ['autorespuesta'] as const;
export const CLAVE_BANDEJA = ['autorespuesta', 'bandeja'] as const;

export function useAutoRespuesta(): {
  vista: VistaAutoRespuesta;
  /** El ritmo, para mostrarlo donde se aprueba (ADR 0018). */
  limites: RespuestaAutoRespuesta['limites'];
  cargando: boolean;
  cambiando: boolean;
  errorAlCambiar: string | null;
  cambiarModo: (modo: ModoAutoRespuesta) => void;
} {
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: CLAVE_AUTORESPUESTA,
    queryFn: () => api<RespuestaAutoRespuesta>('/api/autorespuesta'),
    refetchInterval: 30_000,
    retry: false,
  });

  const mutar = useMutation({
    mutationFn: (modo: ModoAutoRespuesta) =>
      api<{ ok: true }>('/api/autorespuesta/modo', { method: 'PUT', body: JSON.stringify({ modo }) }),
    // Se relee del server en vez de asumir: el que manda es el estado guardado.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CLAVE_AUTORESPUESTA });
      void qc.invalidateQueries({ queryKey: CLAVE_BANDEJA });
    },
  });

  const errorAlCambiar =
    mutar.error instanceof ErrorApi
      ? mutar.error.message
      : mutar.error
        ? 'no se pudo cambiar el modo'
        : null;

  // 404 = el server no tiene la ruta (versión anterior a esta feature). No es
  // «sin señal»: es que ahí esto todavía no existe, y el chip no se muestra.
  const sinRuta = consulta.error instanceof ErrorApi && consulta.error.status === 404;

  return {
    vista: verAutoRespuesta(consulta.data, { sinRuta }),
    limites: consulta.data?.limites,
    cargando: consulta.isPending,
    cambiando: mutar.isPending,
    errorAlCambiar,
    cambiarModo: (modo: ModoAutoRespuesta) => mutar.mutate(modo),
  };
}

export interface ResultadoAprobar {
  ok: true;
  aprobadas: number;
  programadas: { id: number; programadoPara: string }[];
  noEntran: { id: number; motivo: string }[];
}

/**
 * LA BANDEJA. Se consulta solo cuando está abierta (`activa`): es una pantalla
 * de dos minutos por día, no vale despertarla cada 30 s en segundo plano — el
 * chip ya trae el número que importa desde `/api/autorespuesta`.
 */
export function useBandeja(activa: boolean) {
  const qc = useQueryClient();
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: CLAVE_BANDEJA });
    void qc.invalidateQueries({ queryKey: CLAVE_AUTORESPUESTA });
  };

  const consulta = useQuery({
    queryKey: CLAVE_BANDEJA,
    queryFn: () => api<RespuestaBandeja>('/api/autorespuesta/bandeja'),
    enabled: activa,
    refetchInterval: activa ? 60_000 : false,
    retry: false,
  });

  const aprobar = useMutation({
    mutationFn: (v: { ids: number[]; textos?: Record<string, string> }) =>
      api<ResultadoAprobar>('/api/autorespuesta/aprobar', { method: 'POST', body: JSON.stringify(v) }),
    onSettled: refrescar,
  });

  const descartar = useMutation({
    mutationFn: (v: { ids?: number[]; todas?: boolean }) =>
      api<{ ok: true; descartadas: number }>('/api/autorespuesta/descartar', {
        method: 'POST',
        body: JSON.stringify(v),
      }),
    onSettled: refrescar,
  });

  return {
    datos: consulta.data,
    cargando: consulta.isPending && activa,
    error:
      consulta.error instanceof ErrorApi
        ? consulta.error.message
        : consulta.error
          ? 'no se pudo leer la bandeja'
          : null,
    aprobar,
    descartar,
  };
}
