import type { RolResuelto } from "../equipo/cascada.js";
import type { Rol } from "../equipo/roles.js";

/**
 * EL ROL DE QUIEN PIDE, PARA UN TEST — el andamio que reemplazó al `process.env`.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * Hasta D4, decir «esta consulta la hace una supervisora» en un test con base era
 * escribir `process.env.HERMES_SUPERVISORES = "jefa"` con su `t.after` para
 * devolverlo. Estaba en CINCO archivos, y sus propios docblocks lo llamaban
 * transitorio. El problema no era la prolijidad: `process.env` es **estado global
 * del proceso**, y `node:test` corre los archivos en paralelo, así que un
 * `t.after` que corre tarde le cambia el rol a otro archivo — un test que falla
 * una vez de cada veinte y no se puede reproducir.
 *
 * Ahora el rol viaja como TERCER PARÁMETRO de `consultarCola`, resuelto por
 * `cargarRol` en producción y armado acá en los tests. Es la misma forma que ya
 * usa el Dashboard (`recorteDelDashboard(id, rolDe(req).rol)`).
 *
 * ⚠️ **No se construye un `RolResuelto` a mano en cada test.** La forma tiene
 * cinco banderas y dos de ellas —`sinTablaDeEquipo` y `rolNoResuelto`— significan
 * cosas OPUESTAS para la frontera (`equipo/cascada.ts`): la primera la apaga y la
 * segunda la deja puesta. Un literal escrito de memoria en cada archivo es la
 * forma más corta de fijar la rama equivocada sin notarlo.
 */

/** Como si la tabla `equipo` tuviera su fila con este rol. El caso normal. */
export function comoRol(rol: Rol, personaId = ""): RolResuelto {
  return {
    personaId,
    rol,
    fuente: "tabla",
    porBreakGlass: false,
    sinTablaDeEquipo: false,
    rolNoResuelto: false,
    desactivada: false,
  };
}

/** Atiende su cola. Es el default de `consultarCola`, y se escribe igual. */
export const COMO_VENDEDORA: RolResuelto = comoRol("vendedora");

/** Manda sobre el trabajo de las demás: ve la mesa entera, sin frontera. */
export const COMO_SUPERVISORA: RolResuelto = comoRol("supervisor");

/**
 * LA MIGRACIÓN DE `equipo` TODAVÍA NO ESTÁ — y eso **apaga** la frontera.
 *
 * Es la ventana entre N4 y N5 de un deploy. Sin tabla no hay de dónde sacar el
 * rol de nadie, así que la cola se comporta como antes del frente en vez de
 * recortar a todo el mundo a sus asignadas. No es lo mismo que un blip de la
 * base, que sí deja la frontera puesta (ver `equipo/cascada.ts`).
 */
export const SIN_TABLA_DE_EQUIPO: RolResuelto = {
  ...comoRol("vendedora"),
  fuente: "default",
  sinTablaDeEquipo: true,
};
