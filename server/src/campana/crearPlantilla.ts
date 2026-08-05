import { revisar, type Categoria, type PlantillaNueva, type Reparo } from "./nombrePlantilla.js";

/**
 * CREAR UNA PLANTILLA EN META — el flujo completo, con sus tres trampas.
 *
 * ══ POR QUÉ ESTO NO ES UN SOLO POST ═════════════════════════════════════════
 *
 * Con header de imagen son **tres llamadas y dos hosts distintos**, y es donde
 * traba todo el mundo:
 *
 *   1. `POST /{APP_ID}/uploads` — abre una sesión de subida. **Va con el APP
 *      ID, no con el WABA**: es la Resumable Upload API de la plataforma, no
 *      una ruta de WhatsApp. Usar el WABA acá da un 404 desconcertante.
 *   2. `POST /upload:{SESSION}` — sube los bytes. 🔴 **El header es
 *      `Authorization: OAuth <token>`, NO `Bearer`**, y hace falta
 *      `file_offset: 0`. Con `Bearer` responde 401 y parece que el token está
 *      mal, cuando el token está perfecto.
 *   3. `POST /{WABA_ID}/message_templates` — crea la plantilla, con el handle
 *      que devolvió el paso 2 dentro de `example.header_handle`.
 *
 * El handle no es un id corto: es una cadena larguísima (`4::aW…`), y se usa
 * **una sola vez** — es el EJEMPLO que Meta mira al revisar, no la imagen que
 * se manda después. La imagen de cada envío va aparte, por `media_id`.
 *
 * ══ CREAR NO ES MANDAR ══════════════════════════════════════════════════════
 *
 * Registrar una plantilla no le escribe a nadie: queda `PENDING` hasta que Meta
 * la revise (hasta 24 h). Por eso esto puede vivir detrás del mismo permiso de
 * supervisor que el resto, sin la ceremonia que exige un envío.
 *
 * Lo que sí cuesta: **el cupo**. Sin portafolio verificado son 250 plantillas
 * por WABA, y cada idioma cuenta como una. Y hay un techo de 100 creaciones por
 * hora.
 */

const VERSION_GRAPH = "v23.0";
const TIMEOUT_MS = 30_000;

export const CODIGOS_DE_CREACION = [
  "falta_config",
  "reparos",
  "sin_permiso",
  "cupo_lleno",
  "rechazada_al_crear",
  "red",
  "timeout",
  "respuesta_invalida",
  "http_inesperado",
] as const;
export type CodigoDeCreacion = (typeof CODIGOS_DE_CREACION)[number];

export class ErrorAlCrear extends Error {
  constructor(
    readonly codigo: CodigoDeCreacion,
    mensaje: string,
    /** Los reparos mecánicos, cuando el código es `reparos`. */
    readonly reparos: Reparo[] = [],
    readonly causa?: unknown,
  ) {
    super(mensaje);
    this.name = "ErrorAlCrear";
  }
}

export interface Credenciales {
  appId: string;
  wabaId: string;
  token: string;
  fetchImpl?: typeof fetch;
}

function credenciales(c?: Partial<Credenciales>): Credenciales {
  const appId = c?.appId ?? process.env.META_APP_ID;
  const wabaId = c?.wabaId ?? process.env.META_WABA_ID;
  const token = c?.token ?? process.env.META_ACCESS_TOKEN;
  if (!appId || !wabaId || !token) {
    throw new ErrorAlCrear(
      "falta_config",
      "Faltan META_APP_ID, META_WABA_ID o META_ACCESS_TOKEN en el entorno.",
    );
  }
  return { appId, wabaId, token, fetchImpl: c?.fetchImpl };
}

/**
 * PASO 1 y 2 — subir el EJEMPLO de la imagen y devolver su handle.
 *
 * Se llama «ejemplo» a propósito y no «la imagen»: es lo que Meta mira para
 * revisar la plantilla. La imagen real de cada envío viaja por `media_id` en el
 * momento de mandar, y puede ser otra.
 */
