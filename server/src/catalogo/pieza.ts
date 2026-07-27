import { CLASES_DE_PIEZA, type ClasePieza } from "../piezas/direccion.js";

/**
 * UNA PIEZA — la forma con la que Hermes publica todo lo que se puede decir.
 *
 * ══ QUÉ PROBLEMA RESUELVE ═══════════════════════════════════════════════════
 *
 * Ivi ARMA, no inventa: elige y ordena piezas registradas y devuelve **ids,
 * nunca texto**, y Hermes compone con su texto ACTUAL. De ahí sale la propiedad
 * que hace segura toda la integración:
 *
 *   > un índice viejo del lado de Ivi degrada la CALIDAD de la selección, nunca
 *   > la CORRECCIÓN de lo que se manda.
 *
 * Para poder elegir, Ivi necesita ver el catálogo. Este módulo define QUÉ es una
 * pieza; `repositorio.ts` las junta y `routes/catalogo.ts` las sirve.
 *
 * ══ HOY SON CUATRO CATÁLOGOS, Y ESO NO SE ARREGLA ACÁ ═══════════════════════
 *
 * Lo-que-se-puede-decir vive hoy en cuatro lugares con tres formas de id
 * distintas: `plantillas` + `plantilla_pasos` (tabla, id numérico, y son
 * PERSONALES de cada vendedora), `hechos` (tabla, `clave` textual), los acuses
 * de la auto-respuesta (arreglo en código, id legible) y los ganchos por familia
 * (arreglo en código). Unificarlos es otro frente.
 *
 * Por eso el contrato con Ivi **no expone dónde vive cada pieza**: expone
 * `{clase, id}` y nada más. `clase` es semántica («qué tipo de cosa es esto»),
 * no un nombre de tabla. El día que los cuatro catálogos se unifiquen en uno,
 * las piezas siguen teniendo la misma clase y el mismo id, y el contrato no se
 * entera. Si en cambio publicáramos `origen: "tabla:hechos"`, la unificación
 * sería un cambio de contrato con un consumidor externo.
 *
 * ══ POR QUÉ `{clase, id}` Y NO UN ID PELADO ═════════════════════════════════
 *
 * Los ids de los cuatro catálogos no son compatibles entre sí: un `412` puede
 * ser una plantilla o cualquier otra cosa, mientras que `{clase:"hecho",
 * id:"cuotas"}` es inequívoco, y evita que la unificación futura tenga que
 * renumerar nada.
 *
 * ⚠️ **Es una decisión de Hermes, no un pedido de Ivi** — acá decía «es el
 * pedido explícito de Ivi tras inventariar el repo» y no se sostiene contra
 * ninguna foto: medido contra `ivi-cerebro@1e5d2f3`, los documentos que se
 * citaban están sin commitear y su payload de ensamblado es
 * `{id, version, orden, gancho_id}`, sin `clase`. La medición completa y el
 * punto de contrato que queda abierto están en `piezas/direccion.ts`.
 *
 * ══ LO QUE NO ES DIRECCIONABLE ══════════════════════════════════════════════
 *
 * **Un paso suelto de una plantilla no tiene id estable**: `escribirPasos()`
 * borra todos los pasos y los reinserta en cada edición, así que
 * `plantilla_pasos.id` cambia sin que cambie el paso. Por eso los pasos viajan
 * DENTRO de su plantilla, con su `orden`, y no como piezas propias: publicar un
 * id que mañana apunta a otra cosa es peor que no publicarlo.
 */

// Las clases y el direccionamiento viven en `piezas/direccion.ts`, que es el
// MISMO módulo que importa el lazo de resultados (ADR 0022) para estampar la
// pieza en `envios_wa`. Acá se re-exportan y no se redefinen: si el catálogo
// dijera `hecho` y el lazo `dato`, el join entre lo que Ivi recomienda y lo que
// se mandó daría cero filas **en silencio**, y eso se lee como «esa pieza no se
// usó nunca».
export { CLASES_DE_PIEZA, type ClasePieza };

/**
 * En qué estado está.
 *
 *   · `vigente`   — se puede usar hoy.
 *   · `borrador`  — existe pero **nadie la aprobó** (una plantilla minada del
 *     histórico). Se publica a propósito: que Ivi vea que existe es distinto de
 *     que la pueda recomendar, y esconderla haría parecer que falta una pieza
 *     cuando lo que falta es una firma humana.
 *   · `retirada`  — se sacó de circulación (archivada o inactiva). Se publica
 *     para que un resultado histórico atribuido a ella siga teniendo a qué
 *     apuntar.
 */
export const ESTADOS_DE_PIEZA = ["vigente", "borrador", "retirada"] as const;
export type EstadoPieza = (typeof ESTADOS_DE_PIEZA)[number];

/**
 * A qué curso pertenece — **y en qué vocabulario está dicho**.
 *
 * Hermes tiene DOS vocabularios de familia que no son el mismo y no mapean 1:1:
 *
 *   · `sku-cerberus` — el prefijo de SKU de Cerberus (`DIPICOT`), que es lo que
 *     usan `plantillas.familia_curso` y `alias_curso.familia`. Sobrevive a las
 *     ediciones del diploma.
 *   · `campana-goberna` — el área de la campaña (`osint`, `inteligencia`,
 *     `legislativo`…), que es lo que usan los ganchos de `autorespuesta/campana.ts`.
 *
 * Publicarlas como un solo campo `familia: string` invitaría a Ivi a cruzarlas,
 * y ese join daría piezas del curso equivocado sin que nada falle. El
 * vocabulario viaja con el valor.
 */
