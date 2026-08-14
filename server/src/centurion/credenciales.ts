import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { ssoDeCenturionConfigurado } from '../auth/centurion.js';

/**
 * PREGUNTARLE A CENTURIÓN SI ESTE USUARIO Y ESTA CLAVE SON SUYOS.
 *
 * Es la mitad que le faltaba al SSO. `auth/centurion.ts` ya sabía RECIBIR un
 * token que Centurión firmó (el candidato venía redirigido desde allá); acá el
 * candidato escribe usuario y clave DIRECTO en el formulario de Hermes, y es
 * Hermes el que va a preguntar. Del otro lado vive
 * `POST /svc/hermes/api/credenciales`, que si las credenciales son buenas
 * devuelve EXACTAMENTE el mismo token corto de handoff de siempre — por eso acá
 * no hay una segunda forma de verificar identidad: este módulo consigue el
 * token, y quien lo verifica sigue siendo `verificarTokenCenturion` (#37).
 *
 *   login de Hermes ─▶ resolverLogin() ─▶ consultarCredencialesEnCenturion()
 *                                            │  Authorization: Bearer <JWT de servicio>
 *                                            ▼
 *                                    POST /svc/hermes/api/credenciales
 *                                            │  200 { ok, token }
 *                                            ▼
 *                                    verificarTokenCenturion(token)
 *
 * 🔴 **EL SECRETO NUNCA VIAJA COMO BEARER: SE USA COMO FIRMA.** El Bearer es un
 * JWT HS256 de 60 segundos firmado con `CENTURION_SSO_SECRET`; el secreto en sí
 * no sale nunca de este proceso. Mandarlo como token estático lo dejaría escrito
 * en cada log de acceso, cada proxy y cada captura de red del camino, y encima
 * eterno — un JWT vencido a los 60 s no sirve para nada aunque se filtre. Es el
 * mismo secreto y la misma relación de confianza que ya existe para el handoff,
 * solo que usado en la dirección contraria.
 *
 * 🔴 **LA CONTRASEÑA ES DE PASO.** Entra por parámetro, se serializa una sola
 * vez en el cuerpo del POST y muere ahí: no se guarda, no se cachea, no se
 * loguea y no entra en ningún mensaje de error de este módulo — ni en el camino
 * feliz ni en ninguno de los ocho fallos. `credenciales.test.ts` lo fija
 * revisando TODO lo que este módulo escribe por consola.
 *
 * Sin dependencias nuevas: el JWT se firma con `node:crypto`, igual que
 * `auth/sesion.ts` y `auth/centurion.ts`.
 */

/** Lo que Centurión exige en el `aud` del token de servicio. */
const AUDIENCIA = 'centurion';
/** Quién lo firma. Del otro lado sirve para saber de qué sistema vino. */
const EMISOR = 'hermes';

/**
 * 60 segundos. No es una sesión: es un permiso para hacer ESTA llamada, que
 * ocurre en el mismo instante en que se firma. Cualquier ventana más ancha solo
 * agranda lo que sirve un token robado del log de un proxy.
 */
export const TTL_SERVICIO_S = 60;

/**
 * El presupuesto de tiempo de la ida y vuelta.
 *
 * Más corto que los 30 s de Ivi a propósito: acá hay una persona mirando el
 * formulario de login que YA esperó a que Cerberus contestara (esta consulta
 * pasa recién después de que Cerberus rechaza). El costo de rendirse temprano
 * es un login fallido que se reintenta; el de esperar, un formulario colgado.
 */
export const TIMEOUT_MS = 10_000;

/** El endpoint del otro lado. Fijo: es un contrato entre los dos repos, no config. */
const RUTA = '/svc/hermes/api/credenciales';

