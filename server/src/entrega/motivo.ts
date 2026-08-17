/**
 * POR QUÉ NO SE ENTREGÓ — el motivo que Meta manda y que hasta hoy se tiraba.
 *
 * ── Lo que se rompe sin esto ─────────────────────────────────────────────
 * El triángulo rojo de la burbuja era MUDO por construcción. `webhook/whatsapp.ts`
 * leía `st.status`, `st.id` y `st.timestamp` del recibo de la Cloud API y **nunca
 * `st.errors`**, que es donde viaja el código y el texto del rechazo. Consecuencia
 * medida el 17-ago-2026: dos seguimientos de Luz se cayeron el 16-ago 15:39, la
 * columna `motivo` estaba vacía en las dos filas y no había una sola línea en
 * `journalctl`. La vendedora veía un triángulo, concluía «no se mandó» y no tenía
 * cómo saber que el mensaje había salido y que WhatsApp lo había rechazado.
 *
 * ── El caso que lo motivó, y el que va a ser mayoritario ─────────────────
 * Los dos fallos eran la **ventana de 24 h** (`131047`): 28,3 h y 24,5 h desde el
 * último entrante — el segundo se pasó **por media hora**. Es el único fallo de
 * entrega que aparece en envíos manuales, porque hoy Hermes manda por una sola
 * línea y es la Cloud API, donde el plazo es duro. Ver `cola/ventana.ts`.
 *
 * ── ESTE MÓDULO NO NOMBRA NINGÚN CÓDIGO, A PROPÓSITO ─────────────────────
 * Acá solo se EXTRAE lo que Meta dijo; cómo se lee en castellano vive en el front
 * (`src/features/whatsapp/motivoEntrega.ts`), que es quien lo dibuja. Poner un
 * diccionario de códigos también acá sería la misma cabeza en dos lados (#37), y
 * la que divergiría es la que nadie mira. Lo que se guarda es el **código**, que
 * es identidad y no prosa: mañana se puede cambiar la redacción sin re-escribir
 * las filas, y una fila vieja se sigue leyendo con el vocabulario nuevo.
 *
 * ⚠️ **`detalle` es prosa de Meta, en inglés, y no se le muestra crudo a la
 * vendedora.** Se guarda para AUDITAR: es lo único que permite entender un código
 * que todavía no está en el diccionario del front.
 */

/** El techo del texto que guardamos. El mismo criterio que `transporteCloudApi.ts`. */
const TOPE_DETALLE = 300;

export interface MotivoDeEntrega {
  /**
   * El código de Meta, como TEXTO (`'131047'`). `null` si el recibo no lo trajo.
   *
   * Texto y no número porque es un identificador, no una cantidad: nadie lo suma
   * ni lo ordena, y la columna que lo guarda ya es `text`.
   */
  codigo: string | null;
  /** Lo que Meta escribió, recortado. Para auditar, nunca para la pantalla. */
  detalle: string | null;
}

function textoNoVacio(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpio = v.trim();
  return limpio.length > 0 ? limpio.slice(0, TOPE_DETALLE) : null;
}

/**
 * ── CLOUD API ──
 * `value.statuses[].errors[] = { code, title, message?, error_data?: { details? } }`.
 *
 * Se lee **el primero**: un `failed` trae un error, y si Meta mandara varios el
 * primero es el que explica el rechazo (los demás son contexto). Guardar todos
 * costaría una tabla para un caso que no existe.
 *
 * El detalle se toma por especificidad: `error_data.details` › `message` › `title`.
 * ⚠️ `details` es el que dice la frase útil («more than 24 hours have passed…»);
 * `title` suele ser una etiqueta corta y ambigua («Re-engagement message»).
 *
 * Devuelve `null` cuando no hay NADA que guardar — nunca un objeto con los dos
 * campos vacíos, que en la base se vería como «Meta explicó algo» siendo falso.
 */
export function motivoDeCloudApi(errors: unknown): MotivoDeEntrega | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const primero = errors[0] as
    | { code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } }
    | null
    | undefined;
  if (!primero || typeof primero !== 'object') return null;

  // El código llega como número en el JSON de Meta; se normaliza a texto acá, en
  // el único lugar que conoce las dos formas.
  const crudo = primero.code;
  const codigo =
    typeof crudo === 'number' && Number.isFinite(crudo)
      ? String(crudo)
      : textoNoVacio(crudo);

  const detalle =
    textoNoVacio(primero.error_data?.details) ??
    textoNoVacio(primero.message) ??
    textoNoVacio(primero.title);

  if (codigo === null && detalle === null) return null;
  return { codigo, detalle };
}
