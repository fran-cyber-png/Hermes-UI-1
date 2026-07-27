import { refDeDireccion, type ClasePieza } from "../piezas/direccion.js";
import {
  versionDeUnMensaje,
  versionDeUnaSecuencia,
  type ContenidoDePieza,
} from "../piezas/version.js";
import {
  marcadoresDe,
  type EstadoPieza,
  type FamiliaDePieza,
  type PasoDePieza,
  type Pieza,
} from "./pieza.js";

/**
 * ARMAR UNA PIEZA — el único lugar donde se construye una.
 *
 * ══ POR QUÉ ESTÁ SEPARADO DEL REPOSITORIO ═══════════════════════════════════
 *
 * Las piezas nacen en dos lados que no se parecen: dos vienen de tablas
 * (`plantillas` + `plantilla_pasos`, `hechos`) y dos viven en código (los acuses
 * de la auto-respuesta y los ganchos por familia). Si cada lado se arma su
 * `Pieza`, cada lado calcula su versión — y ya sabemos cómo termina eso: con dos
 * recetas que hoy coinciden y mañana no.
 *
 * Acá está la construcción, pura y sin base. `repositorio.ts` traduce filas a
 * estos argumentos y `codigo.ts` traduce constantes; **ninguno de los dos toca
 * `versionDeContenido`**. Y como es puro, `paridad.test.ts` puede afirmar contra
 * los vectores compartidos sin levantar una Postgres.
 *
 * ══ LA VERSIÓN LA CALCULA `piezas/version.ts` ═══════════════════════════════
 *
 * No hay una segunda receta ni «una copia que hace lo mismo». Es la misma
 * función con la que el lazo (ADR 0022) estampa la pieza en `envios_wa`, porque
 * el valor de los dos frentes está en el join entre lo que Ivi recomienda y lo
 * que efectivamente se mandó. Con dos recetas ese join da cero filas **en
 * silencio**, y eso se lee como «esa pieza no se usó nunca».
 *
 * ══ QUÉ ENTRA EN LA VERSIÓN ═════════════════════════════════════════════════
 *
 * Solo lo que SALE hacia la persona: el texto y **el archivo adjunto** — el
 * archivo, no la clase de media. Hashear `media_clase` (la cadena `"imagen"`)
 * dejaba la versión clavada mientras el flyer cambiaba, y en Goberna el precio y
 * las fechas viven adentro del flyer.
 *
 * El `rotulo` queda afuera a propósito: renombrar una etiqueta interna no es un
 * texto nuevo, y si contara, el lazo partiría el historial de una pieza porque
 * alguien le arregló una tilde al nombre que ve la vendedora.
 */

/** Lo común a toda pieza, venga de una tabla o de una constante. */
interface Comun {
  id: string;
  /** Nombre corto para un humano. NO entra en la versión. */
  rotulo: string;
  estado?: EstadoPieza;
  alcance?: Pieza["alcance"];
  propietario?: string | null;
  momentos?: readonly string[];
  familia?: FamiliaDePieza | null;
  /**
   * Por qué NO se puede mandar. Ausente o `null` = se puede.
   *
   * Es un solo campo y no dos porque `enviable` se deriva de él: dos campos
   * independientes permiten la combinación imposible («enviable: true, motivo:
   * media_pendiente») y alguien la escribiría alguna vez.
   *
   * Lo que garantiza en una secuencia, exactamente: **declarar un motivo no
   * puede volver enviable a nada**. `enviable` se deriva de `motivo === null`, y
   * el `??` solo deja pasar el `null` — o sea que un motivo declarado bloquea, y
   * un `null` declarado cae en las guardas que se calculan solas (no vigente,
   * media pendiente). Nadie puede declarar enviable una plantilla a la que le
   * falta el flyer.
   *
   * Lo que NO garantiza, y acá decía que sí («**agrega** un motivo, no lo
   * quita»): un motivo declarado **reemplaza** la CADENA del motivo calculado.
   * Si alguien pasara `"no_vigente"` sobre una plantilla que además tiene la
   * imagen pendiente, el catálogo diría `no_vigente` y no `media_pendiente`. Las
   * dos bloquean, así que no hay agujero — pero el que se reporta es uno solo, y
   * hoy ningún llamador pasa este campo a `piezaDeUnaSecuencia`.
   */
  motivoNoEnviable?: Pieza["motivoNoEnviable"];
}

