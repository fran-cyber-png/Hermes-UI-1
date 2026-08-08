/**
 * EL LEAD-FORM EN LA FICHA (#113) — el contrato y la lógica pura.
 *
 * El server (`/api/contactos/lead`) deriva de la tabla `leads`, por match de
 * teléfono, lo que Meta o una landing web ya sabe de la persona. Acá viven el
 * tipo que llega y las decisiones sin DOM: la etiqueta de origen y si el nombre
 * real aporta algo sobre el pushname de WhatsApp.
 */

export type FuenteLead = 'meta' | 'web';

export interface LeadForm {
  nombre: string | null;
  email: string | null;
  campana: string | null;
  anuncio: string | null;
  formulario: string | null;
  /** ISO 8601 — cuándo llenó el formulario. */
  fecha: string;
  fuente: FuenteLead;
}

/** El pie de «📋 …» que marca de dónde salió cada dato derivado. */
export function etiquetaFuente(fuente: FuenteLead): string {
  return fuente === 'web' ? 'del formulario web' : 'del formulario de Meta';
}

/**
 * EL ORIGEN, EN UNA PALABRA — lo que se lee en la ficha, y tiene que ser LA
 * MISMA palabra que usa la fila del radar.
 *
 * 🔴 El 8-ago-2026 la misma pantalla decía las dos cosas: la fila del radar
 * etiquetaba «Landing» y la ficha que se abre al tocarla, «Web». No eran dos
 * datos distintos, era el MISMO hecho con dos vocabularios — y había tres
 * copias del ternario (acá, en `PanelDerecho` y en el CASE del server).
 *
 * ⚠️ El VALOR del contrato sigue siendo `web` y no se toca: es interno, no lo
 * lee nadie, y cambiarlo obligaría a versionar `/api/contactos/lead` para
 * arreglar una palabra. Lo que se unifica es lo que la persona ve.
 */
export function origenDeLead(fuente: FuenteLead): string {
  // `switch` y no un ternario: con dos valores da igual, pero el día que se
  // agregue una fuente el compilador obliga a decidir su palabra en vez de
  // meterla de callado en la rama del `else` — que es cómo un lead de landing
  // terminaría rotulado «Meta Ads».
  switch (fuente) {
    case 'meta':
      return 'Meta Ads';
    case 'web':
      return 'Landing';
  }
}

/**
 * El nombre real del formulario, SÓLO si aporta sobre el pushname de WhatsApp
 * (que a veces es «🦋W» o «10 ❤️L»). Si el lead no trae nombre, o es el mismo que
 * el pushname (ignorando mayúsculas y espacios de más), no hay nada que mostrar.
 */
export function nombreDistinto(pushname: string | null, leadNombre: string | null): string | null {
  const real = (leadNombre ?? '').trim();
  if (!real) return null;
  const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (pushname && canon(pushname) === canon(real)) return null;
  return real;
}
