import { z } from 'zod';

/**
 * EL CLIENTE DE IVI — la costura entre Hermes y el cerebro RAG que vive en geografo.
 *
 * La app de la vendedora nunca habla con Ivi directo: pregunta al server de Hermes
 * (`POST /api/ivi/preguntar`, detrás de `requiereVendedora`), y ESTE módulo es el que
 * le pregunta a Ivi con el token de servicio. La vendedora jamás ve el token (regla
 * dura #1) ni la URL tailnet de geografo.
 *
 *   app vendedora ─▶ POST /api/ivi/preguntar ─▶ preguntarleAIvi() ─▶ Ivi geografo
 *      (sesión Hermes)   (requiereVendedora)                          POST /api/preguntar
 *                                                                     Authorization: Bearer IVI_SERVICE_TOKEN
 *
 * REGLA DE ORO — FAIL-CLOSED Y RUIDOSO. Un fallo NUNCA se convierte en «Ivi no
 * encontró datos». Cada clase de problema es un error distinto y distinguible:
 *   - falta config (IVI_URL / IVI_SERVICE_TOKEN)  → problema de Hermes, ni tocamos la red
 *   - 401                                          → el token de servicio no vale (config de Hermes)
 *   - 503                                          → Ivi está arriba pero no configurado
 *   - timeout / red                                → geografo no responde (¿máquina apagada?)
 *   - cuerpo que no cumple el contrato             → respuesta inválida
 * El proxy (`routes/ivi.ts`) traduce cualquiera de estos a un 502 con motivo, sin
 * inventar una respuesta.
 */

// ── El contrato de la respuesta (RespuestaIvi) ──────────────────────────────
//
// Fijado por el issue #61. La fuente de verdad del detalle vive en geografo
// (`ivi-cerebro/docs/puente-hermes-pendiente.md`), que no está en este repo, así que
// dos campos quedan a propósito PERMISIVOS hasta la paridad con ese doc:
//   - `fuentes`: sabemos que es una lista; la forma de cada ítem se pasa tal cual a la
//     app (no la fijamos acá para no rechazar por error una respuesta buena de Ivi).
//   - `edadDelDato`: la frescura del dato, para mostrar («hace 2 horas»); aceptamos
//     texto o número, y `null` cuando no aplica.
// Los tres campos que cargan el peso (`texto`, `tipo`, `groundingOk`) sí son estrictos.

export const respuestaIviSchema = z.object({
  /** La respuesta de Ivi, ya redactada. */
  texto: z.string(),
  /** Qué clase de respuesta es. String libre a propósito: un `tipo` nuevo de Ivi no debe romper Hermes. */
  tipo: z.string(),
  /** Las citas del RAG. La forma de cada ítem no se fija acá (ver arriba); se pasa a la app tal cual. */
  fuentes: z.array(z.unknown()),
  /** Si la respuesta está anclada en datos reales. El flag que la app usa para no mostrar humo. */
  groundingOk: z.boolean(),
  /** Frescura del dato para mostrar; `null` cuando no aplica. */
  edadDelDato: z.union([z.string(), z.number()]).nullable(),
});

export type RespuestaIvi = z.infer<typeof respuestaIviSchema>;

// ── El historial de la conversación (opcional en la pregunta) ───────────────

export const ROL_TURNO = {
  VENDEDORA: 'vendedora',
  IVI: 'ivi',
} as const;

export type RolTurno = (typeof ROL_TURNO)[keyof typeof ROL_TURNO];

// Tope de tamaño (#98): sin esto, Ivi (y su factura de tokens) amplifica lo que
// mande la vendedora. 4000 caracteres es de sobra para un turno de chat real.
const MAX_CARACTERES_TEXTO = 4_000;

export const turnoHistorialSchema = z.object({
  rol: z.enum([ROL_TURNO.VENDEDORA, ROL_TURNO.IVI] as const),
  texto: z.string().max(MAX_CARACTERES_TEXTO),
});

export type TurnoHistorial = z.infer<typeof turnoHistorialSchema>;

// ── Los errores, tipados y distinguibles ────────────────────────────────────

export const CODIGO_ERROR_IVI = {
  /** Falta IVI_URL o IVI_SERVICE_TOKEN en el server: es un problema de Hermes. */
  FALTA_CONFIG: 'falta_config',
  /** 401: Ivi rechazó el token de servicio. También es config de Hermes. */
  CONFIG_HERMES: 'config_hermes',
  /** 503: Ivi está arriba pero no configurado del lado de geografo. */
  IVI_NO_CONFIGURADO: 'ivi_no_configurado',
  /** No respondió dentro del presupuesto de tiempo (30 s). */
  TIMEOUT: 'timeout',
  /** No se pudo ni conectar (¿la máquina de geografo está apagada?). */
  RED: 'red',
  /** Contestó, pero el cuerpo no cumple el contrato RespuestaIvi. */
  RESPUESTA_INVALIDA: 'respuesta_invalida',
  /** Cualquier otro estado HTTP que no esperamos. */
  HTTP_INESPERADO: 'http_inesperado',
  /** Un fallo que no es un `ErrorIvi` (bug, no una clase de problema conocida). */
  DESCONOCIDO: 'desconocido',
} as const;

