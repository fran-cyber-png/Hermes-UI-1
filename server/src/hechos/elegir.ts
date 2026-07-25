import type { MomentoDeVenta } from "../sugerencias/estado.js";
import type { Hecho } from "./catalogo.js";

/**
 * QUÉ DATOS RECORDARLE EN ESTE MOMENTO — puro, para poder discutirlo con un test.
 *
 * La cabeza que decide dónde está la conversación es UNA sola y ya existe:
 * `momentoDeVenta()` de `sugerencias/estado.ts`, la misma que elige las dos
 * secuencias del panel y el acuse de la auto-respuesta nocturna. Acá no se
 * vuelve a clasificar nada: se filtra el catálogo por ese momento.
 *
 * **Tope de tres.** El bloque vive arriba de las pestañas en un panel de 360 px:
 * siete chips serían un menú, y un menú es exactamente lo que la vendedora no
 * mira mientras escribe. Tres se leen de un vistazo.
 *
 * Un hecho **sin momentos** vale para todos: es el default deliberado para lo
 * que el dueño agregue sin querer pensar en dónde va.
 */

export const TOPE_HECHOS = 3;

export function elegirHechos(
  catalogo: readonly Hecho[],
  momento: MomentoDeVenta,
  tope: number = TOPE_HECHOS,
): Hecho[] {
  return catalogo
    .filter((h) => h.momentos.length === 0 || h.momentos.includes(momento))
    .slice()
    .sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave))
    .slice(0, tope);
}
