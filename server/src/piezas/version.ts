import { createHash } from "node:crypto";

/**
 * LA VERSIÓN DE UNA PIEZA — **una sola receta**, para el catálogo y para el lazo.
 *
 * ══ POR QUÉ HACE FALTA VERSIONAR (H5 del plan de Ivi) ═══════════════════════
 *
 * Una pieza sin versión mide **un blanco móvil y no lo dice**. El día que
 * alguien mejore la frase, los resultados de los dos textos se suman: una pieza
 * que rendía 12 % y saltó a 30 % con el texto nuevo se reporta **21 % para
 * siempre**, y el hallazgo —que el cambio funcionó— desaparece justo en el
 * número que existía para verlo. No se arregla después: los envíos ya escritos
 * no se pueden re-atribuir. El dato se pierde en el instante de escribirlo.
 *
 * ══ POR QUÉ UNA SOLA RECETA, Y NO DOS QUE HOY COINCIDEN ═════════════════════
 *
 * El catálogo (PR #173) publica la versión y el lazo (PR #171) la estampa en
 * `envios_wa`. **Si las dos no calculan exactamente lo mismo, el join da cero
 * filas y nadie se entera**: se lee como «esa pieza no se usó nunca», que es el
 * modo de fallo que los dos frentes dicen estar evitando. Cuando cada uno tenía
 * la suya, ya divergían en cuatro cosas a la vez — formato (`sha256:` + 16 hex
 * contra 64 hex pelados), normalización, si la imagen entraba, y qué hacer con
 * el contenido vacío.
 *
 * Por eso la receta vive **una vez**, acá, y los dos la importan. La copia está
 * prohibida por un test que falla si aparece otro hash sin justificar
 * (`receta-unica.test.ts`) y por los vectores literales de `vectores.ts`, que
 * fallan si el resultado cambia de cualquiera de los dos lados.
 *
 * ══ POR QUÉ UN HASH Y NO UN `version integer` ═══════════════════════════════
 *
 * Las dos formas cumplían el pedido de Ivi («lo que sea estable y comparable»).
 * El hash gana por tres razones concretas de ESTE repo:
 *
 *   1. **Dos de los cuatro catálogos viven en código** (los acuses de
 *      `autorespuesta/plantillas.ts` y los ganchos de `campana.ts`): no hay fila
 *      donde incrementar un contador.
 *   2. **No se puede olvidar.** Un contador obliga a *cada* camino de edición
 *      (la UI de hechos, la de plantillas, un `UPDATE` a mano, un script de
 *      siembra) a acordarse de subirlo — y el bump que falta no rompe nada:
 *      **mezcla dos textos en silencio**, el modo de fallo exacto que esto viene
 *      a evitar. El hash se deriva del contenido: no hay «acordarse».
 *   3. **Sobrevive a la unificación de catálogos** (frente 2 de #169): el mismo
 *      texto conserva el mismo hash aunque cambie el id, y es comparable fuera
 *      de Hermes sin arrastrar la numeración interna.
 *
 * El precio, dicho: A → B → A colapsa a dos versiones, no tres. Para medir
 * rendimiento por texto eso es lo correcto: es el MISMO texto. Y el ORDEN que un
 * contador daría lo da el `creado_at` del primer envío que la usó.
 *
 * ══ QUÉ ENTRA EN LA VERSIÓN, EXACTAMENTE ═══════════════════════════════════
 *
 *   · **El texto SIN RESOLVER.** `{nombre}`/`{curso}`/`{precio}` se resuelven
 *     por contacto contra Cerberus en el instante del envío: hashear el mensaje
 *     final haría de **cada destinatario una versión distinta** y el versionado
 *     no mediría nada.
 *   · **El ARCHIVO adjunto — el nombre del archivo, no la clase de media.** El
 *     42 % de la secuencia de venta lleva imagen y en Goberna **el precio y las
 *     fechas viven DENTRO de la imagen**: cambiar `flyer-julio.jpg` por
 *     `flyer-agosto-PRECIO-NUEVO.jpg` cambia lo que la persona recibe, así que
 *     es una versión nueva. Hashear `media_clase` (que es la cadena `"imagen"`)
 *     en vez de `media_archivo` deja la versión clavada mientras el contenido
 *     cambia: es el blanco móvil de H5, movido de la prosa a la imagen.
 *   · **El rótulo NO entra.** Renombrar «Flyer julio» a «Flyer de julio» no es
 *     un texto nuevo, y si contara, el lazo partiría el historial de una pieza
 *     porque alguien le arregló una tilde a una etiqueta interna.
 *
 * ══ LO QUE LA NORMALIZACIÓN ABSORBE, Y LO QUE NO ════════════════════════════
 *
 * Se normaliza CRLF → LF y se recortan los bordes: un editor que guarda al
 * estilo Windows no puede partir en dos la historia de una pieza. **No absorbe
 * los espacios de adentro**: `"dos  espacios"` y `"dos espacios"` son versiones
 * distintas, y está bien que lo sean — eso ya es una edición del texto.
 */

