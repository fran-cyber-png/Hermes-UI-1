import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * NOTAS — el «Notion» a una tecla (issue #47). Datos y reglas de orden/atajo;
 * la UI vive en `PanelNotas.tsx`. Ancladas a una conversación (`clave` de la
 * cola) o a `'general'` (la libreta personal, tecla «n» — `App.tsx`).
 *
 * A propósito NO entran a `PERSISTIBLES` (`src/lib/datos/persistencia.ts`): una
 * nota «paga el viernes» rehidratada como actual desde IndexedDB es peor que un
 * spinner. El queryKey `['notas', clave]` queda fuera de la lista blanca.
 */

export const LIMITE_TEXTO = 2000;

export interface Nota {
  id: number;
  clave: string;
  vendedoraId: string;
  texto: string;
  fijada: boolean;
  creadoAt: string;
  /** null = nunca editada. */
  editadoAt: string | null;
  /** null = viva. No hay borrado físico. */
  archivadoAt: string | null;
}

/**
 * Fijada primero, luego más nueva primero — espejo del `ORDER BY` del server
 * (`notas/notas.ts` en el server). Se re-aplica acá porque una edición local
 * (fijar/desfijar) puede llegar antes que la invalidación del query.
 */
export function ordenarNotas(notas: Nota[]): Nota[] {
  return [...notas].sort((a, b) => {
    if (a.fijada !== b.fijada) return a.fijada ? -1 : 1;
    return new Date(b.creadoAt).getTime() - new Date(a.creadoAt).getTime();
  });
}

/**
 * ¿La tecla que llegó es el atajo de la libreta? Puro — sin `preventDefault` ni
 * lectura del DOM: eso lo decide `App.tsx`, que además guarda con `tecleandoEn`
 * (ningún atajo global pisa un input). Los acordes con modificador NO son este
 * atajo (⌘N, Ctrl+N son del sistema operativo/navegador).
 */
export function esAtajoLibreta(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): boolean {
  return e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export function useNotas(clave: string, activo = true) {
  return useQuery({
    queryKey: ['notas', clave],
    queryFn: () => api<{ notas: Nota[] }>(`/api/notas?clave=${encodeURIComponent(clave)}`),
    select: (d) => ordenarNotas(d.notas),
    enabled: activo && Boolean(clave),
  });
}

export function useBuscarNotas(q: string) {
  const termino = q.trim();
  return useQuery({
    queryKey: ['notas', 'buscar', termino],
    queryFn: () => api<{ notas: Nota[] }>(`/api/notas?q=${encodeURIComponent(termino)}`),
    select: (d) => ordenarNotas(d.notas),
    enabled: termino.length > 0,
  });
}

/** Las tres mutaciones comparten la invalidación: la lista de esa `clave` (nunca se cachea en disco). */
export function useMutacionesNotas(clave: string) {
  const qc = useQueryClient();
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['notas', clave] });

  const crear = useMutation({
    mutationFn: (texto: string) => api<{ ok: true; nota: Nota }>('/api/notas', { method: 'POST', body: JSON.stringify({ clave, texto }) }),
    onSuccess: invalidar,
  });

  const editar = useMutation({
    mutationFn: (v: { id: number; texto?: string; fijada?: boolean }) =>
      api<{ ok: true; nota: Nota }>(`/api/notas/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ texto: v.texto, fijada: v.fijada }),
      }),
    onSuccess: invalidar,
  });

  const archivar = useMutation({
    mutationFn: (id: number) => api<{ ok: true; nota: Nota }>(`/api/notas/${id}/archivar`, { method: 'PATCH' }),
    onSuccess: invalidar,
  });

  return { crear, editar, archivar };
}
