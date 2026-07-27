import {
  CLASES_DE_PIEZA,
  esClaseDePieza,
  refDeDireccion,
  type ClasePieza,
} from "../piezas/direccion.js";
import {
  versionDeUnMensaje,
  versionLegible,
  type ContenidoDePieza,
} from "../piezas/version.js";
import { MOMENTOS_DE_VENTA, type MomentoDeVenta } from "../sugerencias/estado.js";

/**
 * DE QUÉ PIEZA SALIÓ ESTE MENSAJE — el hecho que se escribe (épica #169, frente 1).
 *
 * ══ EL AGUJERO QUE TAPA ══════════════════════════════════════════════════════
 *
 * `envios_wa` guardaba quién, a quién, qué texto y si salió. Nunca **de qué
 * pieza vino**. Con eso, una secuencia con 500 usos y 0 ventas se ve idéntica a
 * una con 500 usos y 50: contamos disparos y nunca blancos.
 *
 * ══ `null` NO ES UN HUECO: ES LA LÍNEA DE BASE ═══════════════════════════════
 *
 * Lo que la vendedora escribe a mano es **contra lo que se compara todo lo
 * demás**. Si una pieza no le gana al texto que ella habría escrito igual, la
 * pieza no sirve. Por eso esto no es `Pieza | null` sino una unión con dos
 * ramas nombradas, y `A_MANO` tiene rótulo propio en los reportes. Un `null`
 * anónimo se lee como «falta el dato»; `a-mano` se lee como lo que es.
 *
 * ══ POR QUÉ (clase, ref) Y `via` SON COSAS DISTINTAS ═════════════════════════
 *
 * Esta es la decisión no obvia, y está pensada para **sobrevivir al frente 2**
 * de la épica —el que unifica los cuatro catálogos (secuencias, datos, ganchos,
 * acuses) en uno solo con bases y deltas—, que va a llegar DESPUÉS de que esta
 * tabla ya tenga meses de datos:
 *
 *   · **(clase, ref) = QUÉ se mandó.** Es la identidad de la pieza dentro de su
 *     catálogo. El día que los catálogos se unifiquen, esto se remapea con una
 *     tabla de equivalencias —(plantilla, "12#3") → pieza 481— y **los datos viejos
 *     siguen valiendo**. Si en cambio hubiéramos guardado una FK a
 *     `plantilla_pasos.id`, la unificación obligaría a migrar (o a tirar) todo
 *     lo acumulado.
 *   · **`via` = DE DÓNDE LA SACÓ la vendedora.** Es una propiedad de la
 *     *pantalla*, no del catálogo: las dos respuestas del panel, el buscador de
 *     secuencias, el bloque de datos, o la auto-respuesta. El frente 2 **no la
 *     toca**, porque unificar catálogos no cambia por dónde entró la mano.
 *
 * De ahí sale lo que se puede preguntar: «¿la secuencia 12 funciona?» (por
 * pieza, sumando vías) y «¿las dos respuestas del panel sirven de algo, o la
 * vendedora elige mejor sola?» (por vía, sumando piezas). Con un solo campo
 * mezclado, ninguna de las dos preguntas tiene respuesta.
 *
 * ══ EL VOCABULARIO Y LA RECETA VIENEN DE `piezas/`, NO DE ACÁ ════════════════
 *
 * La clase, la `ref` y la versión **las define `server/src/piezas/`**, que es el
 * mismo módulo que usa el catálogo que Ivi consulta (PR #173). Este archivo no
 * los reimplementa: los importa.
 *
 * No es una preferencia de estilo, es la única forma de que el trabajo sirva.
 * Ivi recomienda `hecho:cuotas@sha256:…` y para saber si esa pieza funcionó hay
 * que encontrarla en `envios_wa`. Cuando cada lado tenía su vocabulario —el
 * catálogo publicaba `{clase:"plantilla", id:"12"}` y acá se estampaba
 * `{clase:"paso", ref:"12#3"}`; el mismo dato salía `hecho:cuotas` de un lado y
 * `dato:cuotas` del otro; las versiones ni siquiera tenían el mismo formato— **el
 * join daba cero filas para todo el catálogo, en silencio**, y eso se lee como
 * «esa pieza no se usó nunca». Es el modo de fallo que este frente existe para
 * no cometer, y es la lección de #37: una sola implementación, con un test que
 * impide la segunda (`piezas/receta-unica.test.ts`).
 *
 * ══ Y LA VERSIÓN, QUE ES AHORA O NUNCA ═══════════════════════════════════════
 *
 * Una pieza sin versión mide **un blanco móvil y no lo dice**. El día que
 * alguien mejore la frase, los resultados de los dos textos se suman: una pieza
 * que rendía 12 % y saltó a 30 % con el texto nuevo se reporta 21 % **para
 * siempre**, y el hallazgo —que el cambio funcionó— desaparece justo en el
 * número que existía para verlo.
 *
 * No se puede arreglar después: los envíos ya escritos no se pueden re-atribuir
 * a la versión que efectivamente salió. El dato se pierde en el instante de
 * escribirlo, así que la versión va en la misma fila, desde el primer envío.
 *
 * **Es un sha256 y no un contador**, por tres razones:
 *
 *   1. **No se puede olvidar de incrementarlo.** Un `version integer` obliga a
 *      cada camino de edición (la UI de hechos, la de plantillas, un `UPDATE` a
 *      mano, un script de siembra) a acordarse de subirlo — y el bump que falta
 *      no rompe nada: mezcla dos textos en silencio, que es exactamente el modo
 *      de fallo que estamos evitando. El hash sale del contenido: no hay nada
 *      que recordar.
 *   2. **Sobrevive al frente 2.** Cuando los cuatro catálogos se unifiquen y las
 *      piezas cambien de id, el MISMO texto conserva el MISMO hash: lo
 *      acumulado sigue siendo comparable por contenido, no solo por un id
 *      remapeado.
 *   3. **Es comparable entre sistemas.** El corpus que salga hacia Ivi puede
 *      hablar de versiones sin arrastrar la numeración interna de Hermes.
 *
 * Lo que un contador da y el hash no es el ORDEN. No hace falta: `creado_at` de
 * cada envío dice cuál se usó antes, y el reporte ordena las versiones por su
 * primera aparición.
 *
 * ══ QUÉ ES «EL TEXTO DE LA PIEZA», EXACTAMENTE ═══════════════════════════════
 *
 * **La plantilla SIN resolver, nunca el mensaje final.** `{nombre}`, `{curso}` y
 * `{precio}` se resuelven en el server contra Cerberus en el instante del envío:
 * si el hash se calculara sobre el mensaje que salió, **cada destinatario sería
 * una versión distinta** y el versionado no mediría nada. La pieza es lo que un
 * humano escribió y puede editar; lo que cambia por contacto es un dato del
 * contacto, no una versión de la pieza.
 *
 * Con las mismas reglas, y escritas para que no se puedan malinterpretar:
 *
 *   · un cambio de **solo espacios o saltos de línea** NO es una versión nueva
 *     (se normalizan antes de hashear): un editor que guarda CRLF no puede
 *     partir en dos la historia de una pieza;
 *   · **cambiar la imagen de un paso SÍ lo es** — el flyer es contenido, y
 *     cambiarlo cambia lo que la persona recibe. Por eso el archivo entra en el
 *     hash junto al texto;
 *   · una pieza cuyo contenido **no se pudo determinar** va con versión `null`,
 *     que se lee como «no sabemos qué texto era», nunca como una versión más.
 *     **`null` significa eso y solo eso**: un contenido VACÍO sí tiene versión.
 *     Confundir «vacío» con «no sabemos» era otra de las divergencias con el
 *     catálogo, y en un reporte son dos filas distintas.
 */

