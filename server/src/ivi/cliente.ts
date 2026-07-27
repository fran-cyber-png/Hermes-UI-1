import { randomUUID } from 'node:crypto';
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
// (`ivi-cerebro/rag/api_contrato.py::contrato_hermes`, con 16 tests que lo fijan), así que
// dos campos quedan a propósito PERMISIVOS:
//   - `fuentes`: sabemos que es una lista; la forma de cada ítem se pasa tal cual a la
//     app (no la fijamos acá para no rechazar por error una respuesta buena de Ivi).
//   - `edadDelDato`: la frescura del dato, para mostrar («hace 2 horas»); aceptamos
//     texto o número, y `null` cuando no aplica. `null` es «NO MEDIDO», no «fresco».
// Los tres campos que cargan el peso (`texto`, `tipo`, `groundingOk`) sí son estrictos.
//
// ⚠️ NADA DE `.strict()` ACÁ, y es una decisión: Ivi solo AGREGA campos (`truncada`,
// `degradado`, `modelo`, `costo_usd`, `ms_total` están anunciados). Con `.strict()`, cada
// campo nuevo de Ivi sería un 502 en la cara de la vendedora y los dos repos tendrían que
// coordinar releases. Lo que se ignora es barato; lo que rompe es renombrar.

export const respuestaIviSchema = z.object({
  /** La respuesta de Ivi, ya redactada. */
  texto: z.string(),
  /** Qué clase de respuesta es (ver `TIPO_IVI`). String libre a propósito: un `tipo` nuevo de Ivi no debe romper Hermes. */
  tipo: z.string(),
  /** Las citas del RAG. La forma de cada ítem no se fija acá (ver arriba); se pasa a la app tal cual. */
  fuentes: z.array(z.unknown()),
  /** Si la respuesta está anclada en datos reales. El flag que la app usa para no mostrar humo. */
  groundingOk: z.boolean(),
  /**
   * Las cifras del texto que Ivi NO pudo casar contra los datos. Con `groundingOk: false`,
   * esta lista es la que dice CUÁLES marcar — sin ella la app solo puede desconfiar de todo
   * el párrafo o de nada.
   *
   * ⚠️ ES INFORMATIVO, Y UN CAMPO INFORMATIVO NO PUEDE TUMBAR LA RESPUESTA ENTERA. Estaba con
   * `.optional()`, que acepta AUSENTE pero **no `null`** — más estricto que el emisor, al revés
   * de la laxitud deliberada del resto del schema. `.nullish()` cubre las dos formas de decir
   * «no lo reportó» (`null` es la que este contrato ya usa en `edad_del_dato`), y `.catch()`
   * cubre la tercera: una forma inesperada degrada a «no reportado» en vez de convertir una
   * respuesta buena en un 502.
   *
   * Medido contra ivi-cerebro@1e5d2f3 (y su árbol de trabajo, idénticos en este archivo):
   * `contrato_hermes()` emite `r.get("numeros_no_verificados", [])` y `_no_verificados()`
   * devuelve siempre `list[str]`, así que HOY no llega `null`. Pero el propio `gimnasio.py:106`
   * de Ivi escribe `r.get("numeros_no_verificados") or []`: el emisor ya se defiende de un
   * `None` que considera posible, y quien recibe no tiene por qué ser más frágil que quien manda.
   *
   * La dirección de la degradación es la conservadora: sin lista, la app desconfía del párrafo
   * entero. Fail-closed es sobre el TEXTO, no sobre su nota al pie.
   */
  numerosNoVerificados: z
    .array(z.string())
    .optional()
    .catch(({ value }) => {
      // Ruidoso, como todo lo de esta costura: degradar en silencio es cómo se viven meses sin
      // enterarse de que un campo dejó de llegar. El `null` NO pasa por acá —`aCamelCase` ya lo
      // normalizó—, así que este log significa «forma inesperada», que sí hay que mirar.
      console.error('ivi: `numeros_no_verificados` llegó con una forma inesperada; se ignora', value);
      return undefined;
    }),
  /** Frescura del dato para mostrar; `null` cuando no aplica (o no se midió). */
  edadDelDato: z.union([z.string(), z.number()]).nullable(),
});

export type RespuestaIvi = z.infer<typeof respuestaIviSchema>;

/** La respuesta tal como sale de Hermes: la de Ivi más la traza con la que se pidió. */
export interface RespuestaIviConTraza extends RespuestaIvi {
  /** El `traza_id` que Hermes generó para esta pregunta (ver §traza_id, abajo). */
  trazaId: string;
}

