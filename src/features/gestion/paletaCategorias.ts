/**
 * LA PALETA DE CATEGORÍAS EN EL FRONT — el reflejo de `server/categorias/paleta.ts`.
 *
 * Server y front son paquetes separados (no se importan cruzado), así que la
 * lista de colores vive dos veces; los tests fijan que ninguna se cuele oro. Acá
 * además está el MAPA de clase de borde por color — literales completos a
 * propósito: Tailwind v4 escanea el código en busca de clases, y un
 * `border-cat-${color}` armado en runtime no lo vería. Los HEX viven en
 * `src/index.css` como `--cat-*`.
 *
 * Regla dura de la casa: la píldora de categoría usa BORDE de color, nunca
 * sombra (sombra o borde, jamás ambos) y jamás oro (el oro es tiempo que se
 * acaba). Una etiqueta cuyo string no matchea ninguna categoría del que mira se
 * pinta NEUTRA (`border-border`).
 */

export const COLORES = ['pizarra', 'rojo', 'naranja', 'verde', 'azul', 'cian', 'morado', 'rosa'] as const;

export type ColorCategoria = (typeof COLORES)[number];

export function esColorCategoria(x: unknown): x is ColorCategoria {
  return typeof x === 'string' && (COLORES as readonly string[]).includes(x);
}

/** Mismo criterio que el server: es la clave de join contra la asignación. */
export function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase().slice(0, 30);
}

/** Nombre humano de cada color, para el `title`/`aria-label` de cada swatch. */
export const NOMBRE_COLOR: Record<ColorCategoria, string> = {
  pizarra: 'Pizarra',
  rojo: 'Rojo',
  naranja: 'Naranja',
  verde: 'Verde',
  azul: 'Azul',
  cian: 'Cian',
  morado: 'Morado',
  rosa: 'Rosa',
};

/** Clase de BORDE por color (la píldora asignada). Literales completos: Tailwind los escanea. */
export const CLASE_BORDE: Record<ColorCategoria, string> = {
  pizarra: 'border-cat-pizarra',
  rojo: 'border-cat-rojo',
  naranja: 'border-cat-naranja',
  verde: 'border-cat-verde',
  azul: 'border-cat-azul',
  cian: 'border-cat-cian',
  morado: 'border-cat-morado',
  rosa: 'border-cat-rosa',
};

/** Clase de TEXTO por color (el nombre dentro de la píldora, en su color). */
export const CLASE_TEXTO: Record<ColorCategoria, string> = {
  pizarra: 'text-cat-pizarra',
  rojo: 'text-cat-rojo',
  naranja: 'text-cat-naranja',
  verde: 'text-cat-verde',
  azul: 'text-cat-azul',
  cian: 'text-cat-cian',
  morado: 'text-cat-morado',
  rosa: 'text-cat-rosa',
};

/** Clase de FONDO por color (los swatches del selector). */
export const CLASE_FONDO: Record<ColorCategoria, string> = {
  pizarra: 'bg-cat-pizarra',
  rojo: 'bg-cat-rojo',
  naranja: 'bg-cat-naranja',
  verde: 'bg-cat-verde',
  azul: 'bg-cat-azul',
  cian: 'bg-cat-cian',
  morado: 'bg-cat-morado',
  rosa: 'bg-cat-rosa',
};

/** El borde neutro para una etiqueta sin categoría del que mira. */
export const CLASE_BORDE_NEUTRO = 'border-border';

/**
 * Resuelve el string de una etiqueta AL COLOR DE QUIEN MIRA: busca en su catálogo
 * una categoría cuyo nombre coincida (ya normalizado) y devuelve su color, o
 * `null` si no matchea ninguna (→ neutra).
 */
export function resolverColor(
  etiqueta: string,
  categorias: readonly { nombre: string; color: string }[],
): ColorCategoria | null {
  const nombre = normalizarNombre(etiqueta);
  const match = categorias.find((c) => c.nombre === nombre);
  return match && esColorCategoria(match.color) ? match.color : null;
}

/** La clase de borde de la píldora: el color del que mira, o neutro. */
export function claseBorde(color: ColorCategoria | null): string {
  return color ? CLASE_BORDE[color] : CLASE_BORDE_NEUTRO;
}
