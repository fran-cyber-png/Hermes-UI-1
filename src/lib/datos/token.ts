/**
 * EL TOKEN DE LA SESIÓN, EN UN SOLO LUGAR.
 *
 * El literal `'hermes.token'` vivía copiado en cuatro módulos (cliente, media,
 * stream, envío de adjuntos) además del dueño real de la sesión. Renombrar la
 * clave o cambiar dónde vive el token (p. ej. a sessionStorage) era tocar cinco
 * archivos y rezar. Ahora el literal tiene UN dueño; todo lo demás pregunta acá.
 *
 * Este módulo NO decide quién está logueada — eso es de `features/auth/sesion.ts`.
 * Solo guarda, entrega y borra la credencial.
 */
const CLAVE_TOKEN = 'hermes.token';

/** El token guardado, si hay. Es lo que va en `Authorization: Bearer …`. */
export function tokenGuardado(): string | null {
  return localStorage.getItem(CLAVE_TOKEN);
}

export function guardarToken(token: string): void {
  localStorage.setItem(CLAVE_TOKEN, token);
}

export function borrarToken(): void {
  localStorage.removeItem(CLAVE_TOKEN);
}
