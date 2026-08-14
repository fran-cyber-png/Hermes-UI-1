/**
 * DE QUÉ SISTEMA VIENE LA PERSONA QUE ESTÁ ADENTRO.
 *
 * En Hermes conviven dos poblaciones que entran por la MISMA caja de login: las
 * vendedoras de la Escuela, cuya identidad vive en Cerberus, y la gente de
 * campaña con cuenta de Centurión, que en Cerberus **no existe**. El server las
 * distingue con un prefijo en el `vendedora_id` (`vendedoraIdDeCenturion`,
 * `server/src/auth/centurion.ts`) y esa es toda la marca que llega hasta acá.
 *
 * 🔴 **NO ES COSMÉTICA: DECIDE SI SE LE PUEDE PROMETER UNA SESIÓN DE CERBERUS.**
 * Hermes guarda la cookie de Cerberus para poder registrar la venta como esa
 * persona. Una identidad de Centurión no tiene esa cookie y **nunca la va a
 * tener**: no hay usuario que autenticar del otro lado. Tratarla como si le
 * faltara —en vez de como si no le correspondiera— produce exactamente el bucle
 * que el 13-ago-2026 encontró la revisión: `/api/auth/yo` contesta
 * `cerberus: false`, la app monta el aviso «reconectá con Cerberus», su botón
 * vuelve a entrar, y al recargar el aviso está de nuevo. Un banner permanente
 * con un botón que no lo puede apagar nunca.
 *
 * ⚠️ El prefijo está escrito en los dos lados y no se puede importar de uno al
 * otro (son dos builds). El candado es el test de paridad del server,
 * `auth/centurionPrefijo.paridad-front.test.ts`, que lee ESTE archivo.
 */

/** El prefijo con el que el server namespacea una identidad de Centurión. */
export const PREFIJO_CENTURION = 'centurion:';

export function esIdentidadDeCenturion(vendedoraId: string): boolean {
  return vendedoraId.startsWith(PREFIJO_CENTURION);
}

/**
 * Si a esta identidad le corresponde una sesión de Cerberus.
 *
 * Se pregunta en positivo y por la IDENTIDAD, no por el estado: «¿esta persona
 * puede tener cookie de Cerberus?» tiene una sola respuesta y no cambia con el
 * tiempo, mientras que «¿la tiene ahora?» es otra pregunta —la que contesta
 * `/api/auth/yo`— y las dos juntas son las que deciden si hay algo que avisar.
 */
export function tieneSesionDeCerberus(vendedoraId: string): boolean {
  return !esIdentidadDeCenturion(vendedoraId);
}
