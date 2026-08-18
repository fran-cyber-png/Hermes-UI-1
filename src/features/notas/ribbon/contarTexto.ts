/**
 * PALABRAS Y CARACTERES — puro, y con una advertencia que hay que leer.
 *
 * ══ 🔴 ESTE NÚMERO **NO** ES EL QUE EL SERVER VALIDA, Y NO SE PUEDE FINGIR ══
 *
 * La página tiene un tope duro de `LIMITE_TEXTO` (20.000), pero **el largo que
 * se compara contra ese tope lo deriva el SERVER**: `aTextoPlano`
 * (`server/src/notas/textoPlano.ts`, ~260 líneas) camina el `doc` y arma el
 * texto que se guarda en `notas.texto`, con sus separadores entre bloques, sus
 * celdas de tabla y sus listas anidadas.
 *
 * Escribir esa misma derivación acá para poder dibujar «19.847 / 20.000» sería
 * **exactamente #37**: dos implementaciones del mismo hecho, y la del navegador
 * se enteraría tarde de cualquier cambio. Un contador que dice «te quedan 150»
 * cuando el server ya cuenta 20.100 es peor que no tener contador — porque se
 * le cree.
 *
 * Así que esto contesta **«¿cuánto escribí?»** y no «¿cuánto me falta para el
 * tope?». La segunda pregunta la contesta el server cuando rebota el guardado, y
 * `guardado.ts` ya tiene su lectura para ese 400.
 *
 * ⚠️ El texto de entrada sale de ProseMirror (`doc.textBetween`), que es lo que
 * el editor tiene de verdad — no un recorrido nuestro del `doc`.
 */

export interface Conteo {
  palabras: number;
  caracteres: number;
}

/**
 * ⚠️ **Una palabra es una corrida de lo que no es espacio.** Es la misma
 * definición que usa Word, y es la única que no hay que discutir: contar por
 * `\w` dejaría afuera «email@goberna.us» partido en dos y «S/. 1.200» en tres.
 */
export function contarTexto(texto: string): Conteo {
  const limpio = texto.trim();
  return {
    palabras: limpio.length === 0 ? 0 : limpio.split(/\s+/).length,
    // Los caracteres se cuentan SIN recortar: los espacios que alguien escribió
    // ocupan lugar en la página igual que las letras.
    caracteres: texto.length,
  };
}

/** «1.234 palabras · 6.789 caracteres», con los miles como se leen en Perú. */
export function leerConteo({ palabras, caracteres }: Conteo): string {
  const n = (v: number) => v.toLocaleString('es-PE');
  return `${n(palabras)} ${palabras === 1 ? 'palabra' : 'palabras'} · ${n(caracteres)} ${
    caracteres === 1 ? 'caracter' : 'caracteres'
  }`;
}
