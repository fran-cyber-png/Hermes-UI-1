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
 *     tabla de equivalencias —(paso, "12#3") → pieza 481— y **los datos viejos
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
 */

/** Las clases de pieza que hoy existen. Lista cerrada: un typo no llega a la base. */
export const CLASES_DE_PIEZA = ["paso", "dato", "acuse"] as const;
export type ClasePieza = (typeof CLASES_DE_PIEZA)[number];

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

/** Lo que salió de una pieza registrada. */
export interface DeUnaPieza {
  tipo: "pieza";
  clase: ClasePieza;
  /** La identidad dentro del catálogo de su clase. Estable, textual, remapeable. */
  ref: string;
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
 * Un paso de una secuencia. La ref lleva la plantilla **y el orden**: el flyer
 * y el seguimiento de la misma secuencia son dos piezas distintas y funcionan
 * distinto — juntarlas escondería justo lo que se quiere ver.
 */
export function deUnPasoDePlantilla(o: {
  plantillaId: number;
  orden: number;
  via: Extract<ViaDePieza, "panel-sugerencia" | "panel-secuencias">;
  momento?: MomentoDeVenta | null;
}): DeUnaPieza {
  return {
    tipo: "pieza",
    clase: "paso",
    ref: `${o.plantillaId}#${o.orden}`,
    via: o.via,
    editada: false, // el server expande {nombre}/{curso}/{precio}: sale textual
    momento: o.momento ?? null,
  };
}

/** Un dato recomendado (#153). Cae en el composer, así que puede salir editado. */
export function deUnDato(o: {
  clave: string;
  editada: boolean;
  momento?: MomentoDeVenta | null;
}): DeUnaPieza {
  return {
    tipo: "pieza",
    clase: "dato",
    ref: o.clave,
    via: "panel-datos",
    editada: o.editada,
    momento: o.momento ?? null,
  };
}

/** El acuse fuera de horario. `plantillaId` es el slug del catálogo cerrado. */
export function deUnAcuse(o: { plantillaId: string; momento?: MomentoDeVenta | null }): DeUnaPieza {
  return {
    tipo: "pieza",
    clase: "acuse",
    ref: o.plantillaId,
    via: "automatica",
    editada: false,
    momento: o.momento ?? null,
  };
}

/** La ref de la pieza, o `null` si fue a mano. Ese `null` es el dato. */
export function refDePieza(p: Procedencia): string | null {
  return esAMano(p) ? null : p.ref;
}

/** Cómo se lee en un reporte. La línea de base dice que lo es. */
export function rotuloDePieza(p: Procedencia): string {
  return esAMano(p) ? "escrito a mano (la línea de base)" : `${p.clase} · ${p.ref}`;
}

/** La forma en que la procedencia vive en `envios_wa` (cinco columnas anexas). */
export interface ColumnasDeProcedencia {
  piezaClase: string | null;
  piezaRef: string | null;
  piezaVia: string | null;
  piezaEditada: boolean;
  momentoVenta: string | null;
}

export function columnasDeProcedencia(p: Procedencia): ColumnasDeProcedencia {
  if (esAMano(p)) {
    return {
      piezaClase: null,
      piezaRef: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: p.momento,
    };
  }
  return {
    piezaClase: p.clase,
    piezaRef: p.ref,
    piezaVia: p.via,
    piezaEditada: p.editada,
    momentoVenta: p.momento,
  };
}

function esClase(v: string | null): v is ClasePieza {
  return v !== null && (CLASES_DE_PIEZA as readonly string[]).includes(v);
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
  if (!esClase(c.piezaClase) || !c.piezaRef || !esVia(c.piezaVia)) return aMano(momento);
  return {
    tipo: "pieza",
    clase: c.piezaClase,
    ref: c.piezaRef,
    via: c.piezaVia,
    editada: c.piezaEditada,
    momento,
  };
}
