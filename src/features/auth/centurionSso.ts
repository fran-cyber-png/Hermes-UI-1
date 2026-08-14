import { ErrorApi } from '../../lib/datos/cliente';

/**
 * LLEGAR A HERMES DESDE CENTURIÓN (el reverso de `notas/porLink.ts`, ADR 0048).
 *
 * Centurión manda al candidato al navegador con `#centurion=<jwt>`. Mismo
 * criterio que el link público de la Libreta: NO es un router (ADR 0002) — se
 * lee **una vez**, al arrancar, y se limpia enseguida. El token es corto (TTL
 * de minutos, del lado de Centurión) pero sigue siendo una credencial: dejarlo
 * en la barra hace que se copie con la URL, quede en el historial y salga en
 * cualquier captura.
 */

/** El JWT que vino en la URL, o `null`. Se LEE UNA VEZ y se limpia. */
export function tokenCenturionDeLaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/^#centurion=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!m) return null;

  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return m[1];
}

/**
 * Cuatro causas, cuatro mensajes — mismo criterio que `Login.tsx: mensajeDeError`:
 * ninguno es el error crudo, y el 503 (esto no está prendido acá) no se
 * confunde con el 401 (el link venció o ya se usó).
 *
 * 🔴 **El 403 `sin_linea_asignada` es el que NO se puede tragar el fallback**, y
 * es el mismo `type` que puede devolver `/login`: el token de Centurión era
 * bueno y lo que falta es una fila en `numero_vendedora`. Con el mensaje
 * genérico —«probá de nuevo, o entrá con usuario y contraseña»— la persona se
 * pasa la tarde probando las dos puertas, que van a fallar las dos por el mismo
 * motivo. El texto sale del server (`MENSAJE_SIN_LINEA`) y no se reescribe acá:
 * las dos puertas tienen que decir lo mismo.
 */
export function mensajeDeErrorCenturion(err: unknown): string {
  if (err instanceof ErrorApi && err.tipo === 'sso_no_configurado') {
    return 'El login de Centurión no está habilitado en este Hermes.';
  }
  if (err instanceof ErrorApi && err.tipo === 'sin_linea_asignada' && err.message) {
    return err.message;
  }
  if (err instanceof ErrorApi && err.status === 401) {
    return 'Ese link de Centurión venció o ya se usó. Volvé a entrar desde Centurión.';
  }
  return 'No pude validar el link de Centurión. Probá de nuevo, o entrá con usuario y contraseña.';
}
