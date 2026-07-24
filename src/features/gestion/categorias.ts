import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { ColorCategoria } from './paletaCategorias';

/**
 * LOS DATOS DE CATEGORÍAS — el catálogo con color, por vendedora (#48).
 *
 * El CATÁLOGO (nombre + color + favorita + orden + conteo) vive en
 * `/api/categorias`. La ASIGNACIÓN a una conversación NO está acá: sigue en
 * `/api/gestiones/etiquetas` (la maneja `EtiquetasInline`). El color de cada
 * píldora se resuelve en el front uniendo por nombre con este catálogo.
 */

export interface Categoria {
  id: number;
  nombre: string;
  color: string;
  esFavorito: boolean;
  orden: number;
  /** Conversaciones que hoy llevan esta categoría (alimenta el modo Listas, #49). */
  conteo: number;
}

/** El catálogo de la vendedora del token, ordenado y con conteo. */
export function useCategorias() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: () => api<{ categorias: Categoria[] }>('/api/categorias'),
    select: (d) => d.categorias,
  });
}

export interface PatchCategoria {
  id: number;
  nombre?: string;
  color?: ColorCategoria;
  esFavorito?: boolean;
  orden?: number;
}

/** Crear / editar / borrar categorías, invalidando el catálogo al terminar. */
export function useMutacionesCategorias() {
  const qc = useQueryClient();
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['categorias'] });
  };

  const crear = useMutation({
    mutationFn: (nueva: { nombre: string; color: ColorCategoria }) =>
      api<{ categoria: Categoria }>('/api/categorias', { method: 'POST', body: JSON.stringify(nueva) }),
    onSuccess: invalidar,
  });

  const editar = useMutation({
    mutationFn: ({ id, ...patch }: PatchCategoria) =>
      api(`/api/categorias/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: invalidar,
  });

  const borrar = useMutation({
    mutationFn: (id: number) => api(`/api/categorias/${id}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  return { crear, editar, borrar };
}
