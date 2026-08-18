/**
 * QUÉ EXPLICA EL RÓTULO DE LA COLA — el texto, puro y en un archivo propio.
 *
 * Vive fuera de `RotuloDeLaCola.tsx` por dos motivos, y el segundo es el que
 * obliga: un archivo de componentes que además exporta una función se lleva un
 * warning de fast-refresh (`only-export-components`), y sobre todo **esto no es
 * pintura, es la afirmación que la pantalla hace sobre de quién es lo que se
 * está viendo** — la clase de regla que el repo tiene en `.ts` puro y con test
 * (`canales/dueno.ts`, `ivi/presentacion.ts`), no adentro del JSX.
 *
 * ⚠️ **Un `title` no sale en una captura**, así que la galería tiene que
 * imprimirlo al lado; y una galería que imprime una paráfrasis del texto real no
 * es evidencia de nada — es dos redacciones que divergen el día que alguien
 * mejore una (#37). Por eso el texto vive acá, una sola vez, y los dos lo leen.
 */
export function explicacionDelRotulo(recortada?: boolean, lineaPropia?: boolean): string | undefined {
  if (!recortada) return undefined;
  return lineaPropia
    ? 'Es tu cola: todo lo que entra por tu línea, más lo que te asignen en las otras. Lo de las demás líneas no se muestra acá.'
    : 'Es tu cola: lo que te tocó a vos y lo que todavía no tiene dueña. Lo que se repartió a otra persona no se muestra acá.';
}
