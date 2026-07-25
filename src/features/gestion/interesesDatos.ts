import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { normalizarIntereses, type RespuestaIntereses } from './lineaDeTiempo';

/**
 * EL INTERÉS, COMO DATO — leerlo y escribirlo, en un solo lugar.
 *
 * Vivía dentro de `Intereses.tsx`. Sale acá porque ahora hay DOS superficies que
 * registran interés: el buscador de siempre y la propuesta de un clic del panel
 * derecho (`BloqueInteres`). Con la mutación duplicada, la lista de claves a
 * invalidar se habría separado en tres semanas y una de las dos superficies
 * habría dejado el embudo sin refrescar. Una sola.
 */

export function useIntereses(clave: string) {
  return useQuery({
    queryKey: ['intereses', clave],
    queryFn: () =>
      api<RespuestaIntereses>(`/api/gestiones/intereses?claves=${encodeURIComponent(clave)}`),
    // Tolera la forma nueva (con fecha) y la vieja/cacheada (plana): ver `lineaDeTiempo.ts`.
    select: (d) => normalizarIntereses(d, clave),
  });
}

/** Lo que hay que repintar cuando el interés cambia: la lista y el embudo (es su compuerta). */
function useInvalidarInteres(clave: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['intereses', clave] });
    void qc.invalidateQueries({ queryKey: ['embudo'] });
    // La fila de la cola lleva el chip de curso (#72): sin esto, el chip sigue
    // diciendo «del anuncio» después de que la vendedora lo asentó.
    void qc.invalidateQueries({ queryKey: ['conversaciones'] });
  };
}

export function useAgregarInteres(clave: string, onListo?: (curso: string) => void) {
  const invalidar = useInvalidarInteres(clave);
  return useMutation({
    mutationFn: (curso: string) =>
      api('/api/gestiones/intereses', { method: 'POST', body: JSON.stringify({ clave, curso }) }),
    onSuccess: (_d, curso) => {
      invalidar();
      onListo?.(curso);
    },
  });
}

export function useQuitarInteres(clave: string) {
  const invalidar = useInvalidarInteres(clave);
  return useMutation({
    mutationFn: (curso: string) =>
      api('/api/gestiones/intereses', { method: 'DELETE', body: JSON.stringify({ clave, curso }) }),
    onSuccess: invalidar,
  });
}
