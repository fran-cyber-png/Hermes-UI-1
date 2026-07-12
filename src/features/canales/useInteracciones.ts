import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, claves } from '../../lib/datos/cliente';
import type { Intencion, Interaccion, Rango, TipoFiltro } from './types';

interface Filtros {
  canal?: string;
  tipo?: TipoFiltro;
  intencion?: Intencion;
  rango?: Rango;
  porTanda?: number;
}

type Pagina = { interacciones: Interaccion[]; total?: number; hayMas: boolean };

/**
 * Carga paginada de interacciones. La usan la bandeja, el resumen de la home y la pantalla de
 * cada canal — los tres.
 *
 * ── Qué cambió, y por qué ──
 * Antes era `useState` + `useEffect` + `fetch` a mano, por componente. Tres pantallas pedían lo
 * mismo sin compartir nada, y navegar y volver refetcheaba todo. Peor: no había cancelación, así
 * que una respuesta vieja podía pisar los datos del canal nuevo al navegar de `/canal/facebook`
 * a `/canal/instagram`.
 *
 * Ahora es una query cacheada por filtros. Tres pantallas con los mismos filtros = UNA llamada.
 * La cancelación al desmontar viene sola. Y al responder, `invalidarBandeja()` refresca las tres
 * sin que ninguna sepa de la existencia de las otras.
 *
 * El backend ya devuelve la cola ordenada por urgencia: ventana abierta primero, y dentro de esa
 * la más vieja arriba — es a la que le quedan menos horas.
 */
export function useInteracciones({
  canal = '',
  tipo = '',
  intencion = '',
  rango = 'todo',
  porTanda = 30,
}: Filtros) {
  const filtros = { canal, tipo, intencion, rango, porTanda };

  const q = useInfiniteQuery({
    queryKey: claves.bandeja(filtros),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({
        limit: String(porTanda),
        offset: String(pageParam),
        rango,
      });
      if (canal) p.set('canal', canal);
      if (tipo) p.set('tipo', tipo);
      if (intencion) p.set('intencion', intencion);
      return api<Pagina>(`/api/interactions?${p}`);
    },
    // El total solo viene en la primera página: recontarlo en cada scroll cuesta y no aporta.
    getNextPageParam: (ultima, todas) =>
      ultima.hayMas ? todas.reduce((n, p) => n + p.interacciones.length, 0) : undefined,
  });

  const items = q.data?.pages.flatMap((p) => p.interacciones) ?? [];

  return {
    items,
    total: q.data?.pages[0]?.total ?? 0,
    hayMas: Boolean(q.hasNextPage),
    cargando: q.isPending,
    cargandoMas: q.isFetchingNextPage,
    cargarMas: () => void q.fetchNextPage(),
  };
}

/**
 * Refresca todas las bandejas después de responder.
 *
 * Esto reemplaza a los tres `setRespondidas((prev) => [...prev, id])` que había — uno por
 * componente, sin sincronizar entre sí. El estado de atención no es del cliente: es del
 * servidor. Acá solo le decimos al caché que lo que tiene quedó viejo.
 */
export function useInvalidarBandeja() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['bandeja'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: ['canal'] });
  }, [qc]);
}