// Las clases son las cuatro del vocabulario compartido (`plantilla` · `hecho` ·
// `acuse` · `gancho`), no una lista propia. Se re-exportan para que quien ya
// importaba de acá no tenga que enterarse de dónde viven ahora.
export { CLASES_DE_PIEZA, type ClasePieza };

/**
 * Por qué superficie de Hermes entró. NO es parte de la identidad de la pieza
 * (ver el comentario de arriba): la misma secuencia sugerida por el panel y
 * buscada a mano es la misma secuencia.
 */
export const VIAS_DE_PIEZA = [
  /** Una de las dos respuestas listas del panel derecho. */
  "panel-sugerencia",
  /** El buscador de secuencias («Mensajes predeterminados»): la eligió ella. */
  "panel-secuencias",
  /** El bloque de datos recomendados (#153). Cae en el composer, no envía. */
  "panel-datos",
  /** El acuse fuera de horario (ADR 0015/0018). No hubo pantalla. */
  "automatica",
] as const;
export type ViaDePieza = (typeof VIAS_DE_PIEZA)[number];

// El contenido autoral (el texto sin resolver + el archivo) es el MISMO tipo
// con el que el catálogo publica la versión de esa pieza. Se re-exporta para
// que quien ya lo importaba de acá no se entere del cambio de casa.
export { type ContenidoDePieza };