export type CodigoErrorIvi = (typeof CODIGO_ERROR_IVI)[keyof typeof CODIGO_ERROR_IVI];

/** Un fallo al consultar a Ivi, con su clase (`codigo`) para que el proxy lo traduzca sin adivinar. */
export class ErrorIvi extends Error {
  readonly codigo: CodigoErrorIvi;
  /** El estado HTTP, cuando el fallo vino de una respuesta (401/503/…). */
  readonly estado?: number;

  constructor(codigo: CodigoErrorIvi, message: string, estado?: number, causa?: unknown) {
    super(message, causa !== undefined ? { cause: causa } : undefined);
    this.name = 'ErrorIvi';
    this.codigo = codigo;
    this.estado = estado;
  }
}

// ── Las dos traducciones de la costura ──────────────────────────────────────
//
// El contrato de Ivi es snake_case y está PUBLICADO (ivi-cerebro/docs/integracion-hermes.md,
// fijado por 16 tests de aquel lado). Este cliente lo había adivinado en camelCase, así que
// `safeParse` fallaba SIEMPRE y la ruta devolvía 502 en el 100 % de las llamadas (#141).
//
// Se traduce ACÁ, en el borde, una sola vez. La forma interna de Hermes no cambia: hacia adentro
// seguimos hablando camelCase, y hacia la app el historial sigue siendo {rol, texto}, que es lo
// correcto para un chat. Solo el hilo que cruza a Ivi habla el dialecto de Ivi.

/** La respuesta de Ivi, en snake_case. Laxo a propósito: validar es tarea de `respuestaIviSchema`. */
const respuestaCrudaSchema = z
  .object({
    texto: z.unknown(),
    tipo: z.unknown(),
    fuentes: z.unknown(),
    grounding_ok: z.unknown(),
    edad_del_dato: z.unknown(),
  })
  .partial();

/**
 * Traduce la respuesta snake_case de Ivi a la forma camelCase del contrato interno.
 *
 * Si el cuerpo no es un objeto, lo devuelve tal cual: que falle en `safeParse` con el error real
 * en vez de convertirse acá en un objeto vacío que parece casi válido. Fail-closed también acá.
 */
export function aCamelCase(crudo: unknown): unknown {
  const r = respuestaCrudaSchema.safeParse(crudo);
  if (!r.success) return crudo;
  const { texto, tipo, fuentes, grounding_ok: groundingOk, edad_del_dato: edadDelDato } = r.data;
  return { texto, tipo, fuentes, groundingOk, edadDelDato };
}

/**
 * Empareja los turnos {rol, texto} de la app a los pares {q, a} que Ivi espera.
 *
 * `responder()` de Ivi lee `h["q"]` y `h["a"]` (rag/responder.py:350,356). Mandarle {rol, texto}
 * NO da error: lee cadena vacía y el contexto se pierde EN SILENCIO — el follow-up corto
 * («¿y en México?») queda sin antecedente y la respuesta sale plausible y descolgada (#142).
 *
 * Casos reales que el emparejado tiene que aguantar:
 *   - vendedora -> ivi                 un par completo
 *   - vendedora sin respuesta todavía  {q, a: ''}
 *   - dos de vendedora seguidas        dos pares (mandó dos mensajes)
 *   - un `ivi` sin pregunta previa     se descarta: no hay a qué colgarlo
 *
 * Ivi solo usa los últimos 3 turnos, pero el recorte lo hace él: acá se manda lo que llegó,
 * ya acotado por el tope del router (MAX_TURNOS_HISTORIAL).
 */
export function aParesQA(historial: TurnoHistorial[]): { q: string; a: string }[] {
  const pares: { q: string; a: string }[] = [];
  for (const turno of historial) {
    if (turno.rol === ROL_TURNO.VENDEDORA) {
      pares.push({ q: turno.texto, a: '' });
      continue;
    }
    // Un turno de Ivi completa el último par que todavía no tiene respuesta.
    const ultimo = pares[pares.length - 1];
    if (ultimo && ultimo.a === '') ultimo.a = turno.texto;
  }
  return pares;
}

// ── El cliente ──────────────────────────────────────────────────────────────

/** Costuras inyectables para los tests: sin esto lee del env y usa `fetch` global. */
export interface DepsIvi {
  fetch?: typeof fetch;
  iviUrl?: string;
  token?: string;
}

