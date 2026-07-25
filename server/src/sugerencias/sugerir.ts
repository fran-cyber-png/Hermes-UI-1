import type { Plantilla } from "../plantillas/repositorio.js";
import { esEnviable, intencionesDePlantilla } from "./clasificar.js";
import { intencionesSugeridas, ROTULO_INTENCION, type EstadoDeVenta, type Intencion } from "./estado.js";

/**
 * LAS DOS RESPUESTAS DEL PANEL — «dejame a la derecha preparado para yo con un
 * clic mandarle al lead la respuesta: 2 opciones» (dueño, 2026-07-25).
 *
 * No es un buscador: es **la decisión ya tomada, con dos caminos**. La cabeza
 * que decide es `estado.ts` (la misma que la auto-respuesta de #125); acá solo
 * se traduce «qué corresponde» a «cuál de tus secuencias hace eso».
 *
 * ══ SI NO HAY, NO SE INVENTA ═════════════════════════════════════════════════
 *
 * Cuando ninguna plantilla cubre lo que corresponde, esto devuelve **menos de
 * dos, o ninguna**, y el panel muestra el acceso a las secuencias completas.
 * Rellenar con cualquier cosa para que siempre haya dos botones sería peor que
 * no tener botones: la vendedora dejaría de confiar en el primero.
 */

export interface Sugerencia {
  plantilla: Plantilla;
  intencion: Intencion;
  /** Qué es esto, en dos palabras: «Pasar el precio». */
  rotulo: string;
  /** Por qué corresponde ahora: «le pasaste el precio y no contestó». */
  porque: string;
}

/** La mejor plantilla para una intención: la más usada que la cubra. */
function mejorPara(
  intencion: Intencion,
  candidatas: readonly Plantilla[],
  yaElegidas: ReadonlySet<number>,
): Plantilla | null {
  const aptas = candidatas
    .filter((p) => !yaElegidas.has(p.id) && intencionesDePlantilla(p).has(intencion))
    // Más usada primero; a igual uso, la más respaldada por el histórico.
    .sort((a, b) => b.usos - a.usos || b.respaldo - a.respaldo || a.nombre.localeCompare(b.nombre, "es"));
  return aptas[0] ?? null;
}

/**
 * Hasta DOS sugerencias, en orden, con caminos distintos. Devuelve menos si el
 * catálogo de la vendedora no da para más.
 */
export function sugerirDos(estado: EstadoDeVenta, plantillas: readonly Plantilla[]): Sugerencia[] {
  const enviables = plantillas.filter(esEnviable);
  if (enviables.length === 0) return [];

  const quiere = intencionesSugeridas(estado);
  const elegidas = new Set<number>();
  const salida: Sugerencia[] = [];

  for (const s of quiere) {
    const p = mejorPara(s.intencion, enviables, elegidas);
    if (!p) continue;
    elegidas.add(p.id);
    salida.push({
      plantilla: p,
      intencion: s.intencion,
      rotulo: ROTULO_INTENCION[s.intencion],
      porque: s.porque,
    });
  }

  // Una sola coincidencia: se completa con la secuencia más usada que quede,
  // porque tener una segunda opción distinta es el punto. Pero solo si es OTRA
  // plantilla — nunca la misma dos veces con distinto rótulo.
  if (salida.length === 1) {
    const resto = enviables
      .filter((p) => !elegidas.has(p.id))
      .sort((a, b) => b.usos - a.usos || b.respaldo - a.respaldo);
    const p = resto[0];
    if (p) {
      const intencion = [...intencionesDePlantilla(p)][0];
      salida.push({
        plantilla: p,
        intencion,
        rotulo: ROTULO_INTENCION[intencion],
        porque: "tu secuencia más usada",
      });
    }
  }

  return salida;
}