/**
 * La versión de una pieza, o `null` si **no se pudo determinar el contenido**.
 *
 * El cálculo NO vive acá: es `versionDeUnMensaje` de `piezas/version.ts`, la
 * misma función con la que el catálogo publica la versión de esa misma pieza.
 * Lo único que agrega esta capa es el `null`, que es del lazo y no de la receta:
 * en `envios_wa` puede haber una fila de la que no sepamos qué texto llevaba
 * (una fila anterior al versionado, un cuerpo que no llegó), y eso se lee «no
 * sabemos», nunca como una versión más.
 *
 * Un contenido **vacío** no es ese caso: tiene versión, la del vacío. Antes acá
 * devolvía `null` mientras el catálogo publicaba un hash — dos respuestas
 * distintas para la misma pieza, que es justo lo que rompía el join.
 */
export function versionDePieza(c: ContenidoDePieza | null): string | null {
  return c ? versionDeUnMensaje(c) : null;
}

/** La versión sin el prefijo del algoritmo, para que entre en una columna. */
export function versionCorta(version: string | null): string {
  return versionLegible(version);
}

/** Lo que salió de una pieza registrada. */
export interface DeUnaPieza {
  tipo: "pieza";
  clase: ClasePieza;
  /** La identidad dentro del catálogo de su clase. Estable, textual, remapeable. */
  ref: string;
  /**
   * QUÉ TEXTO ERA. `null` = no se pudo determinar — y se lee así, nunca como
   * «la versión de siempre». Sin esto, mejorar una frase borra la evidencia de
   * que mejorarla sirvió.
   */
  version: string | null;
  via: ViaDePieza;
  /**
   * ¿El texto que salió NO era el de la pieza? Un dato que la vendedora
   * reescribió sigue siendo trazable a la pieza que se lo sugirió, pero su
   * resultado no se le puede acreditar entero. Contarlo junto con lo textual
   * sería inflar la pieza con las palabras de ella.
   */
  editada: boolean;
  /** En qué punto de la venta estaba la conversación cuando salió. */
  momento: MomentoDeVenta | null;
}

/** Lo escribió la vendedora. **La línea de base**, no un dato faltante. */
export interface AMano {
  tipo: "a-mano";
  momento: MomentoDeVenta | null;
}

export type Procedencia = DeUnaPieza | AMano;

/** La línea de base sin momento conocido. */
export const A_MANO: AMano = { tipo: "a-mano", momento: null };

/** La línea de base, sabiendo en qué punto de la venta pasó. */
export function aMano(momento: MomentoDeVenta | null): AMano {
  return { tipo: "a-mano", momento };
}

export function esAMano(p: Procedencia): p is AMano {
  return p.tipo === "a-mano";
}

/**
 * UN PASO DE UNA SECUENCIA.
 *
 * La clase es `plantilla` y el `orden` va en la ref (`12#3`), **no una clase
 * `paso` con id propio**. Las dos mitades de esa decisión importan:
 *
 *   · `plantilla_pasos.id` NO es estable: `escribirPasos()` borra todos los
 *     pasos y los reinserta en cada edición. Por eso el catálogo publica la
 *     plantilla y no el paso, y por eso acá tampoco puede haber un id de paso.
 *   · pero el flyer y el seguimiento de la misma secuencia **funcionan
 *     distinto**, y medirlos juntos escondería justo lo que se quiere ver.
 *
 * `(plantilla_id, orden)` cumple las dos: es estable (tiene su `unique` en el
 * schema) y distingue los pasos. Es además la forma que Ivi ya usa en su
 * contrato de ensamblado, `{id, orden}`.
 */
export function deUnPasoDePlantilla(o: {
  plantillaId: number;
  orden: number;
  via: Extract<ViaDePieza, "panel-sugerencia" | "panel-secuencias">;
  /**
   * El contenido AUTORAL del paso: el texto guardado (con sus marcadores sin
   * resolver) y el archivo. Explícito y obligatorio —aunque sea `null`— para
   * que nadie lo omita por descuido: una pieza sin versión mide un blanco móvil.
   */
  contenido: ContenidoDePieza | null;
  momento?: MomentoDeVenta | null;
}): DeUnaPieza {
  return {
    tipo: "pieza",
    clase: "plantilla",
    ref: refDeDireccion({ clase: "plantilla", id: String(o.plantillaId), orden: o.orden }),
    version: versionDePieza(o.contenido),
    via: o.via,
    editada: false, // el server expande {nombre}/{curso}/{precio}: sale textual
    momento: o.momento ?? null,
  };
}

