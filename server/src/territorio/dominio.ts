/**
 * EL TERRITORIO, LA PARTE QUE NO TOCA LA BASE (ADR 0063).
 *
 * Puro y con tests: la normalización del nombre y la lectura de un distrito son
 * lo que decide si dos filas son el mismo lugar, y eso no puede vivir adentro de
 * una consulta.
 */

/** Un distrito del catálogo de una campaña. */
export interface Distrito {
  id: number;
  nombre: string;
  zona: string | null;
  orden: number;
}

/**
 * LA LLAVE DE UN DISTRITO — `lower(btrim(nombre))`, la MISMA receta que el índice
 * único de la tabla.
 *
 * 🔴 **Tiene que decir exactamente lo mismo que el `UNIQUE`**, o el catálogo
 * acepta desde la app un nombre que la base va a rechazar (o al revés, que es
 * peor: dos filas «San Isidro» y «san isidro» que en la pantalla se ven iguales,
 * con la campaña repartiendo su gente entre las dos). Es la misma clase de
 * cicatriz que `Luz`/`luz` en `numero_vendedora`, y se cierra igual:
 * normalizando de los DOS lados.
 */
export function claveDistrito(nombre: string): string {
  return nombre.trim().toLowerCase();
}

/**
 * ¿Este nombre sirve como distrito? Devuelve el motivo, o `null` si está bien.
 *
 * ⚠️ **No se «arregla» un nombre feo, se rechaza.** Un `trim` silencioso está
 * bien —es el mismo lugar—, pero recortar un nombre de 300 caracteres o tragarse
 * uno vacío escribe una fila que después nadie puede identificar en el selector.
 */
export function motivoParaNoAceptar(nombre: string): string | null {
  const limpio = nombre.trim();
  if (!limpio) return "el nombre no puede estar vacío";
  if (limpio.length > 80) return "el nombre no puede pasar de 80 caracteres";
  return null;
}

/**
 * EL ORDEN EN QUE SE OFRECE EL CATÁLOGO: por `orden`, y a igualdad por nombre.
 *
 * ⚠️ **El desempate por nombre NO es cosmético.** Con `orden` en 0 para todos
 * —que es el default y el caso normal al sembrar un catálogo— sin desempate el
 * orden lo pondría la base, que no lo promete: el selector cambiaría de orden
 * entre dos aperturas y la operadora tendría que volver a buscar cada vez.
 *
 * `localeCompare('es')` y no `<`: sin él «Áncash» cae después de «Zarumilla».
 */
export function ordenarDistritos(distritos: readonly Distrito[]): Distrito[] {
  return [...distritos].sort(
    (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"),
  );
}

/**
 * ¿ESTE DISTRITO ES DE ESTE CATÁLOGO? — la guarda que impide plantar territorio
 * en la campaña de al lado.
 *
 * 🔴 **Se verifica el DESTINO, no se confía en el id que mandó el navegador.**
 * Es la misma lección de `reparto/destino.ts` y de `padron/destinos.ts`: un
 * `distritoId` de otra campaña es un número válido, escribe una fila válida, y
 * nadie se entera — la persona quedaría anotada en un distrito que su propia
 * pantalla no puede mostrar, y del otro lado aparecería en un conteo ajeno.
 *
 * Hoy hay UNA campaña y esto no puede pasar; se escribe igual porque el día que
 * haya dos, la puerta ya va a estar cerrada. Ver ADR 0063 §fase 3.
 */
export function distritoAjeno(
  distritoId: number,
  catalogo: readonly Distrito[],
): boolean {
  return !catalogo.some((d) => d.id === distritoId);
}
