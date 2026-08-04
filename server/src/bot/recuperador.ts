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
import type { ClaseQueElBotManda } from "./acciones.js";

/**
 * EL ENFOQUE DEL BOT, HOY: UN SOLO PRODUCTO.
 *
 * ⚠️ **ACÁ DECÍA `DIPCINTE` Y ERA OTRO PRODUCTO.** Verificado contra el catálogo
 * vivo de Cerberus el 1-ago-2026:
 *
 *   · **`DIPICOT`** = Diploma de Especialización en **Inteligencia y
 *     Contrainteligencia** — 14 ediciones activas, USD 250 / promo USD 150.
 *     Es el producto del bot.
 *   · `DIPCINTE` = Diploma Internacional en **Ciberinteligencia y Ciberdefensa**
 *     — USD 100. Otro producto, otro precio.
 *
 * El alias de producción ya mapeaba bien («inteligencia y contrainteligencia» →
 * `DIPICOT`), así que el interés que llegaba del anuncio y el catálogo que el
 * bot filtraba **eran de dos productos distintos**. La única pieza aprobada
 * entraba de casualidad, por tener mal la familia en la base.
 *
 * ⚠️ **ESTE CAMBIO NO VA SOLO**: la fila de `plantillas` de la pieza de
 * Inteligencia tiene `familia_curso = 'DIPCINTE'` y hay que corregirla en la
 * misma ventana. Si el código pasa a DIPICOT y la base sigue en DIPCINTE, el
 * bot se queda **sin una sola pieza que mandar**. Ver `docs/plan-bot-dipicot.md`
 * §5 F0.5.
 *
 * Las piezas con `familia === null` («sirve para cualquier curso», como los
 * hechos) entran igual; las de cualquier otra familia quedan afuera hasta que el
 * dueño amplíe el foco.
 *
 * ── Configurable, no clavado ─────────────────────────────────────────────
 *
 * `BOT_FAMILIA_ENFOQUE` permite cambiarlo sin tocar código. Es un paso
 * intermedio honesto: la casa definitiva de este valor es una columna de
 * `bot_estado` (enfoque POR LÍNEA, editable desde la app), y eso es F3 del plan
 * porque pide migración. Mientras tanto el default es el producto correcto.
 */
export const ENFOQUE_POR_DEFECTO = "DIPICOT";

export const ENFOQUE_PRODUCTO: string =
  process.env.BOT_FAMILIA_ENFOQUE?.trim().toUpperCase() || ENFOQUE_POR_DEFECTO;

/**
 * Las clases que el bot conversacional puede mandar. Los acuses (auto-respuesta
 * fuera de horario) y los ganchos (fragmentos que completan una plantilla de
 * acuse) son de OTRO frente: darle al bot la opción de mandar un «gracias por
 * escribirnos» en mitad de una conversación sería mezclar dos canales.
 */
const CLASES_QUE_MANDA_EL_BOT = ["plantilla", "hecho"] as const satisfies readonly ClaseQueElBotManda[];

/**
 * El filtro y el TIPO dicen lo mismo, y eso no es adorno: sin el predicado, el
 * runtime ya excluía `hsm` pero el tipo seguía admitiéndolo, así que el día que
 * alguien tocara la lista el compilador no iba a decir nada. Con `satisfies` +
 * predicado, agregar una clase obliga a decidir si el bot la puede mandar.
 */
function elBotLaPuedeMandar(p: Pieza): p is Pieza & { clase: ClaseQueElBotManda } {
  return (CLASES_QUE_MANDA_EL_BOT as readonly string[]).includes(p.clase);
}

/**
 * Del catálogo entero, lo que el bot puede ver en este turno.
 *
 * `enviable` viaja tal cual: el prompt solo lista lo enviable y la tool
 * `mandar_pieza` rechaza lo que no lo es — una plantilla aprobada pero con
 * media pendiente se ve pero no se manda.
 */
export function piezasParaElBot(piezas: Pieza[], enfoque: string): ResumenPieza[] {
  return piezas
    .filter(elBotLaPuedeMandar)
    .filter((p) => p.familia === null || p.familia.valor === enfoque)
    .map((p) => ({
      clase: p.clase,
      id: p.id,
      descripcion: p.rotulo,
      enviable: p.enviable,
    }));
}
