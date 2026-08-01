/**
 * RECUPERADOR — qué conocimiento entra al prompt del bot (Fase 3, acotada).
 *
 * El bot conversa con el catálogo a la vista: `mandar_pieza` necesita que la
 * pieza exista en su lista para poder agendarla. Hoy el dueño quiere enfocar el
 * aprendizaje en UN producto (Inteligencia y Contrainteligencia), así que este
 * módulo filtra el catálogo completo a ese alcance y nada más.
 *
 * El filtro es PURO a propósito: se puede interrogar con un test sin base ni
 * red, y es la única cabeza que decide qué ve el bot — si el prompt o las tools
 * filtraran por su cuenta, tendríamos dos implementaciones que pueden divergir
 * (la lección de #37).
 */

import type { Pieza } from "../catalogo/pieza.js";
import type { ResumenPieza } from "./acciones.js";

/**
 * EL ENFOQUE DEL BOT, HOY: UN SOLO PRODUCTO.
 *
 * `DIPCINTE` = Diploma de Inteligencia y Contrainteligencia. Las piezas con
 * `familia === null` («sirve para cualquier curso», como los hechos) entran
 * igual; las de cualquier otra familia quedan afuera hasta que el dueño
 * amplíe el foco.
 */
export const ENFOQUE_PRODUCTO = "DIPCINTE";

/**
 * Las clases que el bot conversacional puede mandar. Los acuses (auto-respuesta
 * fuera de horario) y los ganchos (fragmentos que completan una plantilla de
 * acuse) son de OTRO frente: darle al bot la opción de mandar un «gracias por
 * escribirnos» en mitad de una conversación sería mezclar dos canales.
 */
const CLASES_QUE_MANDA_EL_BOT = new Set(["plantilla", "hecho"]);

/**
 * Del catálogo entero, lo que el bot puede ver en este turno.
 *
 * `enviable` viaja tal cual: el prompt solo lista lo enviable y la tool
 * `mandar_pieza` rechaza lo que no lo es — una plantilla aprobada pero con
 * media pendiente se ve pero no se manda.
 */
export function piezasParaElBot(piezas: Pieza[], enfoque: string): ResumenPieza[] {
  return piezas
    .filter((p) => CLASES_QUE_MANDA_EL_BOT.has(p.clase))
    .filter((p) => p.familia === null || p.familia.valor === enfoque)
    .map((p) => ({
      clase: p.clase,
      id: p.id,
      descripcion: p.rotulo,
      enviable: p.enviable,
    }));
}
