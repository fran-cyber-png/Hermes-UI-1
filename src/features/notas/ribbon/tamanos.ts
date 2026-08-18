import { TAMANO_POR_DEFECTO } from '../estilosDeTexto';

/**
 * LOS TAMAÑOS DE LETRA — la lista y el paso, en un módulo puro.
 *
 * Vivían adentro de `BarraDeFormato.tsx` porque el único que los usaba era su
 * selector. Ahora los usan tres cosas —el selector, «Agrandar» y «Achicar»— y
 * con una copia por consumidor el botón subiría a un tamaño que la lista no
 * ofrece, o al revés. Es la forma de #37 en su versión chica.
 *
 * ⚠️ **El rango 6–200 no es decorativo**: un `fontSize: 0` o uno de 5.000 px no
 * es un tamaño, es una página rota que después hay que ir a arreglar a mano en
 * el `jsonb`. Fuera de rango no se aplica nada.
 */

/** Los que se ofrecen en la lista. Escribir un número acepta cualquiera del rango. */
export const TAMANOS_SUGERIDOS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72] as const;
export const TAMANO_MIN = 6;
export const TAMANO_MAX = 200;

/**
 * Lee el tamaño que hay puesto. **Sin estilo, devuelve el del papel** —no cero,
 * no `null`—: es lo que el texto MIDE de verdad (`index.css` fija 16 px), así
 * que es desde ahí que tiene que arrancar «Agrandar».
 */
export function leerTamano(valor: unknown): number {
  if (typeof valor !== 'string') return TAMANO_POR_DEFECTO;
  const n = Number.parseFloat(valor);
  return Number.isFinite(n) && n > 0 ? n : TAMANO_POR_DEFECTO;
}

/**
 * El escalón siguiente hacia arriba o hacia abajo.
 *
 * Camina la lista de sugeridos, no suma un número fijo: de 8 a 9 el salto útil
 * es 1 y de 48 a 72 es 24, y con un `+2` fijo llegar a un título grande son
 * doce clics. Un tamaño escrito a mano que no está en la lista (15) salta al
 * sugerido más cercano en esa dirección, nunca a uno del otro lado.
 *
 * Devuelve `null` cuando ya está en el extremo: no hay a dónde ir, y el llamador
 * no tiene que aplicar nada.
 */
export function siguienteTamano(actual: number, direccion: 1 | -1): number | null {
  const lista = TAMANOS_SUGERIDOS;
  if (direccion === 1) {
    const arriba = lista.find((n) => n > actual);
    if (arriba !== undefined) return arriba;
    return actual < TAMANO_MAX ? TAMANO_MAX : null;
  }
  const abajo = [...lista].reverse().find((n) => n < actual);
  if (abajo !== undefined) return abajo;
  return actual > TAMANO_MIN ? TAMANO_MIN : null;
}

/** Un número tecleado a mano, acotado. `null` = no vale, no se aplica nada. */
export function tamanoLibre(texto: string): string | null {
  const n = Number(texto.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < TAMANO_MIN || n > TAMANO_MAX) return null;
  return `${n}px`;
}