export interface FamiliaDePieza {
  vocabulario: "sku-cerberus" | "campana-goberna";
  valor: string;
}

/**
 * Un paso de una plantilla-secuencia. **No tiene id propio** (ver arriba): se
 * direcciona dentro de su plantilla, con `(id, orden)`.
 */
export interface PasoDePieza {
  orden: number;
  texto: string | null;
  /** Qué clase de media lleva (`imagen`, `documento`…). `null` = solo texto. */
  mediaClase: string | null;
  /** El paso pide una imagen que todavía nadie cargó: no se puede mandar. */
  mediaPendiente: boolean;
  /**
   * LA VERSIÓN DE ESTE PASO, con la misma receta que la de la pieza entera.
   *
   * Va acá porque el lazo de resultados estampa el paso, no la secuencia: en
   * `envios_wa` queda `plantilla:12#3` con la versión de ESE paso. Si el
   * catálogo publicara solo la versión de la plantilla, lo que quedó escrito no
   * aparecería en ninguna parte del catálogo y el join daría cero.
   *
   * Además cambia por su cuenta: reemplazar el flyer de julio por el de agosto
   * cambia la versión del paso 1 y la de la secuencia, y no toca la del paso 2.
   */
  version: string;
}

/** Las dos sintaxis de marcador que conviven en el repo, incompatibles entre sí. */
export type SintaxisPlaceholder = "llave-simple" | "llave-doble";

export interface Pieza {
  clase: ClasePieza;
  /** Único DENTRO de su clase. La identidad es el par `{clase, id}`. */
  id: string;
  /** Hash del contenido que sale (`piezas/version.ts`). Estable y comparable. */
  version: string;
  estado: EstadoPieza;
  /**
   * `negocio` = vale para cualquiera · `vendedora` = es de una persona.
   *
   * Las plantillas son PERSONALES (`plantillas.vendedora_id`), así que «el
   * catálogo» no es global — la pregunta que Ivi dejó abierta. La respuesta es
   * este campo: el catálogo se publica entero, marcado, y quien pide un
   * ensamblado para una vendedora se queda con lo suyo + lo del negocio.
   */
  alcance: "negocio" | "vendedora";
  /** El `vendedoraId` dueño, cuando el alcance es `vendedora`. */
  propietario: string | null;
  /** Nombre corto para un humano. NO entra en la versión: renombrar no es editar. */
  rotulo: string;
  /** El texto que se manda, con sus marcadores sin resolver. */
  texto: string;
  /**
   * En qué momentos de la venta corresponde. **Vacío = sin declarar, aplica a
   * cualquiera** (la misma semántica que `hechos.momentos`).
   *
   * Es `string[]` y no `MomentoDeVenta[]` A PROPÓSITO: si una fila trae un
   * momento que este build no conoce, viaja tal cual. Filtrarlo sería lo
   * contrario de conservador — dejaría el arreglo vacío, que significa «aplica a
   * todos», y una pieza acotada a un momento nuevo pasaría a ofrecerse en todos.
   */
  momentos: string[];
  familia: FamiliaDePieza | null;
  /** Solo las plantillas-secuencia. `null` = la pieza es un mensaje suelto. */
  pasos: PasoDePieza[] | null;
  /** Los marcadores que hay que resolver antes de mandar (`nombre`, `curso`…). */
  placeholders: string[];
  sintaxisPlaceholder: SintaxisPlaceholder | null;
  /** ¿Se puede mandar hoy tal como está? */
  enviable: boolean;
  /**
   * Por qué no, en un código enumerado (nunca prosa que alguien pueda pegar en
   * un mensaje). `fragmento` = no es un mensaje, es un pedazo que otra pieza
   * inserta — el caso de los ganchos.
   */
  motivoNoEnviable: "no_vigente" | "media_pendiente" | "fragmento" | null;
}

const MARCADOR_DOBLE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const MARCADOR_SIMPLE = /\{\s*([a-z_]+)\s*\}/g;

/**
 * Qué marcadores tiene el texto y en qué sintaxis.
 *
 * Existen DOS incompatibles en el repo: `{nombre}` en las plantillas-secuencia
 * (`plantillas/expandir.ts`) y `{{saludo}}` en los acuses
 * (`autorespuesta/plantillas.ts`). Ivi no expande nada —eso es de Hermes— pero
 * sí tiene que saber que una pieza con marcadores necesita contexto para poder
 * salir. Se detecta la doble primero: `{{curso}}` también matchea la simple.
 */
export function marcadoresDe(texto: string): {
  placeholders: string[];
  sintaxis: SintaxisPlaceholder | null;
} {
  const dobles = [...texto.matchAll(MARCADOR_DOBLE)].map((m) => m[1] as string);
  if (dobles.length > 0) return { placeholders: unicos(dobles), sintaxis: "llave-doble" };

  const simples = [...texto.matchAll(MARCADOR_SIMPLE)].map((m) => m[1] as string);
  if (simples.length > 0) return { placeholders: unicos(simples), sintaxis: "llave-simple" };

  return { placeholders: [], sintaxis: null };
}

function unicos(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}