/**
 * El vocabulario de `tipo` que Ivi publica hoy. Está acá para que la UI ramifique sin
 * copiar literales sueltos — NO para cerrar el schema: `tipo` sigue siendo string libre y
 * un valor nuevo tiene que caer en la rama conservadora (`CONTEXTO`), nunca en un throw
 * y nunca en `HECHO`.
 *
 *   HECHO         una cifra del SDK `governa.*`, determinista. Se muestra con su fuente.
 *   CONTEXTO      texto de un documento citado. NO es una cifra.
 *   SIN_EVIDENCIA Ivi no sabe. Se MUESTRA, no se esconde ni se reintenta (ver `esReintentable`).
 */
export const TIPO_IVI = {
  HECHO: 'HECHO',
  CONTEXTO: 'CONTEXTO',
  SIN_EVIDENCIA: 'SIN_EVIDENCIA',
} as const;

export type TipoIvi = (typeof TIPO_IVI)[keyof typeof TIPO_IVI];

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
  /**
   * La traza de la pregunta que falló. La pone `preguntarleAIvi` al salir, en UN solo lugar,
   * para que ningún `throw` nuevo se olvide: un 502 sin traza no se puede cruzar con el log
   * de Ivi, que es justamente el momento en que uno quiere cruzarlos.
   */
  trazaId?: string;

  constructor(codigo: CodigoErrorIvi, message: string, estado?: number, causa?: unknown) {
    super(message, causa !== undefined ? { cause: causa } : undefined);
    this.name = 'ErrorIvi';
    this.codigo = codigo;
    this.estado = estado;
  }
}

/**
 * Los estados HTTP que significan «probá de nuevo», cuando el código por sí solo no alcanza.
 *
 * `408` y `429` son el servidor pidiendo explícitamente que se reintente; `>= 500` es que algo
 * se rompió del otro lado y puede estar arreglado en el próximo intento.
 */
function estadoTransitorio(estado: number): boolean {
  return estado >= 500 || estado === 408 || estado === 429;
}

/**
 * Si volver a preguntar lo mismo puede dar otro resultado.
 *
 * Es la mitad que faltaba de la regla que este repo ya tenía escrita («un 404 no es "no hay
 * respuesta clara"»), aplicada del otro lado: **una respuesta 200 NUNCA pasa por acá**, ni
 * siquiera un `SIN_EVIDENCIA` — Ivi funcionó y ya decidió que no sabe; reintentar es pedirle
 * la misma respuesta otra vez y cobrarle el tiempo a la vendedora.
 *
 * ⚠️ EL CÓDIGO SOLO NO ALCANZA, y esto costó un defecto: `HTTP_INESPERADO` es un CAJÓN DE
 * SASTRE con tres vidas distintas adentro —
 *
 *   404      el endpoint todavía no está desplegado (I1 del plan) ............ PERMANENTE
 *   500      el `except Exception` de Ivi (`rag/web.py`): pgvector caído,
 *            Bedrock sin credenciales, un bug de aquel lado ................. TRANSITORIO
 *   502/504  nginx o la tailnet delante de geografo ........................ TRANSITORIO
 *
 * — y marcarlas a las tres `false` le negaba a la vendedora el botón «Reintentar» justo en el
 * caso en que a los 10 s ya funcionaba. El `estado` ya venía en el `ErrorIvi`; solo faltaba
 * mirarlo. El campo se llama `reintentable`: no puede afirmar más de lo que sabe.
 *
 * El orden importa: **el código decide primero y el estado solo desempata el cajón de sastre**.
 * Un `503` es el `ivi_sin_token_configurado` de `autorizar()` —config de geografo, no una
 * caída—, así que ser 5xx no lo vuelve transitorio; por eso ya salió clasificado como
 * `IVI_NO_CONFIGURADO` y no llega hasta acá abajo.
 */
export function esReintentable(codigo: CodigoErrorIvi, estado?: number): boolean {
  if (codigo === CODIGO_ERROR_IVI.TIMEOUT || codigo === CODIGO_ERROR_IVI.RED) return true;
  // Sin estado no se afirma nada: la respuesta conservadora es «no invitar a reintentar».
  if (codigo === CODIGO_ERROR_IVI.HTTP_INESPERADO) return estado !== undefined && estadoTransitorio(estado);
  return false;
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
    numeros_no_verificados: z.unknown(),
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
  const {
    texto,
    tipo,
    fuentes,
    grounding_ok: groundingOk,
    numeros_no_verificados: numerosNoVerificados,
    edad_del_dato: edadDelDato,
  } = r.data;
  return {
    texto,
    tipo,
    fuentes,
    groundingOk,
    // `null` y ausente son EL MISMO HECHO cuando el campo es una lista: «no se reportó». Se
    // normaliza acá, en el borde, porque es una diferencia de DIALECTO —Python manda `None`
    // donde JS no manda nada— y este es el lugar donde el dialecto de Ivi se vuelve el de
    // Hermes. Ojo: `edadDelDato` NO se normaliza, y la asimetría es a propósito — ahí `null`
    // sí significa algo distinto de ausente («no medido», que no es «fresco»).
    numerosNoVerificados: numerosNoVerificados ?? undefined,
    edadDelDato,
  };
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
  /** Fija la traza para que un test pueda afirmar sobre ella; en producción se genera sola. */
  trazaId?: string;
}

