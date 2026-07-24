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
