import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';

/**
 * ROUTING, DEL LADO DE LA APP — qué campaña de Meta cae en qué vendedora.
 *
 * Contra `/api/routing` (`server/src/routes/routing.ts`). Acá no se decide nada:
 * el estado de la campaña, el orden de la lista y a quién SE PUEDE elegir los
 * arma el server, que es el mismo que después valida el `PUT`. Con dos cabezas,
 * la pantalla ofrecería un nombre que el server rechaza con 409 (#37).
 */

export type EstadoCampana = 'activa' | 'pausada' | 'desconocido';

export interface CampanaEnRouting {
  campanaId: string;
  nombre: string;
  estado: EstadoCampana;
  /** Cuántos anuncios suyos trajeron gente en la ventana. */
  anuncios: number;
  /** Cuántas PERSONAS escribieron por ella (no cuántos mensajes). */
  personas: number;
  ultima: string | null;
  /** A quién le cae. `null` = a la rueda del reparto, como siempre. */
  vendedoraId: string | null;
}

export interface FotoDeRouting {
  linea: string;
  etiqueta: string | null;
  ventanaDias: number;
  campanas: CampanaEnRouting[];
  /**
   * Anuncios que trajeron gente y todavía no se resolvieron contra Meta. Es el
   * único motivo por el que una campaña viva puede faltar de la lista, así que
   * se muestra: sin el número, la pantalla afirmaría «estas son todas».
   */
  anunciosSinResolver: number;
  actualizadoAt: string | null;
  sinMigracion: boolean;
  destinos: string[];
}

/**
 * La foto. `retry: false` porque los dos fallos que importan son de
 * configuración, no de red: sin línea de Cloud API (503 `sin_linea_cloud_api`) y
 * sin migración. Reintentar no arregla ninguno y solo demora el cartel.
 */
export function useRouting() {
  return useQuery<FotoDeRouting, ErrorApi>({
    queryKey: ['routing'],
    queryFn: () => api<FotoDeRouting>('/api/routing'),
    retry: false,
  });
}

/**
 * PONER O SACAR LA REGLA. `vendedoraId: null` la saca — la campaña vuelve a la
 * rueda.
 *
 * ⚠️ **No es optimista, a propósito.** El destino lo VERIFICA el server y un
 * desconocido vuelve 409: pintar el cambio antes de la respuesta mostraría la
 * campaña ya asignada y la revertiría medio segundo después. Acá lo que se
 * decide es a quién le caen los leads de mañana; se espera el sí.
 */
export function useElegirDueno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campanaId, vendedoraId }: { campanaId: string; vendedoraId: string | null }) =>
      api(`/api/routing/campanas/${encodeURIComponent(campanaId)}`, {
        method: 'PUT',
        body: JSON.stringify({ vendedoraId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing'] }),
  });
}

export interface Refresco {
  preguntados: number;
  resueltos: number;
  fallaron: string[];
}

/** Preguntarle a Meta de qué campaña es cada anuncio nuevo. */
export function useRefrescarDesdeMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Refresco>('/api/routing/refrescar', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing'] }),
  });
}

/**
 * Cómo se dice cada estado. Vive acá y no adentro del JSX para poder
 * interrogarla sobre el valor que todavía no existe: un estado nuevo de Meta
 * cae en «no se sabe» y lo dice, nunca en «pausada» ni en un throw.
 */
export function rotuloEstado(estado: EstadoCampana): string {
  switch (estado) {
    case 'activa':
      return 'Activa';
    case 'pausada':
      return 'Pausada';
    default:
      return 'No se sabe';
  }
}

/**
 * Cuánto hace que llegó alguien por esta campaña, en criollo. `null` cuando no
 * llegó nadie — que no es «hace mucho», es que no hay nada que contar.
 */
export function haceCuanto(iso: string | null, ahora = Date.now()): string | null {
  if (!iso) return null;
  const ms = ahora - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const dias = Math.floor(ms / 86_400_000);
  if (dias >= 1) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const horas = Math.floor(ms / 3_600_000);
  if (horas >= 1) return `hace ${horas} h`;
  return 'recién';
}
