import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { porQueNoSeGuardo, verBot, type ModoBot, type RespuestaBotApi, type VistaBot } from './estado';

/**
 * EL PUENTE con `/api/bot` — la ruta que estaba montada y **no la llamaba nadie**.
 *
 * `GET /estado` · `PUT /modo` · `PUT /freno`. Copia deliberada de
 * `autorespuesta/datos.ts`: misma forma, mismo refresco, mismas dos reglas de
 * abajo. Que las dos máquinas que le escriben a un lead se manejen igual no es
 * estética — es que la vendedora aprenda el gesto una sola vez.
 *
 * ── Se REFRESCA solo, cada 30 s ─────────────────────────────────────────
 * El estado del bot cambia SIN que nadie toque el chip: la fila de `bot_estado`
 * la puede escribir otra vendedora desde su máquina, o el `.env` del server
 * después de un restart. Una pantalla que siga diciendo «Apagado» sobre un bot
 * que volvió a `automatico` es exactamente la mentira que este chip vino a
 * evitar.
 *
 * ── `retry: false`, y NUNCA se asume el resultado ───────────────────────
 * Si el server no contesta, se dice «sin señal» en vez de insistir — y la vista
 * **no cae a apagado**, que sería la mentira cómoda (`verBot` lo garantiza).
 * Después de cambiar el modo se RELEE del server en vez de pintar lo que se
 * pidió: en un interruptor, lo que vale es lo que quedó guardado, y un optimista
 * acá dibujaría «Apagado» sobre un `PUT` que falló.
 */

export const CLAVE_BOT = ['bot'] as const;

export function useBot(): {
  vista: VistaBot;
  cargando: boolean;
  cambiando: boolean;
  /** Qué salió mal al escribir. Pisa el renglón de abajo, como en la auto-respuesta. */
  errorAlCambiar: string | null;
  cambiarModo: (modo: ModoBot) => void;
  soltarFreno: () => void;
} {
  const qc = useQueryClient();
  const releer = () => void qc.invalidateQueries({ queryKey: CLAVE_BOT });

  const consulta = useQuery({
    queryKey: CLAVE_BOT,
    queryFn: () => api<RespuestaBotApi>('/api/bot/estado'),
    refetchInterval: 30_000,
    retry: false,
  });

  const modo = useMutation({
    mutationFn: (m: ModoBot) => api<unknown>('/api/bot/modo', { method: 'PUT', body: JSON.stringify({ modo: m }) }),
    onSettled: releer,
  });

  // Soltar el freno es lo ÚNICO que se escribe acá aparte del modo, y va con
  // `frenado: false` explícito: el server usa ese booleano para decidir si borra
  // el motivo o lo escribe.
  const freno = useMutation({
    mutationFn: () => api<unknown>('/api/bot/freno', { method: 'PUT', body: JSON.stringify({ frenado: false }) }),
    onSettled: releer,
  });

  const fallo = modo.error ?? freno.error;
  const errorAlCambiar = fallo ? porQueNoSeGuardo(fallo instanceof ErrorApi ? fallo.status : null) : null;

  // 404 = este server es anterior a la ruta (el front sale por N4 y el server por
  // N5: la ventana entre los dos es real). 400 = la ruta existe y no pudo decidir
  // sobre qué línea opera. Son dos cosas distintas y el chip las dice distinto.
  const status = consulta.error instanceof ErrorApi ? consulta.error.status : null;

  return {
    vista: verBot(consulta.data, { sinRuta: status === 404, sinLinea: status === 400 }),
    cargando: consulta.isPending,
    cambiando: modo.isPending || freno.isPending,
    errorAlCambiar,
    cambiarModo: (m: ModoBot) => modo.mutate(m),
    soltarFreno: () => freno.mutate(),
  };
}
