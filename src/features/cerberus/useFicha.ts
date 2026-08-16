import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Ficha } from './ficha';

/**
 * LA FICHA DE CERBERUS, UNA SOLA QUERY PARA TODA LA APP.
 *
 * **Vive en su propio archivo y no adentro de `FichaContacto.tsx`.** Lo piden
 * cinco lugares —el panel derecho, la persona unificada, la venta desde el panel
 * y el modal de Cierre del Pipeline— y sacarlo del componente es lo que rompe el
 * único ciclo de archivo que tenía el front: `FichaContacto` dibuja
 * `<PersonaUnificada>`, y `PersonaUnificada` necesitaba este hook, así que los
 * dos archivos se importaban mutuamente. En ESM eso deja a uno viendo al otro a
 * medio inicializar — un `undefined` que no aparece al compilar sino al
 * ejecutar, y sólo a veces. Ver `arquitectura.json` › `sinCiclosDeArchivo`.
 *
 * **Con techo de espera, y no es un detalle.** La ficha viaja a Cerberus (Django,
 * sin API REST) y Cerberus a veces no cuelga la llamada: la deja abierta. Sin
 * techo, el panel se queda en «Buscando en Cerberus…» para siempre —verificado
 * en producción el 25-jul— y la vendedora nunca ve la acción primaria ni el
 * aviso de que algo falló. A los 12 s se corta y el estado pasa a «No se pudo
 * saber», que es la verdad y además ofrece salida. `retry: false` porque un
 * reintento duplica la espera antes de decirlo.
 */
export function useFicha(telefono: string | null, activo: boolean) {
  return useQuery({
    queryKey: ['ficha', telefono],
    queryFn: ({ signal }) =>
      api<Ficha>(`/api/contactos/ficha?telefono=${encodeURIComponent(telefono ?? '')}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      }),
    enabled: activo && Boolean(telefono),
    staleTime: 60_000,
    retry: false,
  });
}