export async function subirEjemploDeImagen(
  bytes: Uint8Array,
  nombreArchivo: string,
  mime: string,
  cred?: Partial<Credenciales>,
): Promise<string> {
  const { appId, token, fetchImpl } = credenciales(cred);
  const hacerFetch = fetchImpl ?? fetch;

  // ── 1 · abrir la sesión (con el APP ID, no con el WABA) ──
  const url = new URL(`https://graph.facebook.com/${VERSION_GRAPH}/${appId}/uploads`);
  url.searchParams.set("file_name", nombreArchivo);
  url.searchParams.set("file_length", String(bytes.byteLength));
  url.searchParams.set("file_type", mime);

  const abrir = await pedir(hacerFetch, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const sesion = (abrir as { id?: string }).id;
  if (!sesion) throw new ErrorAlCrear("respuesta_invalida", "Meta no devolvió la sesión de subida.");

  // ── 2 · subir los bytes ──
  // 🔴 `OAuth`, no `Bearer`. Es la diferencia entre que ande y un 401 que hace
  // perder una tarde revisando un token que está bien.
  const subir = await pedir(hacerFetch, new URL(`https://graph.facebook.com/${VERSION_GRAPH}/${sesion}`), {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
    /**
     * Los bytes crudos. Se copia a un `ArrayBuffer` propio en vez de castear:
     * `Uint8Array` puede ser una VISTA sobre un buffer más grande (un `subarray`
     * de un archivo leído entero), y pasar el buffer subyacente mandaría de más
     * — el archivo entero en vez del recorte. `slice()` copia sólo lo que es.
     */
    body: bytes.slice().buffer,
  });
  const handle = (subir as { h?: string }).h;
  if (!handle) throw new ErrorAlCrear("respuesta_invalida", "Meta no devolvió el handle del archivo.");
  return handle;
}

export interface ResultadoCreacion {
  id: string;
  /** Casi siempre `PENDING`: Meta revisa en hasta 24 h. */
  estado: string;
  categoria: string | null;
}

/**
 * PASO 3 — crear la plantilla.
 *
 * Los reparos mecánicos se revisan ANTES de salir a la red: el ciclo con Meta
 * es de 24 h, y enterarse mañana de que había una mayúscula en el nombre es el
 * peor lazo posible para algo que se corrige en dos segundos.
 */
export async function crearPlantilla(
  p: PlantillaNueva & { headerImagenHandle?: string | null; botones?: { texto: string; url?: string }[] },
  cred?: Partial<Credenciales>,
): Promise<ResultadoCreacion> {
  const reparos = revisar(p);
  if (reparos.length > 0) {
    throw new ErrorAlCrear("reparos", "La plantilla tiene cosas que Meta va a rechazar.", reparos);
  }

  const { wabaId, token, fetchImpl } = credenciales(cred);
  const hacerFetch = fetchImpl ?? fetch;

  const componentes: Record<string, unknown>[] = [];
  if (p.headerImagenHandle) {
    componentes.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [p.headerImagenHandle] } });
  } else if (p.headerTexto?.trim()) {
    componentes.push({ type: "HEADER", format: "TEXT", text: p.headerTexto.trim() });
  }

  const cuerpo: Record<string, unknown> = { type: "BODY", text: p.cuerpo.trim() };
  /**
   * ⚠️ Si el cuerpo tiene variables, Meta EXIGE un ejemplo de cada una. Sin eso
   * rechaza sin decir claramente por qué. Se rellena con un valor genérico
   * porque el ejemplo es sólo para la revisión — al mandar se resuelve de verdad.
   */
  const vars = [...p.cuerpo.matchAll(/\{\{(\d+)\}\}/g)];
  if (vars.length > 0) {
    cuerpo.example = { body_text: [vars.map((_, i) => `ejemplo${i + 1}`)] };
  }
  componentes.push(cuerpo);

  if (p.pie?.trim()) componentes.push({ type: "FOOTER", text: p.pie.trim() });

  if (p.botones?.length) {
    componentes.push({
      type: "BUTTONS",
      buttons: p.botones.map((b) =>
        b.url ? { type: "URL", text: b.texto, url: b.url } : { type: "QUICK_REPLY", text: b.texto },
      ),
    });
  }

  const cuerpoDeLaRequest = {
    name: p.nombre,
    language: p.idioma,
    category: p.categoria as Categoria,
    components: componentes,
  };

  const data = await pedir(
    hacerFetch,
    new URL(`https://graph.facebook.com/${VERSION_GRAPH}/${wabaId}/message_templates`),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(cuerpoDeLaRequest),
    },
  );

  const id = (data as { id?: string }).id;
  if (!id) throw new ErrorAlCrear("respuesta_invalida", "Meta no devolvió el id de la plantilla.");
  return {
    id,
    estado: (data as { status?: string }).status ?? "PENDING",
    categoria: (data as { category?: string }).category ?? null,
  };
}

/** Una request a Meta con los errores traducidos a algo accionable. */
async function pedir(
  hacerFetch: typeof fetch,
  url: URL,
  init: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await hacerFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const esTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ErrorAlCrear(esTimeout ? "timeout" : "red", "No se pudo hablar con Meta.", [], e);
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await res.json();
  } catch {
    // Un cuerpo ilegible con estado ok es igual de sospechoso; se cae abajo.
  }

  if (res.ok) {
    if (cuerpo === null) throw new ErrorAlCrear("respuesta_invalida", "Meta respondió algo que no es JSON.");
    return cuerpo;
  }

  const err = (cuerpo as { error?: { code?: number; message?: string; error_user_msg?: string } })?.error;
  const codigo = err?.code;
  const mensaje = err?.error_user_msg ?? err?.message ?? `Meta respondió ${res.status}.`;

  /**
   * LOS CÓDIGOS QUE PIDEN ACCIONES DISTINTAS.
   *
   * `2388019` (cupo lleno) no es un error de la plantilla: es de la cuenta, y
   * la salida es borrar plantillas viejas o verificar el portafolio. Mezclarlo
   * con «tu texto está mal» manda a corregir lo que no falla.
   */
  if (codigo === 2388019) throw new ErrorAlCrear("cupo_lleno", mensaje);
  if (res.status === 401 || res.status === 403 || codigo === 190 || codigo === 200) {
    throw new ErrorAlCrear("sin_permiso", `${mensaje} (el token necesita whatsapp_business_management)`);
  }
  // La familia 2388xxx son reparos de la plantilla misma.
  if (typeof codigo === "number" && codigo >= 2388000 && codigo < 2389000) {
    throw new ErrorAlCrear("rechazada_al_crear", mensaje);
  }
  throw new ErrorAlCrear("http_inesperado", mensaje);
}
