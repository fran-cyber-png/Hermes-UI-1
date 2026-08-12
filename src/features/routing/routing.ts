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
  /** Su producto, o `null`. Medido: las campañas resuelven 19 de 44. */
  familia: string | null;
  /** LOS CABLES: a quiénes les puede caer. Vacío = a la rueda del reparto. */
  vendedoras: string[];
}

/**
 * UN CURSO DE FORMULARIO — la otra fuente de leads, y la que más volumen trae:
 * medido el 12-ago-2026, **178 leads en 30 días contra 33 de la campaña activa**.
 */
export interface CursoEnRouting {
  curso: string;
  /** Su producto, o `null` si no resuelve a ninguno. */
  familia: string | null;
  leads: number;
  ultimo: string | null;
  /** Vacío = lo ve todo el equipo, como hasta ahora. */
  vendedoras: string[];
}

/** Un producto: lo que junta varias campañas con sus formularios. */
export interface ProductoEnRouting {
  familia: string;
  nombre: string;
}

export interface FotoDeRouting {
  linea: string;
  etiqueta: string | null;
  ventanaDias: number;
  campanas: CampanaEnRouting[];
  /** Los cursos que llegan por los formularios de icarus. */
  cursos: CursoEnRouting[];
  /** El catálogo de productos, con su nombre comercial. Lo arma el server. */
  productos: ProductoEnRouting[];
  /** Anuncios que trajeron gente y todavía no se resolvieron contra Meta. */
  anunciosSinResolver: number;
  /**
   * Campañas de la cuenta que mandan a WhatsApp pero **no a esta línea**. No se
   * listan porque no se pueden cablear, pero se MUESTRAN como número: medido el
   * 12-ago-2026, dieciséis de diecisiete adsets activos mandan a otro teléfono,
   * y esconderlo haría que la pantalla afirme «estas son todas las campañas».
   */
  campanasEnOtraLinea: number;
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
 * DEJAR LOS CABLES DE UNA CAMPAÑA. Viaja el conjunto COMPLETO, no un cable:
 * con `conectar`/`desconectar` sueltos, dos personas editando la misma campaña
 * se pisan y la última cree que sumó uno cuando en realidad borró el de la otra.
 * `vendedoras: []` corta todos y la campaña vuelve a la rueda.
 *
 * ⚠️ **No es optimista, a propósito.** El destino lo VERIFICA el server y un
 * desconocido vuelve 409: pintar el cambio antes de la respuesta mostraría la
 * campaña ya asignada y la revertiría medio segundo después. Acá lo que se
 * decide es a quién le caen los leads de mañana; se espera el sí.
 */
/**
 * DEJAR LOS CABLES DE UN CURSO. El curso viaja en el body y no en la URL: son
 * nombres de producto con espacios, tildes y `&`, y en el path quedan a merced
 * de cualquier proxy que normalice por su cuenta.
 */
/**
 * CABLEAR UN PRODUCTO ENTERO. **Escribe el cable en cada una de sus campañas y
 * formularios**; no crea una regla que los demás hereden. Por eso el acuse dice
 * cuántos tocó: «listo» sobre cinco renglones y sobre cero se ven igual.
 */
export function useConectarProducto() {
  const qc = useQueryClient();
  return useMutation({
    /**
     * ⚠️ **`modo` decide si el gesto es destructivo, y el default NO lo es por
     * accidente**: `reemplazar` es el del botón «Poner este cable en las N»,
     * que dice qué va a pisar. El arrastre manda `agregar`/`quitar` — ver
     * `ModoDeCableado` en el server.
     */
    mutationFn: ({
      familia,
      vendedoras,
      modo,
    }: {
      familia: string;
      vendedoras: string[];
      modo?: 'reemplazar' | 'agregar' | 'quitar';
    }) =>
      api<{ campanas: number; cursos: number }>('/api/routing/productos', {
        method: 'PUT',
        body: JSON.stringify({ familia, vendedoras, modo: modo ?? 'reemplazar' }),
      }),
    /**
     * 🔴 **`onSettled` y NO `onSuccess`: un rechazo TIENE que traer la foto de
     * vuelta.** El cable se dibuja con el gesto (antes de que el server
     * conteste), y quien lo revierte es el refetch. Con `onSuccess`, un `409`
     * —destino que no está en la rueda, que es el rechazo más probable acá— no
     * invalidaba nada: quedaba el cable dibujado sobre una regla que no existe,
     * y la franja roja de abajo no alcanza porque lo que la persona mira es el
     * cable.
     */
    onSettled: () => qc.invalidateQueries({ queryKey: ['routing'] }),
  });
}

export function useConectarCurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ curso, vendedoras }: { curso: string; vendedoras: string[] }) =>
      api('/api/routing/cursos', { method: 'PUT', body: JSON.stringify({ curso, vendedoras }) }),
    /**
     * 🔴 **`onSettled` y NO `onSuccess`: un rechazo TIENE que traer la foto de
     * vuelta.** El cable se dibuja con el gesto (antes de que el server
     * conteste), y quien lo revierte es el refetch. Con `onSuccess`, un `409`
     * —destino que no está en la rueda, que es el rechazo más probable acá— no
     * invalidaba nada: quedaba el cable dibujado sobre una regla que no existe,
     * y la franja roja de abajo no alcanza porque lo que la persona mira es el
     * cable.
     */
    onSettled: () => qc.invalidateQueries({ queryKey: ['routing'] }),
  });
}

