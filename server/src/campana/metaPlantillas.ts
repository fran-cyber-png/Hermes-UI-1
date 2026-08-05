import { leerCalidad, leerEstado, sePuedeMandar, type PlantillaDeMeta } from "./estadoDePlantilla.js";
import type { PlantillaAprobada } from "./plantillasAprobadas.js";

/**
 * EL CATÁLOGO DE PLANTILLAS SE LE PREGUNTA A META, QUE ES QUIEN LO SABE.
 *
 * ══ POR QUÉ ESTO REEMPLAZA A LA CONSTANTE ═══════════════════════════════════
 *
 * `plantillasAprobadas.ts` tiene el cuerpo de UNA plantilla, compilado. La
 * consecuencia se vio el 5-ago-2026: se aprobó `foro_estado_5_ago` en el
 * Business Manager y **Hermes no la podía mandar** —
 * `plantillaPorNombre()` devolvía `null` y el script salía—, así que registrar
 * una plantilla nueva costaba un deploy. Con una campaña por semana, eso
 * significa que la herramienta no sirve.
 *
 * Meta es la fuente de verdad: aprueba el texto, lo versiona, lo pausa y lo
 * deshabilita. Preguntárselo es además lo único que puede responder «¿esta
 * plantilla sigue estando aprobada?», que es la pregunta que hay que hacerse
 * **antes de cada campaña** y que una constante no puede contestar jamás.
 *
 * ══ LA COPIA LOCAL NO DESAPARECE, CAMBIA DE PAPEL ═══════════════════════════
 *
 * Sigue haciendo falta el cuerpo para auditar (`envios_wa.texto`), proyectar
 * (que la vendedora lea lo que salió) y **versionar** (el sha del contenido
 * autoral, ADR 0022). Lo que cambia es de dónde sale: antes era la fuente y
 * ahora es lo que Meta acaba de decir. Por eso `PLANTILLAS_APROBADAS` queda
 * como **respaldo** —si Meta no responde, una campaña ya planificada no debería
 * caerse— y nunca como la verdad.
 *
 * ══ FAIL-CLOSED, Y LA DIFERENCIA CON EL CATÁLOGO DE PIEZAS ══════════════════
 *
 * Si no se puede preguntar, **no se manda**: se lanza. Es la misma cicatriz de
 * ADR 0023 (una lista vacía es una mentira para quien la consume), pero acá el
 * consumidor no es un índice sino un envío a mil personas — y el modo de fallo
 * de "seguir con la copia vieja" es mandar con una plantilla que Meta pausó
 * hace dos horas, o sea un `132015` por cada destinatario y la calidad del
 * número por el piso.
 */

export const CODIGOS_DE_ERROR = [
  "falta_config",
  "sin_permiso",
  "red",
  "timeout",
  "respuesta_invalida",
  "http_inesperado",
] as const;
export type CodigoDeError = (typeof CODIGOS_DE_ERROR)[number];

export class ErrorDeMeta extends Error {
  constructor(
    readonly codigo: CodigoDeError,
    mensaje: string,
    readonly causa?: unknown,
  ) {
    super(mensaje);
    this.name = "ErrorDeMeta";
  }
}

/** Una plantilla como la ve Hermes: lo de Meta + la lectura en criollo. */
export interface PlantillaConEstado {
  nombre: string;
  idioma: string;
  estado: string;
  categoria: string | null;
  /** El cuerpo, extraído del componente BODY. `null` si Meta no lo mandó. */
  cuerpo: string | null;
  /** ¿El header pide una imagen en cada envío? */
  headerDeImagen: boolean;
  enviable: boolean;
  lectura: ReturnType<typeof leerEstado>;
  calidad: ReturnType<typeof leerCalidad>;
  id: string | null;
}

const TIMEOUT_MS = 15_000;
const VERSION_GRAPH = "v23.0";

/**
 * ⚠️ LA VERSIÓN DE LA GRAPH API SE FIJA, NO SE DEJA SIN VERSIONAR.
 *
 * Meta rompe endpoints por versión —el 29-jul-2026 bloqueó 47 de golpe— y una
 * URL sin versión sigue a la última, o sea que un martes cualquiera la campaña
 * deja de andar sin que nadie haya tocado el repo.
 */
