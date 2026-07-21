import type { SesionCerberus } from './auth.js';

/**
 * DÓNDE VIVE LA SESIÓN DE CERBERUS DE CADA VENDEDORA.
 *
 * Cuando la vendedora entra a Hermes, guardamos acá su cookie de Cerberus. Así,
 * cuando registra una venta, Hermes POSTea el formulario a Cerberus con ESA
 * cookie — la venta queda atribuida a ella, y ella nunca tuvo que abrir Cerberus.
 *
 * En memoria a propósito: es una credencial de sesión viva; no va a la base ni al
 * disco. Si el server reinicia, la vendedora vuelve a entrar (y de paso se renueva
 * la sesión de Cerberus). Es lo correcto para algo tan sensible.
 */
const sesiones = new Map<string, SesionCerberus>();

export function guardarSesionCerberus(vendedoraId: string, sesion: SesionCerberus): void {
  sesiones.set(vendedoraId, sesion);
}

export function obtenerSesionCerberus(vendedoraId: string): SesionCerberus | null {
  return sesiones.get(vendedoraId) ?? null;
}

export function borrarSesionCerberus(vendedoraId: string): void {
  sesiones.delete(vendedoraId);
}
