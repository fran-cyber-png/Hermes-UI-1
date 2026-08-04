import { MOMENTOS_DE_VENTA, type MomentoDeVenta } from "../sugerencias/estado.js";
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

/**
 * QUÉ LLEGA A VERSE EN CADA MOMENTO — la misma decisión de arriba, corrida seis
 * veces, una por momento.
 *
 * ── Por qué existe ──
 * Medido el 4-ago-2026 en producción: el catálogo tiene **27 datos activos** y
 * el panel muestra **3**. Además 21 de los 27 tienen `momentos = []` («vale para
 * todos») y las 13 frases de plata quedaron con `orden = 100`, que es el default
 * del schema — así que las de precio y las de dónde pagar **no aparecen nunca**.
 * Mirando la lista eso no se ve: hay que correr el recorte para saberlo.
 *
 * ── Por qué vive ACÁ y no en el navegador ──
 * Es la MISMA regla que decide qué chips salen en el panel. Implementarla otra
 * vez del lado del cliente daría dos cabezas que se separan sin que nada falle:
 * la pantalla de edición diría «esto se ve» y la vendedora no lo vería. Es
 * exactamente la lección de #37, y por eso la vista previa viaja calculada.
 *
 * Devuelve **claves**, no hechos: quien la consume ya tiene el catálogo entero.
 */
export function vistaPreviaPorMomento(
  catalogo: readonly Hecho[],
  tope: number = TOPE_HECHOS,
): Record<MomentoDeVenta, string[]> {
  const salida = {} as Record<MomentoDeVenta, string[]>;
  for (const momento of MOMENTOS_DE_VENTA) {
    salida[momento] = elegirHechos(catalogo, momento, tope).map((h) => h.clave);
  }
  return salida;
}
