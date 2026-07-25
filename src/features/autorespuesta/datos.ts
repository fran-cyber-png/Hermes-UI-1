import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { verAutoRespuesta, type RespuestaAutoRespuesta, type VistaAutoRespuesta } from './estado';

/**
 * EL PUENTE con `GET /api/autorespuesta` y el kill-switch
 * (`PUT /api/autorespuesta/interruptor`).
 *
 * Se refresca cada 30 s: el estado puede cambiar SIN que nadie toque el botón
 * —el freno automático lo apaga solo ante un ban o un error de envío— y una
 * pantalla que siga diciendo «encendida» en ese caso estaría mintiendo.
 *
 * `retry: false` a propósito: si el server no contesta, se dice «sin señal» en
 * vez de insistir; y ante un error la vista NO cae a «apagada», que sería la
 * mentira cómoda.
 */

export const CLAVE_AUTORESPUESTA = ['autorespuesta'] as const;

export function useAutoRespuesta(): {
  vista: VistaAutoRespuesta;
  cargando: boolean;
  cambiando: boolean;
  errorAlCambiar: string | null;
  cambiar: (encendida: boolean) => void;
} {
  const qc = useQueryClient();

  const consulta = useQuery({
    queryKey: CLAVE_AUTORESPUESTA,
    queryFn: () => api<RespuestaAutoRespuesta>('/api/autorespuesta'),
    refetchInterval: 30_000,
    retry: false,
  });

  const mutar = useMutation({
    mutationFn: (encendida: boolean) =>
      api<{ ok: true }>('/api/autorespuesta/interruptor', {
        method: 'PUT',
        body: JSON.stringify({ encendida }),
      }),
    // Se relee del server en vez de asumir: el que manda es el estado guardado.
    onSettled: () => void qc.invalidateQueries({ queryKey: CLAVE_AUTORESPUESTA }),
  });

  const errorAlCambiar =
    mutar.error instanceof ErrorApi
      ? mutar.error.message
      : mutar.error
        ? 'no se pudo cambiar el interruptor'
        : null;

  // 404 = el server no tiene la ruta (versión anterior a esta feature). No es
  // «sin señal»: es que ahí esto todavía no existe, y el chip no se muestra.
  const sinRuta = consulta.error instanceof ErrorApi && consulta.error.status === 404;

  return {
    vista: verAutoRespuesta(consulta.data, { sinRuta }),
    cargando: consulta.isPending,
    cambiando: mutar.isPending,
    errorAlCambiar,
    cambiar: (encendida: boolean) => mutar.mutate(encendida),
  };
}