export const CODIGO_ERROR_CREDENCIALES = {
  /** Falta `CENTURION_URL` o `CENTURION_SSO_SECRET`: es config de Hermes, ni tocamos la red. */
  FALTA_CONFIG: 'falta_config',
  /** 401 `servicio_no_autorizado`: nuestro JWT de servicio no vale. Config de Hermes, NO de la persona. */
  SERVICIO_NO_AUTORIZADO: 'servicio_no_autorizado',
  /** 401 `credenciales_invalidas`: usuario o clave mal. El ÚNICO fallo que es de la persona. */
  CREDENCIALES_INVALIDAS: 'credenciales_invalidas',
  /** 503: Centurión está arriba pero sin `CENTURION_SSO_SECRET` de aquel lado. */
  SSO_NO_CONFIGURADO: 'sso_no_configurado',
  /** No contestó dentro del presupuesto de tiempo. */
  TIMEOUT: 'timeout',
  /** No se pudo ni conectar. */
  RED: 'red',
  /** Contestó, pero el cuerpo no cumple el contrato. */
  RESPUESTA_INVALIDA: 'respuesta_invalida',
  /** Cualquier otro estado HTTP, incluido un 401 con un `code` que no conocemos. */
  HTTP_INESPERADO: 'http_inesperado',
} as const;

export type CodigoErrorCredenciales =
  (typeof CODIGO_ERROR_CREDENCIALES)[keyof typeof CODIGO_ERROR_CREDENCIALES];

/**
 * El resultado es una UNIÓN, no una excepción, y la diferencia es semántica:
 * «usuario o clave mal» es una **respuesta**, no una falla — es el desenlace más
 * frecuente y esperado de este camino. Meterlo en un `throw` obligaría a quien
 * llama a atrapar para leer el caso normal.
 *
 * El `codigo` viaja igual en los fallos porque quien llama los colapsa todos a
 * un 401 genérico hacia afuera (no se puede enumerar usuarios) y necesita el
 * detalle para el LOG, que es el único lugar donde un operador puede enterarse
 * de que la credencial de servicio se rompió.
 */
export type ResultadoCredenciales =
  | { ok: true; token: string }
  | { ok: false; codigo: CodigoErrorCredenciales; estado?: number };

/** Costuras inyectables para los tests: sin esto lee del env y usa `fetch` global. */
export interface DepsCredenciales {
  fetch?: typeof fetch;
  centurionUrl?: string;
  secreto?: string;
  /** Fija el reloj para poder afirmar sobre `iat`/`exp` del token de servicio. */
  ahoraMs?: number;
}

/**
 * Si el login directo está habilitado en este entorno.
 *
 * Son DOS variables y hacen falta las dos: el secreto (que ya gobierna el
 * handoff, y por eso se pregunta con `ssoDeCenturionConfigurado` en vez de leer
 * la env de nuevo — un solo lector, #37) y la URL. Sin las dos, el login se
 * comporta EXACTAMENTE como antes de este frente: Cerberus y nada más.
 */
export function loginDirectoDeCenturionConfigurado(): boolean {
  return Boolean(process.env.CENTURION_URL) && ssoDeCenturionConfigurado();
}

function base64url(objeto: unknown): string {
  return Buffer.from(JSON.stringify(objeto)).toString('base64url');
}

/**
 * El JWT HS256 con el que Hermes se identifica ANTE Centurión.
 *
 * Es servicio↔servicio: no lleva sujeto ni dice nada de la persona que está
 * entrando —eso va en el cuerpo del POST—, solo afirma «esto lo firmó Hermes,
 * hace un momento».
 */
export function firmarTokenDeServicio(secreto: string, ahoraMs: number = Date.now()): string {
  const iat = Math.floor(ahoraMs / 1000);
  const encabezado = base64url({ alg: 'HS256', typ: 'JWT' });
  const cuerpo = base64url({ aud: AUDIENCIA, iss: EMISOR, iat, exp: iat + TTL_SERVICIO_S });
  const firma = createHmac('sha256', secreto).update(`${encabezado}.${cuerpo}`).digest('base64url');
  return `${encabezado}.${cuerpo}.${firma}`;
}

/**
 * El éxito. `ok: true` es literal a propósito: un `{ ok: false }` con 200 no es
 * un éxito raro, es un contrato roto, y tiene que caer en `respuesta_invalida`
 * en vez de colarse como token vacío.
 */
const respuestaOkSchema = z.object({
  ok: z.literal(true),
  token: z.string().min(1),
});

/**
 * El cuerpo de los errores. Laxo: lo único que se lee es `code`, y si no viene
 * (o viene uno que no conocemos) se decide por el estado HTTP. Nada de
 * `.strict()` — un campo nuevo del otro lado no puede volver ilegible un error
 * que ya sabemos clasificar.
 */
const respuestaErrorSchema = z.object({ code: z.string() }).partial();

