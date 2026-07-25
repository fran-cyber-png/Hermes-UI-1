import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * «ES LA MISMA PERSONA QUE…» — la capa de datos del enlace (issue #58).
 *
 * Un contacto que escribe desde dos números, o desde WhatsApp y desde Instagram, hoy es
 * dos fichas. Acá la vendedora afirma que son el mismo humano y la ficha se une. Los
 * HILOS no: la cola sigue igual, cada canal por su lado. Se unifica la ficha, nada más.
 */

export type OrigenUnificado = {
  identidad: string;
  canal: 'whatsapp' | 'instagram' | 'facebook';
  /** El `persona_id` del CRM: el teléfono en WhatsApp, el id de Meta en IG/Facebook. */
  personaId: string;
  nombre: string | null;
  /** Las claves del CRM de ese contacto (una por número propio por el que escribió). */
  claves: string[];
  mensajes: number;
  ultimoAt: string | null;
  enlazadoAt: string;
  enlazadoPor: string;
  intereses: string[];
  gestiones: number;
  ultimaEtapa: string | null;
};

export type Unificado = {
  clave: string;
  personaId: number | null;
  /** Los OTROS contactos del grupo. Vacío = esta ficha no está unificada con ninguna. */
  origenes: OrigenUnificado[];
};

export type ContactoBuscado = {
  clave: string;
  canal: string;
  personaId: string;
  nombre: string | null;
  ultimoAt: string | null;
  mensajes: number;
};

/** El grupo unificado de una conversación. Solo para claves `conv:` — un comentario no se enlaza. */
export function useUnificado(clave: string) {
  const enlazable = clave.startsWith('conv:');
  return useQuery({
    queryKey: ['enlaces', clave],
    queryFn: () => api<Unificado>(`/api/enlaces?clave=${encodeURIComponent(clave)}`),
    enabled: enlazable,
    staleTime: 60_000,
  });
}

/** El buscador del modal: por nombre o por teléfono, sobre las conversaciones que ya existen. */
export function useBuscarContactos(q: string) {
  return useQuery({
    queryKey: ['enlaces-buscar', q.trim().toLowerCase()],
    queryFn: () => api<{ contactos: ContactoBuscado[] }>(`/api/enlaces/buscar?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
}

/** Los motivos por los que Hermes NO enlaza, dichos como se los diría a una persona. */
export const MOTIVO_ENLACE: Record<string, string> = {
  misma_identidad: 'Es el mismo contacto: no hay nada que unir.',
  demasiadas_identidades: 'Esta ficha ya tiene demasiados contactos unidos. Deshacé alguno primero.',
  identidad_bloqueada: 'Ese contacto está vetado para unificar (es un número o cuenta compartida).',
  clave_no_enlazable: 'Esa conversación no se puede unir: no identifica a una persona.',
  conflicto: 'Alguien más lo estaba enlazando en este mismo momento. Probá de nuevo.',
};

export function useEnlazar(clave: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (claveB: string) =>
      api<{ ok: boolean; personaId: number; yaEstaban: boolean }>('/api/enlaces', {
        method: 'POST',
        body: JSON.stringify({ claveA: clave, claveB }),
      }),
    // Se invalida TODO el árbol de enlaces: enlazar cambia la ficha de los dos lados,
    // no solo la que estaba abierta.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['enlaces'] }),
  });
}

export function useDeshacerEnlace(clave: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (claveAQuitar: string) =>
      api<{ ok: boolean; revocadas: number }>(`/api/enlaces?clave=${encodeURIComponent(claveAQuitar)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enlaces'] });
      void qc.invalidateQueries({ queryKey: ['enlaces', clave] });
    },
  });
}
