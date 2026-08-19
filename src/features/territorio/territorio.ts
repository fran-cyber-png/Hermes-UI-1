import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL TERRITORIO DE UNA CAMPAÑA, DEL LADO DEL CLIENTE (ADR 0063).
 *
 * ⚠️ **Esto sólo existe en el módulo de campañas.** `/api/territorio` contesta
 * **403** a una vendedora de la Escuela (`modulos/modulo.ts`), así que el hook se
 * llama con `activo` y el panel lo apaga: pedirlo desde ventas sería un error
 * garantizado en cada ficha que se abre.
 */

export interface Distrito {
  id: number;
  nombre: string;
  zona: string | null;
  orden: number;
}

export interface RespuestaTerritorio {
  distritos: Distrito[];
  /** Cuánta gente cayó en cada distrito. La clave es el id, en texto (viene de JSON). */
  conteos: Record<string, number>;
  /** Dónde vota ESTA conversación. `null` = todavía no se le preguntó. */
  actual?: { distritoId: number; anotadoPor: string | null } | null;
  /** No hay línea de campaña asignada todavía. No es un error: es un alta a medias. */
  sinLinea?: boolean;
  /** La línea existe y nadie cargó distritos (o falta la migración). */
  sinCatalogo?: boolean;
}

export function useTerritorio(clave: string, activo: boolean) {
  return useQuery({
    queryKey: ['territorio', clave],
    queryFn: () => api<RespuestaTerritorio>(`/api/territorio?clave=${encodeURIComponent(clave)}`),
    enabled: activo && Boolean(clave),
    staleTime: 60_000,
  });
}

/**
 * Anotar o sacar el distrito.
 *
 * ⚠️ **NO es optimista, al revés de marcar leído.** Ahí el peor caso es un
 * punto que se vuelve a encender; acá es dato de campo que la operadora acaba de
 * preguntarle a una persona en la puerta de su casa, y darlo por guardado
 * mientras el server lo rechaza le hace perder el único momento en que lo tenía.
 * Se invalida al confirmar.
 */
export function useAnotarTerritorio(clave: string) {
  const qc = useQueryClient();
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['territorio', clave] });
  };
  const anotar = useMutation({
    mutationFn: (distritoId: number) =>
      api<{ ok: true }>(`/api/territorio/${encodeURIComponent(clave)}`, {
        method: 'PUT',
        body: JSON.stringify({ distritoId }),
      }),
    onSuccess: invalidar,
  });
  const sacar = useMutation({
    mutationFn: () =>
      api<{ ok: true }>(`/api/territorio/${encodeURIComponent(clave)}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });
  return { anotar, sacar };
}

/**
 * QUÉ SE LEE EN EL BLOQUE — puro, y por eso testeable sin DOM.
 *
 * 🔴 **Los tres estados vacíos NO son el mismo, y decir el equivocado manda a la
 * operadora a buscar donde no es**: «no tenés línea» es un alta a medias que
 * arregla un admin, «nadie cargó distritos» lo arregla quien maneja la campaña
 * con el CLI, y «todavía no le preguntaste» lo arregla ella misma, ahora.
 */
export function lecturaDeTerritorio(d: RespuestaTerritorio | undefined): {
  puedeAnotar: boolean;
  vacio: string | null;
} {
  if (!d) return { puedeAnotar: false, vacio: null };
  if (d.sinLinea) {
    return { puedeAnotar: false, vacio: 'Todavía no te asignaron la línea de la campaña.' };
  }
  if (d.sinCatalogo || d.distritos.length === 0) {
    return { puedeAnotar: false, vacio: 'Esta campaña todavía no tiene distritos cargados.' };
  }
  return { puedeAnotar: true, vacio: null };
}

/** El nombre del distrito de esta conversación, o `null` si no se le preguntó. */
export function distritoActual(d: RespuestaTerritorio | undefined): Distrito | null {
  const id = d?.actual?.distritoId;
  if (id == null) return null;
  // ⚠️ Un id que ya no está en el catálogo —lo apagaron después de anotarlo— no
  // se inventa: devuelve null y el bloque ofrece elegir de nuevo. Mostrar «—» al
  // lado de un dato que SÍ está guardado sería peor, pero mostrar un nombre que
  // el catálogo ya no reconoce es afirmar algo que nadie puede verificar.
  return d?.distritos.find((x) => x.id === id) ?? null;
}