/** El presupuesto de tiempo para toda la ida y vuelta (fetch + lectura del body). Fijado por test. */
export const TIMEOUT_MS = 30_000;

/** La firma del cliente — un solo lugar la define (antes duplicada entre la ruta y su test, #98). */
export type PreguntarAIvi = (
  pregunta: string,
  usuario: string,
  historial?: TurnoHistorial[],
) => Promise<RespuestaIvi>;

/**
 * Le pregunta a Ivi y devuelve una `RespuestaIvi` ya validada. Ante cualquier
 * problema LANZA un `ErrorIvi` con su `codigo` — nunca devuelve una respuesta falsa
 * ni un «no encontré datos» inventado.
 *
 * `usuario` es la vendedora autenticada (el `vendedoraId` del token de Hermes): lo
 * pone el proxy, no viene del body, así no se puede suplantar.
 */
export async function preguntarleAIvi(
  pregunta: string,
  usuario: string,
  historial?: TurnoHistorial[],
  deps: DepsIvi = {},
): Promise<RespuestaIvi> {
  const iviUrl = deps.iviUrl ?? process.env.IVI_URL;
  const token = deps.token ?? process.env.IVI_SERVICE_TOKEN;
  const hacerFetch = deps.fetch ?? fetch;

  // Fail-closed: sin config no tocamos la red. Es un error de Hermes, no de Ivi.
  if (!iviUrl || !token) {
    throw new ErrorIvi(
      CODIGO_ERROR_IVI.FALTA_CONFIG,
      'Ivi no está configurado en Hermes: faltan IVI_URL o IVI_SERVICE_TOKEN en el server.',
    );
  }

  const url = `${iviUrl.replace(/\/$/, '')}/api/preguntar`;

  let resp: Response;
  try {
    resp = await hacerFetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      // El historial viaja como [{q, a}]: es lo que `responder()` de Ivi lee (#142).
      body: JSON.stringify({
        pregunta,
        usuario,
        ...(historial?.length ? { historial: aParesQA(historial) } : {}),
      }),
    });
  } catch (err) {
    console.error('ivi: fetch falló', err);
    // AbortSignal.timeout lanza un DOMException 'TimeoutError'; un abort manual, 'AbortError'.
    const nombre = err instanceof Error ? err.name : '';
    if (nombre === 'TimeoutError' || nombre === 'AbortError') {
      throw new ErrorIvi(CODIGO_ERROR_IVI.TIMEOUT, `Ivi no respondió a tiempo (${TIMEOUT_MS / 1000} s).`, undefined, err);
    }
    throw new ErrorIvi(
      CODIGO_ERROR_IVI.RED,
      'No se pudo conectar con Ivi (¿la máquina de geografo está apagada?).',
      undefined,
      err,
    );
  }

  if (!resp.ok) {
    if (resp.status === 401) {
      throw new ErrorIvi(
        CODIGO_ERROR_IVI.CONFIG_HERMES,
        'Ivi rechazó el token de servicio (401): revisá IVI_SERVICE_TOKEN en el server de Hermes.',
        401,
      );
    }
    if (resp.status === 503) {
      throw new ErrorIvi(
        CODIGO_ERROR_IVI.IVI_NO_CONFIGURADO,
        'Ivi está arriba pero no configurado (503).',
        503,
      );
    }
    throw new ErrorIvi(
      CODIGO_ERROR_IVI.HTTP_INESPERADO,
      `Ivi respondió con un estado inesperado (${resp.status}).`,
      resp.status,
    );
  }

  let crudo: unknown;
  try {
    crudo = await resp.json();
  } catch (err) {
    // El MISMO AbortSignal sigue armado mientras se lee el body: si el presupuesto de
    // tiempo se agota justo acá, es un TIMEOUT — no una respuesta con JSON roto.
    const nombre = err instanceof Error ? err.name : '';
    if (nombre === 'TimeoutError' || nombre === 'AbortError') {
      throw new ErrorIvi(CODIGO_ERROR_IVI.TIMEOUT, `Ivi no respondió a tiempo (${TIMEOUT_MS / 1000} s).`, undefined, err);
    }
    console.error('ivi: el cuerpo de la respuesta no es JSON', err);
    throw new ErrorIvi(CODIGO_ERROR_IVI.RESPUESTA_INVALIDA, 'Ivi respondió con un cuerpo que no es JSON.', undefined, err);
  }

  const parseado = respuestaIviSchema.safeParse(aCamelCase(crudo));
  if (!parseado.success) {
    console.error('ivi: la respuesta no cumple el contrato RespuestaIvi', parseado.error.issues);
    throw new ErrorIvi(
      CODIGO_ERROR_IVI.RESPUESTA_INVALIDA,
      'La respuesta de Ivi no cumple el contrato RespuestaIvi.',
    );
  }
  return parseado.data;
}