/**
 * Un dato recomendado (#153). Cae en el composer, así que puede salir editado.
 *
 * La clase es `hecho` —el nombre de la tabla y el que publica el catálogo—, no
 * `dato`: el mismo dato no puede llamarse `hecho:cuotas` de un lado y
 * `dato:cuotas` del otro, o el join da cero y se lee como que nadie la usó.
 */
export function deUnDato(o: {
  clave: string;
  editada: boolean;
  /** El texto del catálogo — el que ella vio, no el que terminó mandando. */
  contenido: ContenidoDePieza | null;
  momento?: MomentoDeVenta | null;
}): DeUnaPieza {
  return {
    tipo: "pieza",
    clase: "hecho",
    ref: refDeDireccion({ clase: "hecho", id: o.clave }),
    version: versionDePieza(o.contenido),
    via: "panel-datos",
    editada: o.editada,
    momento: o.momento ?? null,
  };
}

/** El acuse fuera de horario. `plantillaId` es el slug del catálogo cerrado. */
export function deUnAcuse(o: {
  plantillaId: string;
  /** El cuerpo de la plantilla del acuse, sin renderizar. */
  contenido: ContenidoDePieza | null;
  momento?: MomentoDeVenta | null;
}): DeUnaPieza {
  return {
    tipo: "pieza",
    clase: "acuse",
    ref: refDeDireccion({ clase: "acuse", id: o.plantillaId }),
    version: versionDePieza(o.contenido),
    via: "automatica",
    editada: false,
    momento: o.momento ?? null,
  };
}

/** La ref de la pieza, o `null` si fue a mano. Ese `null` es el dato. */
export function refDePieza(p: Procedencia): string | null {
  return esAMano(p) ? null : p.ref;
}

/** Cómo se lee en un reporte. La línea de base dice que lo es, y la versión se ve. */
export function rotuloDePieza(p: Procedencia): string {
  if (esAMano(p)) return "escrito a mano (la línea de base)";
  return `${p.clase} · ${p.ref} @${versionCorta(p.version)}`;
}

/** La forma en que la procedencia vive en `envios_wa` (seis columnas anexas). */
export interface ColumnasDeProcedencia {
  piezaClase: string | null;
  piezaRef: string | null;
  piezaVersion: string | null;
  piezaVia: string | null;
  piezaEditada: boolean;
  momentoVenta: string | null;
}

export function columnasDeProcedencia(p: Procedencia): ColumnasDeProcedencia {
  if (esAMano(p)) {
    return {
      piezaClase: null,
      piezaRef: null,
      piezaVersion: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: p.momento,
    };
  }
  return {
    piezaClase: p.clase,
    piezaRef: p.ref,
    piezaVersion: p.version,
    piezaVia: p.via,
    piezaEditada: p.editada,
    momentoVenta: p.momento,
  };
}

function esVia(v: string | null): v is ViaDePieza {
  return v !== null && (VIAS_DE_PIEZA as readonly string[]).includes(v);
}

/** Un momento que no está en el vocabulario compartido no es un momento. */
export function esMomento(v: string | null | undefined): v is MomentoDeVenta {
  return typeof v === "string" && (MOMENTOS_DE_VENTA as readonly string[]).includes(v);
}

/**
 * Lee la procedencia de una fila. **Ante la duda, la línea de base**: una fila
 * a medias o con una clase que no conocemos NO se cuenta como pieza, porque
 * contarla le acreditaría a alguien un resultado que no es suyo. Perder una
 * atribución es un error barato; inventarla es el error que este trabajo existe
 * para no cometer.
 */
export function procedenciaDesdeColumnas(c: ColumnasDeProcedencia): Procedencia {
  const momento = esMomento(c.momentoVenta) ? c.momentoVenta : null;
  if (!esClaseDePieza(c.piezaClase) || !c.piezaRef || !esVia(c.piezaVia)) return aMano(momento);
  return {
    tipo: "pieza",
    clase: c.piezaClase,
    ref: c.piezaRef,
    // Una fila anterior al versionado tiene `null` acá, y eso es lo correcto:
    // no sabemos qué texto era. Nunca se la mezcla con una versión conocida.
    version: c.piezaVersion || null,
    via: c.piezaVia,
    editada: c.piezaEditada,
    momento,
  };
}