/** El prefijo dice qué algoritmo es. Va en el valor porque el valor viaja solo. */
export const PREFIJO_VERSION = "sha256:";

/** 16 hex = 64 bits. Alcanza de sobra para distinguir textos y entra en un log. */
const LARGO_HEX = 16;

/**
 * Cada parte entra con su largo en bytes adelante (`12:hola mundo…`).
 *
 * Es la parte aburrida y la que más importa: **sin delimitar, `["ab","c"]` y
 * `["a","bc"]` dan el mismo hash** y dos piezas distintas quedan con la misma
 * versión. Se prefija el largo en vez de intercalar un separador porque así no
 * hay que apostar a que algún carácter «no puede aparecer» en un texto de
 * WhatsApp o en un nombre de archivo: con el largo adelante, la lectura es
 * inequívoca sea cual sea el contenido.
 */
function alimentar(h: ReturnType<typeof createHash>, parte: string | null | undefined): void {
  const bytes = Buffer.from(parte ?? "", "utf8");
  h.update(String(bytes.length));
  h.update(":");
  h.update(bytes);
}

/** CRLF → LF y bordes recortados. Ver arriba qué NO absorbe. */
export function normalizarContenido(t: string | null | undefined): string {
  return (t ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * La versión de un contenido, a partir de sus partes en orden.
 *
 * Es **total a propósito**: siempre devuelve una versión, incluso para el
 * contenido vacío. «Vacío» y «no sabemos qué texto era» son cosas distintas, y
 * confundirlas fue una de las cuatro divergencias entre los dos frentes (el
 * catálogo hasheaba el vacío, el lazo devolvía `null`). El `null` significa una
 * sola cosa y vive en el lazo: *no se pudo determinar el contenido*.
 */
export function versionDeContenido(partes: readonly (string | null | undefined)[]): string {
  const h = createHash("sha256");
  for (const parte of partes) alimentar(h, parte);
  return PREFIJO_VERSION + h.digest("hex").slice(0, LARGO_HEX);
}

/**
 * EL CONTENIDO AUTORAL de un mensaje: el texto tal como está guardado más el
 * archivo que lo acompaña.
 *
 * Es un tipo y no un `string` para que sea imposible pasarle el mensaje final
 * por descuido: quien construya esto tiene que haber pensado qué es el texto
 * autoral y qué es la resolución por contacto.
 */
export interface ContenidoDePieza {
  /** El texto TAL COMO ESTÁ GUARDADO, con sus `{nombre}` `{curso}` `{precio}`. */
  texto: string | null;
  /** El nombre del archivo adjunto. Cambiar el flyer ES otra versión. */
  archivo?: string | null;
}

/** La versión de UN mensaje: un hecho, un acuse, un gancho, o un paso suelto. */
export function versionDeUnMensaje(c: ContenidoDePieza): string {
  return versionDeContenido([normalizarContenido(c.texto), normalizarContenido(c.archivo)]);
}

/**
 * La versión de una SECUENCIA entera: las versiones de sus pasos, en orden.
 *
 * Se hashea sobre las versiones de los pasos y no sobre sus textos crudos para
 * que la propiedad sea evidente y no haya que confiar en que dos `flatMap`
 * distintos coinciden: **la secuencia cambia si y solo si cambió alguno de sus
 * pasos, o el orden en que salen**. Renumerar los `orden` sin mover los textos
 * (1,2 → 5,6) no es un cambio: la persona recibe exactamente lo mismo.
 */
export function versionDeUnaSecuencia(pasos: readonly ContenidoDePieza[]): string {
  return versionDeContenido(pasos.map(versionDeUnMensaje));
}

/**
 * La versión sin el prefijo, para que entre en una columna de tabla.
 *
 * No recorta a 8 caracteres como hacía el lazo antes de unificar: con el
 * prefijo, `slice(0, 8)` daría `"sha256:x"` para todas las piezas — la columna
 * diría lo mismo siempre y nadie lo notaría.
 */
export function versionLegible(version: string | null): string {
  if (!version) return "sin-versión";
  return version.startsWith(PREFIJO_VERSION) ? version.slice(PREFIJO_VERSION.length) : version;
}