export function useConectar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campanaId, vendedoras }: { campanaId: string; vendedoras: string[] }) =>
      api(`/api/routing/campanas/${encodeURIComponent(campanaId)}`, {
        method: 'PUT',
        body: JSON.stringify({ vendedoras }),
      }),
    /**
     * 🔴 **`onSettled` y NO `onSuccess`: un rechazo TIENE que traer la foto de
     * vuelta.** El cable se dibuja con el gesto (antes de que el server
     * conteste), y quien lo revierte es el refetch. Con `onSuccess`, un `409`
     * —destino que no está en la rueda, que es el rechazo más probable acá— no
     * invalidaba nada: quedaba el cable dibujado sobre una regla que no existe,
     * y la franja roja de abajo no alcanza porque lo que la persona mira es el
     * cable.
     */
    onSettled: () => qc.invalidateQueries({ queryKey: ['routing'] }),
  });
}

export interface Refresco {
  /** Cuántas campañas trajo el catálogo de Meta. */
  campanas: number;
  preguntados: number;
  resueltos: number;
  fallaron: string[];
}

/** Preguntarle a Meta de qué campaña es cada anuncio nuevo. */
export function useRefrescarDesdeMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Refresco>('/api/routing/refrescar', { method: 'POST' }),
    /**
     * 🔴 **`onSettled` y NO `onSuccess`: un rechazo TIENE que traer la foto de
     * vuelta.** El cable se dibuja con el gesto (antes de que el server
     * conteste), y quien lo revierte es el refetch. Con `onSuccess`, un `409`
     * —destino que no está en la rueda, que es el rechazo más probable acá— no
     * invalidaba nada: quedaba el cable dibujado sobre una regla que no existe,
     * y la franja roja de abajo no alcanza porque lo que la persona mira es el
     * cable.
     */
    onSettled: () => qc.invalidateQueries({ queryKey: ['routing'] }),
  });
}

/**
 * Cómo se dice cada estado. Vive acá y no adentro del JSX para poder
 * interrogarla sobre el valor que todavía no existe: un estado nuevo de Meta
 * cae en «no se sabe» y lo dice, nunca en «pausada» ni en un throw.
 */
/** Un anuncio de una campaña. **Solo lectura**: no existe una regla por anuncio. */
export interface AnuncioDeCampana {
  adId: string;
  titular: string | null;
  personas: number;
  ultima: string | null;
}

/**
 * LOS ANUNCIOS DE UNA CAMPAÑA — se piden solo al entrar en ella.
 *
 * ⚠️ `enabled` y no un `if` afuera: sin campaña elegida no hay nada que pedir, y
 * react-query no puede tener un hook condicional.
 */
export function useAnunciosDeCampana(campanaId: string | null) {
  return useQuery<{ anuncios: AnuncioDeCampana[] }, ErrorApi>({
    queryKey: ['routing', 'anuncios', campanaId],
    queryFn: () =>
      api(`/api/routing/campanas/${encodeURIComponent(campanaId!)}/anuncios`),
    enabled: Boolean(campanaId),
    retry: false,
  });
}

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
