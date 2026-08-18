import { firmarSesion } from './sesion.js';
import { vendedoraIdDeCenturion, verificarTokenCenturion } from './centurion.js';

/**
 * EL CANJE: de un token de Centurión a una sesión de Hermes.
 *
 * Es UNA sola función porque es UNA sola frontera, y hay DOS puertas que llegan
 * hasta acá:
 *
 *   POST /api/auth/centurion  el candidato viene redirigido con el token ya firmado
 *   POST /api/auth/login      el candidato escribió usuario y clave, y Hermes
 *                             fue a buscar ese mismo token a Centurión
 *
 * Copiar los cuatro pasos en la segunda puerta era el defecto #37 esperando: el
 * día que se endurezca la guarda de línea —o se agregue una segunda— habría que
 * acordarse de las dos, y la que quedara vieja sería la que deja entrar. Acá el
 * namespacing y el gate de línea salen gratis para cualquier puerta nueva.
 *
 * 🔴 **SIN LÍNEA ASIGNADA SE RECHAZA, y esa regla vive acá adentro.** El porqué
 * está escrito en `routes/auth.ts` sobre `/centurion`: una identidad de Centurión
 * es una persona AJENA al negocio de la Escuela, el catálogo de subservicios de
 * Centurión es compartido entre candidaturas, y `cola/lineas.ts` es fail-open —
 * o sea que sin este candado la primera de esas personas que entre sin línea ve
 * la cola entera de la Escuela. Fail-open para el personal interno de Cerberus,
 * fail-closed para el de afuera.
 */

/**
 * De dónde salen las líneas de esta persona. Es una función y no el `db`
 * a propósito: así este módulo —que decide quién entra— no importa el singleton
 * de la base y se puede probar entero sin `DATABASE_URL`. Producción le pasa
 * `lineasDeVendedora(db, ...)`, el dueño único de `numero_vendedora`.
 */
export type BuscarLineas = (vendedoraId: string) => Promise<string[]>;

/**
 * El mensaje del 403, en UN solo lugar: lo dicen las dos puertas y tiene que
 * decir lo mismo — es la única pista que recibe alguien que puso bien la clave
 * y aun así no entra.
 */
export const MENSAJE_SIN_LINEA =
  'todavía no tenés una línea de WhatsApp asignada en Hermes — avisá a soporte';

export type ResultadoCanje =
  | { ok: true; token: string; vendedora: { id: string; nombre: string } }
  /** El token no verifica: firma, vencimiento, audiencia o forma. No se distingue cuál. */
  | { ok: false; motivo: 'token_invalido' }
  /** Verificó, pero esta persona no tiene línea asignada en Hermes. */
  | { ok: false; motivo: 'sin_linea_asignada' };

export async function canjearTokenDeCenturion(
  token: string,
  buscarLineas: BuscarLineas,
): Promise<ResultadoCanje> {
  const identidad = verificarTokenCenturion(token);
  if (!identidad) return { ok: false, motivo: 'token_invalido' };

  const vendedoraId = vendedoraIdDeCenturion(identidad.usuario);
  const lineas = await buscarLineas(vendedoraId);
  if (lineas.length === 0) {
    /**
     * 🔴 EL RECHAZO DICE A QUIÉN, y sin esto el alta era a ciegas.
     *
     * El alta de un agente digital son dos pasos en dos sistemas, y el que falla
     * en silencio es el segundo: la fila de `numero_vendedora` se escribe con la
     * identidad que **Centurión** manda en el `sub`, no con la que uno supuso. Un
     * `angie` contra un `angie.torres` no da error en ninguna parte: da que esa
     * persona **nunca entra**, y del lado de Hermes no había nada que mirar.
     *
     * Se loguea la identidad ya resuelta —nunca el token, que es una credencial—,
     * así el alta se corrige mirando el log en vez de adivinando.
     */
    console.warn(
      `[centurión] «${vendedoraId}» entró bien pero no tiene línea asignada: 403. ` +
        `Si esperabas que entrara, ése es el id exacto que hay que dar de alta.`,
    );
    return { ok: false, motivo: 'sin_linea_asignada' };
  }

  return {
    ok: true,
    token: firmarSesion(vendedoraId),
    // El nombre es para saludar; si Centurión no lo mandó, el usuario alcanza.
    vendedora: { id: vendedoraId, nombre: identidad.nombre ?? identidad.usuario },
  };
}