/** El presupuesto de tiempo para toda la ida y vuelta (fetch + lectura del body). Fijado por test. */
export const TIMEOUT_MS = 30_000;

/**
 * Qué superficie de Hermes pregunta. Ivi lo usa para el tope de salida (`hermes` = 600 tokens).
 *
 * Hoy no hace nada: su handler HTTP (`rag/web.py`, /api/preguntar) todavía no lo pasa a
 * `responder()`, y sin él queda en el tope de `chat` — que para Hermes es el mismo número. Se
 * manda igual porque el día que lo cableen no hay que tocar nada de este lado, y porque un campo
 * que Ivi no conoce lo ignora (su handler lee del dict, no valida el cuerpo).
 */
const SUPERFICIE = 'hermes';

/**
 * EL `traza_id` — el único hilo que une «qué recomendó Ivi» (en la base de Ivi) con «qué se
 * mandó y qué resultó» (en la de Hermes). Se genera de este lado, en cada pregunta, y viaja
 * en el cuerpo; Ivi lo guarda en su traza y lo propaga al SDK.
 *
 * Va desde el día uno aunque todavía no se vea: es un dato que no se puede reconstruir después
 * —la request ya pasó— y sin él el lazo de aprendizaje no cierra nunca. El prefijo dice de qué
 * lado nació, que es lo primero que uno quiere saber leyendo un log ajeno.
 */
export function nuevaTrazaId(): string {
  return `hermes-${randomUUID()}`;
}

/** La firma del cliente — un solo lugar la define (antes duplicada entre la ruta y su test, #98). */
export type PreguntarAIvi = (
  pregunta: string,
  usuario: string,
  historial?: TurnoHistorial[],
) => Promise<RespuestaIviConTraza>;

/**
 * Le pregunta a Ivi y devuelve una `RespuestaIvi` ya validada, con la traza de la pregunta.
 * Ante cualquier problema LANZA un `ErrorIvi` con su `codigo` — nunca devuelve una respuesta
 * falsa ni un «no encontré datos» inventado.
 *
 * ⚠️ Una respuesta `200` con `tipo: SIN_EVIDENCIA` NO es un fallo: sale por acá, como cualquier
 * otra. Ivi funcionó y decidió que no sabe; eso es un producto —«todavía no sé»— y la app lo
 * muestra. Convertirlo en error haría que la honestidad de Ivi se lea como «Ivi está roto».
 *
 * `usuario` es la vendedora autenticada (el `vendedoraId` del token de Hermes): lo
 * pone el proxy, no viene del body, así no se puede suplantar.
 */
export async function preguntarleAIvi(
  pregunta: string,
  usuario: string,
  historial?: TurnoHistorial[],
  deps: DepsIvi = {},
): Promise<RespuestaIviConTraza> {
  const trazaId = deps.trazaId ?? nuevaTrazaId();
  try {
    return await consultar(trazaId, pregunta, usuario, historial, deps);
  } catch (err) {
    // La traza se pega ACÁ, en un solo lugar: así ningún `throw` futuro se olvida de ponerla.
    if (err instanceof ErrorIvi) err.trazaId ??= trazaId;
    throw err;
  }
}

async function consultar(
  trazaId: string,
  pregunta: string,
  usuario: string,
  historial: TurnoHistorial[] | undefined,
  deps: DepsIvi,
): Promise<RespuestaIviConTraza> {
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
      // `traza_id` y `superficie` van en snake_case porque este es el dialecto de Ivi.
      body: JSON.stringify({
        pregunta,
        usuario,
        superficie: SUPERFICIE,
        traza_id: trazaId,
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
    console.error('ivi: la respuesta no cumple el contrato RespuestaIvi', parseado.error.issues, { trazaId });
    throw new ErrorIvi(
      CODIGO_ERROR_IVI.RESPUESTA_INVALIDA,
      'La respuesta de Ivi no cumple el contrato RespuestaIvi.',
    );
  }
  // Acá NO se ramifica por `tipo`: un SIN_EVIDENCIA sale igual que un HECHO. Quién lo muestra
  // distinto es la UI; quién lo convertiría en error no existe, y esa ausencia es el punto.
  return { ...parseado.data, trazaId };
}
