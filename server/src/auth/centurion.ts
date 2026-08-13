import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LA PUERTA DE ENTRADA DE CENTURIÓN — verificar el token corto que Centurión
 * firma para que un candidato entre a Hermes con SU MISMA cuenta.
 *
 * Es el reverso exacto de `service-token.ts` del lado de Centurión (el
 * mecanismo servicio↔servicio que ya existe ahí para `svc/mensajeria`): acá el
 * sujeto es una PERSONA, no una candidatura, y el secreto es OTRO
 * (`CENTURION_SSO_SECRET`) — nunca el `JWT_SECRET` del core de Centurión, que
 * firma todo lo demás de ese sistema. Compartir ese secreto acá le daría a
 * Hermes la llave para falsificar cualquier sesión de Centurión, no solo esta.
 *
 * JWT HS256 a mano, sin dependencia nueva — mismo criterio que `auth/sesion.ts`
 * (HMAC de `node:crypto`, cero paquetes): Hermes solo VERIFICA, nunca firma
 * este token, así que no hace falta un encoder, solo el decoder + la firma.
 */

const AUDIENCIA = 'hermes';

/**
 * Leído en cada llamada, no cacheado a nivel de módulo: así un test puede
 * prender/apagar el SSO seteando la env sin depender del orden de imports (un
 * `const` capturado al cargar el módulo no se puede des-decidir después).
 */
function secreto(): string | undefined {
  return process.env.CENTURION_SSO_SECRET;
}

export interface IdentidadCenturion {
  /** El usuario de Centurión (`auth.usuario`), namespaced al guardarlo en Hermes. */
  usuario: string;
  nombre: string | null;
  /** `fase_1.candidatura.id` del lado de Centurión. Hoy es solo informativo. */
  candidatura: number | null;
}

function base64UrlAJson(parte: string): unknown {
  const texto = Buffer.from(parte, 'base64url').toString('utf8');
  return JSON.parse(texto);
}

/**
 * `null` si el SSO no está configurado en este entorno — a propósito, para que
 * la ruta pueda distinguir "no está prendido acá" (503) de "el token no sirve"
 * (401). Sin `CENTURION_SSO_SECRET` esto NUNCA valida nada, ni por accidente.
 */
export function ssoDeCenturionConfigurado(): boolean {
  return Boolean(secreto());
}

/**
 * Verifica el JWT. Devuelve la identidad si es válido, o `null` — por
 * cualquier motivo: firma, vencimiento, audiencia o forma. No distingue el
 * motivo hacia afuera: un atacante no necesita saber CUÁL de las cuatro cosas
 * falló.
 */
export function verificarTokenCenturion(token: string): IdentidadCenturion | null {
  const SECRET = secreto();
  if (!SECRET) return null;

  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [encabezado, cuerpo, firma] = partes;

  let header: unknown;
  let payload: Record<string, unknown>;
  try {
    header = base64UrlAJson(encabezado);
    payload = base64UrlAJson(cuerpo) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof header !== 'object' || header === null || (header as { alg?: string }).alg !== 'HS256') return null;

  const esperada = createHmac('sha256', SECRET).update(`${encabezado}.${cuerpo}`).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (payload.aud !== AUDIENCIA) return null;
  const exp = payload.exp;
  if (typeof exp !== 'number' || exp * 1000 < Date.now()) return null;

  const usuario = payload.sub;
  if (typeof usuario !== 'string' || !usuario) return null;

  const nombre = typeof payload.nombre === 'string' ? payload.nombre : null;
  const candidatura = typeof payload.candidatura === 'number' ? payload.candidatura : null;
  return { usuario, nombre, candidatura };
}

/**
 * El `vendedoraId` con el que esta identidad vive en Hermes. Namespaced: nunca
 * puede chocar con un username de Cerberus, que es lo que hoy es todo `numero_
 * vendedora`/`sesiones_cerberus` (#37 — dos formas de nombrar a la misma
 * persona no se pueden desincronizar si una tiene un prefijo que la otra no
 * usa jamás).
 */
export function vendedoraIdDeCenturion(usuario: string): string {
  return `centurion:${usuario}`;
}