/**
 * Le pregunta a Centurión por estas credenciales y devuelve el token corto de
 * handoff. NUNCA devuelve una identidad: eso lo decide `verificarTokenCenturion`
 * sobre el token, que es la única verificación de identidad del frente.
 */
export async function consultarCredencialesEnCenturion(
  usuario: string,
  password: string,
  deps: DepsCredenciales = {},
): Promise<ResultadoCredenciales> {
  const base = deps.centurionUrl ?? process.env.CENTURION_URL;
  const secreto = deps.secreto ?? process.env.CENTURION_SSO_SECRET;
  const hacerFetch = deps.fetch ?? fetch;

  // Fail-closed: sin config no sale ni un byte a la red. Que no exista la
  // llamada es la garantía de que la clave de una vendedora de la Escuela no
  // viaja a otro sistema en un entorno donde este login no está habilitado.
  if (!base || !secreto) {
    return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.FALTA_CONFIG };
  }

  const url = `${base.replace(/\/$/, '')}${RUTA}`;

  let resp: Response;
  try {
    resp = await hacerFetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${firmarTokenDeServicio(secreto, deps.ahoraMs)}`,
      },
      // El único lugar del proceso donde la contraseña se serializa.
      body: JSON.stringify({ usuario, password }),
    });
  } catch (err) {
    // Se loguea el NOMBRE del error, no el error entero ni la petición: el
    // cuerpo con la clave no está en el objeto de error de fetch, pero un log
    // que imprime «lo que pasó» completo es exactamente cómo una credencial
    // termina en un archivo. Con el nombre alcanza para distinguir los dos casos.
    const nombre = err instanceof Error ? err.name : 'desconocido';
    console.error(`centurion: la consulta de credenciales falló (${nombre})`);
    // AbortSignal.timeout lanza 'TimeoutError'; un abort manual, 'AbortError'.
    if (nombre === 'TimeoutError' || nombre === 'AbortError') {
      return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.TIMEOUT };
    }
    return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.RED };
  }

  if (!resp.ok) {
    const crudo = await resp.json().catch(() => null);
    const code = respuestaErrorSchema.safeParse(crudo).data?.code;

    if (resp.status === 401 && code === CODIGO_ERROR_CREDENCIALES.CREDENCIALES_INVALIDAS) {
      // El caso normal. NO se loguea: es la persona escribiendo mal la clave, y
      // un log por cada tecleo mal dado entierra los que sí importan.
      return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.CREDENCIALES_INVALIDAS, estado: 401 };
    }
    if (resp.status === 401 && code === CODIGO_ERROR_CREDENCIALES.SERVICIO_NO_AUTORIZADO) {
      // Config rota de NUESTRO lado: los dos secretos dejaron de coincidir. Se
      // ve igual que una clave mala desde el formulario, así que este log es lo
      // único que separa «Betto se equivocó» de «Betto no puede entrar nunca más».
      console.error('centurion: rechazó el token de servicio (401) — revisá CENTURION_SSO_SECRET en los dos lados');
      return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.SERVICIO_NO_AUTORIZADO, estado: 401 };
    }
    if (resp.status === 503) {
      console.error('centurion: está arriba pero sin SSO configurado (503)');
      return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.SSO_NO_CONFIGURADO, estado: 503 };
    }
    // Incluye el 401 con un `code` que no conocemos: no se adivina cuál de los
    // dos 401 es. Ruidoso, porque no poder clasificar un rechazo es en sí una
    // novedad que alguien tiene que mirar.
    console.error(`centurion: estado inesperado (${resp.status}${code ? `, code=${code}` : ''})`);
    return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.HTTP_INESPERADO, estado: resp.status };
  }

  const crudo = await resp.json().catch(() => null);
  const parseado = respuestaOkSchema.safeParse(crudo);
  if (!parseado.success) {
    // Se loguean los ISSUES de Zod, nunca el cuerpo crudo: un 200 con una forma
    // rara podría ser un proxy devolviendo el eco de la petición, y ahí adentro
    // estaría la contraseña.
    console.error('centurion: la respuesta 200 no cumple el contrato { ok, token }', parseado.error.issues);
    return { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.RESPUESTA_INVALIDA, estado: resp.status };
  }

  return { ok: true, token: parseado.data.token };
}
