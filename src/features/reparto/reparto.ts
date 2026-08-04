import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL REPARTO, DEL LADO DE LA APP — quiénes participan de una línea y a quién se
 * le puede pasar una conversación.
 *
 * Contra `/api/reparto` (`server/src/routes/reparto.ts`). La rueda **no se carga
 * desde acá**: quiénes entran al reparto lo decide quien maneja el equipo, con
 * `npm run reparto:rueda`. Esta superficie solo lee y pasa.
 */

export interface EnElReparto {
  vendedoraId: string;
  /** Cuántas conversaciones tiene de esta línea. */
  asignadas: number;
  orden: number;
  /** Sigue recibiendo leads nuevos. `false` = está fuera, pero conserva las suyas. */
  activa: boolean;
}

interface RespuestaRueda {
  linea: string;
  rueda: EnElReparto[];
  /**
   * A quiénes se les puede pasar una conversación de esta línea: la rueda (aun
   * las inactivas) más el mapa `numero_vendedora`. Lo arma el server porque es la
   * MISMA lista contra la que valida el `PUT` — con dos, la app ofrecería a
   * alguien que el server después rechaza.
   */
  destinos: string[];
}

/**
 * La rueda de UNA línea. Sin línea (un comentario de FB/IG, una conversación
 * cuyo `numero_propio` no viajó) no se consulta nada: no hay reparto que mostrar.
 *
 * `retry: false` y silencio ante el 503: un server sin la migración del reparto
 * responde `reparto_no_migrado`, y eso no es un error que valga la pena reintentar
 * ni un cartel que la vendedora tenga que leer — simplemente no aparece la opción
 * de pasar la conversación, que es lo correcto.
 */
export function useRueda(numeroPropio: string | null | undefined) {
  const q = useQuery({
    queryKey: ['reparto-rueda', numeroPropio],
    queryFn: () => api<RespuestaRueda>(`/api/reparto/rueda?linea=${encodeURIComponent(numeroPropio!)}`),
    enabled: Boolean(numeroPropio),
    // La rueda cambia cuando alguien corre el script, o sea casi nunca. Refrescarla
    // con el pulso de la cola sería una consulta por minuto para un dato semanal.
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    rueda: q.data?.rueda ?? [],
    destinos: q.data?.destinos ?? [],
    /** Hay reparto configurado en esta línea: recién ahí se ofrece pasarla. */
    hayReparto: (q.data?.destinos.length ?? 0) > 0,
    cargando: q.isPending,
  };
}

/**
 * PASARLE ESTA CONVERSACIÓN A OTRA PERSONA.
 *
 * Es una ESCRITURA y una acción humana: al terminar invalida la cola para que la
 * píldora de dueño se repinte en la fila, y la rueda para que las cargas del
 * selector queden al día (si no, pasar tres seguidas mostraría siempre la misma
 * foto y parecería que no pasó nada).
 *
 * El 409 `vendedora_desconocida` **se muestra**: es la red contra el dedazo en el
 * username de Cerberus, y esconderlo devolvería el fallo silencioso que la guarda
 * existe para impedir.
 */
export function usePasarConversacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { clave: string; numeroPropio: string; vendedoraId: string }) =>
      api('/api/reparto/asignacion', { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
      void qc.invalidateQueries({ queryKey: ['reparto-rueda'] });
    },
  });
}