/** Una pieza que es UN mensaje: un hecho, un acuse, un gancho. */
export function piezaDeUnMensaje(
  o: Comun & { clase: Exclude<ClasePieza, "plantilla">; contenido: ContenidoDePieza },
): Pieza {
  const texto = o.contenido.texto ?? "";
  const { placeholders, sintaxis } = marcadoresDe(texto);
  const motivo = o.motivoNoEnviable ?? null;
  return {
    clase: o.clase,
    id: refDeDireccion({ clase: o.clase, id: o.id }),
    version: versionDeUnMensaje(o.contenido),
    estado: o.estado ?? "vigente",
    alcance: o.alcance ?? "negocio",
    propietario: o.propietario ?? null,
    rotulo: o.rotulo,
    texto,
    momentos: [...(o.momentos ?? [])],
    familia: o.familia ?? null,
    pasos: null,
    placeholders,
    sintaxisPlaceholder: sintaxis,
    enviable: motivo === null,
    motivoNoEnviable: motivo,
  };
}

/** Un paso tal como vive en la tabla, antes de volverse `PasoDePieza`. */
export interface PasoCrudo {
  orden: number;
  texto: string | null;
  /** `imagen`, `documento`… `null` = paso de solo texto. */
  mediaClase: string | null;
  /** El nombre del archivo en `RUTA_MEDIA`. Es lo que ENTRA en la versión. */
  mediaArchivo: string | null;
}

/** El contenido autoral de un paso: lo que se hashea. */
function contenidoDelPaso(p: PasoCrudo): ContenidoDePieza {
  return { texto: p.texto, archivo: p.mediaArchivo };
}

/**
 * Una plantilla-secuencia, con sus pasos.
 *
 * **Cada paso publica su propia versión**, y no es un lujo: el lazo estampa
 * `plantilla:12#3` con la versión de ESE paso, así que si el catálogo solo
 * publicara la de la secuencia entera, lo que quedó escrito en `envios_wa` no
 * aparecería en ninguna parte del catálogo. El join volvería a dar cero, más
 * disimulado.
 *
 * Y el paso no es una pieza suelta con id propio porque `plantilla_pasos.id` no
 * es estable (`escribirPasos()` borra todos los pasos y los reinserta en cada
 * edición). Se direcciona **dentro** de su plantilla, con `(id, orden)` — la
 * misma forma que Ivi ya usa en su contrato de ensamblado.
 */
export function piezaDeUnaSecuencia(o: Comun & { pasos: readonly PasoCrudo[] }): Pieza {
  const pasos: PasoDePieza[] = o.pasos.map((p) => ({
    orden: p.orden,
    texto: p.texto,
    mediaClase: p.mediaClase,
    // El paso pide una imagen que todavía nadie cargó: es el estado natural de
    // una propuesta minada (el histórico sabe QUE ahí iba el flyer, no cuál).
    mediaPendiente: !p.mediaArchivo && p.mediaClase !== null,
    version: versionDeUnMensaje(contenidoDelPaso(p)),
  }));

  const texto = pasos
    .map((p) => p.texto ?? "")
    .filter((t) => t.length > 0)
    .join("\n\n");
  const { placeholders, sintaxis } = marcadoresDe(texto);

  const estado = o.estado ?? "vigente";
  const mediaPendiente = pasos.some((p) => p.mediaPendiente);
  const motivo =
    o.motivoNoEnviable ??
    (estado !== "vigente" ? "no_vigente" : mediaPendiente ? "media_pendiente" : null);

  return {
    clase: "plantilla",
    id: refDeDireccion({ clase: "plantilla", id: o.id }),
    version: versionDeUnaSecuencia(o.pasos.map(contenidoDelPaso)),
    estado,
    alcance: o.alcance ?? "negocio",
    propietario: o.propietario ?? null,
    rotulo: o.rotulo,
    texto,
    momentos: [...(o.momentos ?? [])],
    familia: o.familia ?? null,
    pasos,
    placeholders,
    sintaxisPlaceholder: sintaxis,
    enviable: motivo === null,
    motivoNoEnviable: motivo,
  };
}
