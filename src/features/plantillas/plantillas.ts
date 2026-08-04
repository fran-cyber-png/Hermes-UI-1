import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LOS DATOS DE LAS PLANTILLAS-SECUENCIA.
 *
 * Una plantilla es una LISTA ORDENADA DE PASOS, no un texto: la venta real son
 * cuatro mensajes (flyer → seguimiento → temario → duración) y el 42 % lleva
 * imagen. Modelarla como un cuerpo largo obligaría a mandar el flyer escrito.
 *
 * El `{precio}` NO se resuelve acá. Se pide al server con `preparar`, que lo trae
 * de Cerberus en el instante: el caché de consultas se persiste en IndexedDB
 * (ADR 0007) y rehidrataría el precio de ayer. Un precio de ayer en una
 * cotización es plata perdida.
 */

export interface MediaPaso {
  archivo: string;
  mime: string;
  clase: 'imagen' | 'video' | 'audio' | 'documento';
  nombre: string | null;
}

export interface PasoPlantilla {
  orden: number;
  texto: string | null;
  media: MediaPaso | null;
  /** El paso pide una imagen que todavía no está cargada: no se puede mandar. */
  mediaPendiente: boolean;
}

export interface Plantilla {
  id: number;
  nombre: string;
  familiaCurso: string | null;
  /** `propuesta` = salió del histórico y nadie la revisó todavía. No se manda. */
  estado: 'propuesta' | 'aprobada';
  origen: string;
  /** Cuántas conversaciones del histórico respaldan la propuesta. */
  respaldo: number;
  usos: number;
  /**
   * `personal` (solo su dueña la ve) | `equipo` (la ven y la mandan todas).
   * Opcional: un server viejo no lo manda, y ahí se lee como `personal` — que es
   * el comportamiento de siempre, no un downgrade silencioso.
   */
  alcance?: 'personal' | 'equipo' | string;
  /** Quién la escribió. Con `alcance='equipo'`, quien la puede EDITAR. */
  vendedoraId?: string;
  pasos: PasoPlantilla[];
}

/** Un paso ya con las variables resueltas: lo que de verdad va a salir. */
export interface PasoPreparado {
  orden: number;
  texto: string | null;
  /** Las variables que quedaron como hueco (`[precio]`…). Se avisa, no se bloquea. */
  faltantes: string[];
  media: MediaPaso | null;
  mediaPendiente: boolean;
}

export interface SecuenciaPreparada {
  plantilla: { id: number; nombre: string; estado: string };
  pasos: PasoPreparado[];
  total: number;
  enviable: boolean;
}

const CLAVE = ['plantillas'] as const;

export function usePlantillas() {
  return useQuery({
    queryKey: CLAVE,
    queryFn: () => api<{ plantillas: Plantilla[] }>('/api/plantillas'),
    staleTime: 5 * 60_000,
  });
}

/** El catálogo agrupado por familia (#129): UNA fila por diploma, no cinco ediciones. */
export interface FamiliaCurso {
  familia: string;
  nombre: string;
  ediciones: number;
  ultimaEdicionSku: string;
}

export function useFamiliasCurso(activo: boolean) {
  return useQuery({
    queryKey: ['plantillas', 'cursos'],
    queryFn: () => api<{ familias: FamiliaCurso[] }>('/api/plantillas/cursos'),
    enabled: activo,
    staleTime: 10 * 60_000,
  });
}

export function usePrepararSecuencia() {
  return useMutation({
    mutationFn: (v: { id: number; clave: string; telefono?: string; personaNombre?: string | null }) =>
      api<SecuenciaPreparada>(`/api/plantillas/${v.id}/preparar`, {
        method: 'POST',
        body: JSON.stringify({ clave: v.clave, telefono: v.telefono, personaNombre: v.personaNombre }),
      }),
  });
}

/**
 * APROBAR una propuesta. `familiaCurso` es la decisión sobre el curso, y va
 * SIEMPRE: la familia que el minado infirió (confirmada), otra, o `null` =
 * «sirve para cualquier curso». El server rechaza aprobar sin resolver eso —
 * una plantilla sin curso no matchea con ninguna conversación.
 */
export function useAprobarPlantilla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; familiaCurso: string | null }) =>
      api(`/api/plantillas/${v.id}/aprobar`, {
        method: 'POST',
        body: JSON.stringify({ familiaCurso: v.familiaCurso }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE }),
  });
}

export function useArchivarPlantilla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/api/plantillas/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE }),
  });
}

/**
 * COMPARTIR CON EL EQUIPO — la mitad de «los 5 tienen el creador de plantillas».
 *
 * Con cinco personas en una línea, un catálogo personal hace que cada una
 * arranque vacía. Esto las junta. Solo la dueña puede cambiarlo: el server
 * responde 404 si no lo es, y ese 404 se muestra en vez de tragarse.
 */
export function useCompartirPlantilla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; alcance: 'personal' | 'equipo' }) =>
      api(`/api/plantillas/${v.id}/alcance`, {
        method: 'PUT',
        body: JSON.stringify({ alcance: v.alcance }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE }),
  });
}

export interface EntradaPlantilla {
  nombre: string;
  familiaCurso?: string | null;
  pasos: { texto?: string | null; media?: MediaPaso | null; mediaPendiente?: boolean }[];
}

export function useGuardarPlantilla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: number; entrada: EntradaPlantilla }) =>
      api<{ plantilla: Plantilla }>(v.id ? `/api/plantillas/${v.id}` : '/api/plantillas', {
        method: v.id ? 'PATCH' : 'POST',
        body: JSON.stringify(v.entrada),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLAVE }),
  });
}
