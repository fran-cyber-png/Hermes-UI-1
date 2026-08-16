import { z } from 'zod';

/**
 * LA PALETA DE CATEGORÍAS — fija, armoniosa y SIN ORO.
 *
 * Las etiquetas subieron a CATEGORÍAS con color elegible (#48). El color no es
 * texto libre: se elige de esta paleta cerrada. El ORO queda deliberadamente
 * fuera — en Hermes el oro significa UNA sola cosa (tiempo que se acaba), y
 * abaratarlo como color decorativo rompería esa señal. Por eso no hay ámbar ni
 * amarillo acá.
 *
 * Los HEX viven en `src/index.css` como tokens `--cat-*` (el front pinta); acá
 * solo vive la CLAVE de cada color, que es lo que se guarda y se valida. La
 * misma lista se refleja en `src/dominio/paletaCategorias.ts` para el
 * front (paquetes separados: no se puede importar cruzado).
 */
export const COLORES_CATEGORIA = [
  'pizarra',
  'rojo',
  'naranja',
  'verde',
  'azul',
  'cian',
  'morado',
  'rosa',
] as const;

export type ColorCategoria = (typeof COLORES_CATEGORIA)[number];

/** El validador del color: rechaza `gold`, `amarillo` y cualquier cosa fuera de la paleta. */
export const colorCategoria = z.enum(COLORES_CATEGORIA);

export function esColorCategoria(x: unknown): x is ColorCategoria {
  return typeof x === 'string' && (COLORES_CATEGORIA as readonly string[]).includes(x);
}

/**
 * Normaliza el nombre: es la clave de join contra la asignación (`etiquetas`),
 * así que tiene que coincidir byte a byte. Mismo criterio que el POST viejo de
 * etiquetas: recortar, bajar a minúsculas, capar a 30.
 */
export function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase().slice(0, 30);
}

/**
 * SEED PEREZOSO: los tres del glosario (PLAN.md §3). Se siembran la primera vez
 * que una vendedora mira sus categorías y no tiene ninguna, para que la libreta
 * no arranque vacía del todo.
 */
export const CATEGORIAS_DEFAULT: { nombre: string; color: ColorCategoria }[] = [
  { nombre: 'interesada', color: 'azul' },
  { nombre: 'precio', color: 'naranja' },
  { nombre: 'reclamo', color: 'rojo' },
];
