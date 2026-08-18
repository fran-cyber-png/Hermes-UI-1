import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * PLANTILLAS DE TEXTO DE LA LIBRETA — snippets personales que se pegan desde el
 * `/` del editor. Espejo chico de `notas.ts`: mismo cliente `api`, mismo patrón
 * de mutaciones que invalidan una sola clave de caché.
 *
 * No confundir con las plantillas de WhatsApp (`features/plantillas/`): esas se
 * mandan a un lead y tienen pasos, familia de curso, estado; éstas son un cajón
 * de texto propio que nunca sale de la Libreta.
 */

export interface PlantillaTexto {
  id: number;
  vendedoraId: string;
  titulo: string;
  texto: string;
  creadoAt: string;
  actualizadoAt: string;
  archivadoAt: string | null;
}

const CLAVE = ['plantillasTexto'] as const;

export function usePlantillasTexto() {
  return useQuery({
    queryKey: CLAVE,
    queryFn: () => api<{ plantillas: PlantillaTexto[] }>('/api/plantillas-texto'),
    select: (d) => d.plantillas,
  });
}

export function useMutacionesPlantillasTexto() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: CLAVE });

  const crear = useMutation({
    mutationFn: (v: { titulo: string; texto: string }) =>
      api<{ ok: true; plantilla: PlantillaTexto }>('/api/plantillas-texto', {
        method: 'POST',
        body: JSON.stringify(v),
      }),
    onSuccess: invalidar,
  });

  const editar = useMutation({
    mutationFn: (v: { id: number; titulo: string; texto: string }) =>
      api<{ ok: true; plantilla: PlantillaTexto }>(`/api/plantillas-texto/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ titulo: v.titulo, texto: v.texto }),
      }),
    onSuccess: invalidar,
  });

  const eliminar = useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/api/plantillas-texto/${id}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  return { crear, editar, eliminar };
}