export async function traerPlantillasDeMeta(opciones?: {
  wabaId?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<PlantillaConEstado[]> {
  const wabaId = opciones?.wabaId ?? process.env.META_WABA_ID;
  const token = opciones?.token ?? process.env.META_ACCESS_TOKEN;
  if (!wabaId || !token) {
    throw new ErrorDeMeta(
      "falta_config",
      "Falta META_WABA_ID o META_ACCESS_TOKEN: no se puede preguntar por las plantillas.",
    );
  }

  const url = new URL(`https://graph.facebook.com/${VERSION_GRAPH}/${wabaId}/message_templates`);
  url.searchParams.set(
    "fields",
    "id,name,language,status,category,quality_score,rejected_reason,components",
  );
  url.searchParams.set("limit", "100");

  const hacerFetch = opciones?.fetchImpl ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await hacerFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const esTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ErrorDeMeta(esTimeout ? "timeout" : "red", "No se pudo preguntarle a Meta.", e);
  }

  if (!respuesta.ok) {
    // 190 (token vencido) y 200/10 (sin permiso) se distinguen porque piden
    // acciones distintas: renovar el token vs. agregarle un scope.
    const codigo = respuesta.status === 401 || respuesta.status === 403 ? "sin_permiso" : "http_inesperado";
    throw new ErrorDeMeta(codigo, `Meta respondió ${respuesta.status} al pedir las plantillas.`);
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch (e) {
    throw new ErrorDeMeta("respuesta_invalida", "Meta respondió algo que no es JSON.", e);
  }

  const data = (cuerpo as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new ErrorDeMeta("respuesta_invalida", "La respuesta de Meta no trae `data`.");
  }

  return data.map((p) => interpretar(p as PlantillaDeMeta));
}

/** Traduce una fila de Meta a lo que Hermes necesita. Puro y con test. */
export function interpretar(p: PlantillaDeMeta): PlantillaConEstado {
  return {
    nombre: p.name ?? "(sin nombre)",
    idioma: p.language ?? "",
    estado: p.status ?? "(sin estado)",
    categoria: p.category ?? null,
    cuerpo: cuerpoDe(p),
    headerDeImagen: tieneHeaderDeImagen(p),
    enviable: sePuedeMandar(p),
    lectura: leerEstado(p),
    calidad: leerCalidad(p),
    id: p.id ?? null,
  };
}

/**
 * EL CUERPO SALE DEL COMPONENTE `BODY`.
 *
 * ⚠️ Meta manda `type` en MAYÚSCULAS al leer (`"BODY"`) y lo acepta en
 * minúsculas al crear. Comparar sensible a mayúsculas devuelve `null` para
 * todas las plantillas, y `null` acá significa «no se puede versionar» — o sea
 * que el lazo de resultados perdería la pieza entera, en silencio.
 */
export function cuerpoDe(p: PlantillaDeMeta): string | null {
  if (!Array.isArray(p.components)) return null;
  for (const c of p.components) {
    if (typeof c !== "object" || c === null) continue;
    const comp = c as { type?: unknown; text?: unknown };
    if (String(comp.type ?? "").toUpperCase() !== "BODY") continue;
    return typeof comp.text === "string" ? comp.text : null;
  }
  return null;
}

/** ¿El header pide una imagen? Sin esto, el envío falla con `132012`. */
export function tieneHeaderDeImagen(p: PlantillaDeMeta): boolean {
  if (!Array.isArray(p.components)) return false;
  return p.components.some((c) => {
    if (typeof c !== "object" || c === null) return false;
    const comp = c as { type?: unknown; format?: unknown };
    return (
      String(comp.type ?? "").toUpperCase() === "HEADER" &&
      String(comp.format ?? "").toUpperCase() === "IMAGE"
    );
  });
}

/**
 * LA FORMA QUE EL ENVÍO YA SABE USAR.
 *
 * Devuelve `null` cuando la plantilla no se puede mandar o cuando Meta no dio
 * el cuerpo: **sin cuerpo no hay versión**, y sin versión el envío quedaría
 * fuera del lazo de resultados sin que nadie se entere.
 */
export function comoPlantillaAprobada(p: PlantillaConEstado): PlantillaAprobada | null {
  if (!p.enviable || p.cuerpo === null) return null;
  return {
    nombre: p.nombre,
    idioma: p.idioma,
    cuerpo: p.cuerpo,
    headerDeImagen: p.headerDeImagen,
  };
}
