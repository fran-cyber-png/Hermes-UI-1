/**
 * UNA MEDICIÓN NO SE PUEDE SERIALIZAR SIN SU `n` NI SIN SU `base`.
 *
 * ══ LOS DOS ERRORES QUE ESTE ARCHIVO EXISTE PARA IMPEDIR ═════════════════════
 *
 * **1 · El porcentaje sin muestra.** Una pieza con **2 de 3** y otra con
 * **180 de 400** se imprimen «67 %» y «45 %». Puestas una al lado de la otra,
 * cualquiera —humano o modelo— lee que la primera es mejor, y es exactamente al
 * revés: con 3 usos no se sabe **nada**. El intervalo lo dice sin que haga
 * falta saber estadística:
 *
 *      2/3    → 67 %  [21 % – 94 %]   ← cabe cualquier cosa
 *    180/400  → 45 %  [40 % – 50 %]   ← esto sí es un número
 *
 * **2 · El nombre que promete causa.** `base` dice **qué se midió**, con el
 * verbo que corresponde: `respondio_despues_de`, nunca «efectividad». Que un
 * envío sea seguido de una venta no dice que la haya causado, y estos números
 * van a decidir qué se escribe después.
 *
 * ══ POR QUÉ ES EL TIPO Y NO UNA CONVENCIÓN ═══════════════════════════════════
 *
 * Los dos campos son **obligatorios y no opcionales**, y `medir()` es el único
 * constructor: no existe una forma de armar una `Medicion` que no los lleve, así
 * que tampoco existe una forma de serializarla sin ellos. Una convención se
 * respeta hasta que alguien tiene apuro; un campo requerido no compila.
 *
 * Es el mismo criterio de `canales/verdad.ts` para «no se midió» vs «es cero»:
 * dos cosas distintas no pueden verse iguales.
 */

/** El z de un intervalo del 95 %. */
const Z = 1.959963984540054;

/**
 * QUÉ SE MIDIÓ. Lista cerrada, y **todos los nombres son descriptivos y
 * temporales**: dicen qué ocurrió después, no qué lo causó. `medicion.test.ts`
 * falla si alguien mete acá una palabra causal («efectividad», «conversión»,
 * «rendimiento»), igual que `plantillas.test.ts` prohíbe que un acuse se
 * anuncie como máquina.
 */
export const BASES_DE_MEDICION = [
  "respondio_despues_de",
  "avanzo_de_etapa_despues_de",
  "se_declaro_perdida_despues_de",
  "hubo_venta_despues_de",
] as const;
export type BaseDeMedicion = (typeof BASES_DE_MEDICION)[number];

/**
 * MUESTRA MÍNIMA para que valga la pena mirar un porcentaje.
 *
 * 30 no es mágico: es donde el intervalo de Wilson empieza a ser más angosto
 * que la diferencia que a este negocio le importaría (unos 20 puntos). Debajo
 * de eso el número existe pero no decide nada, y el consumidor —incluido Ivi—
 * tiene que poder frenar con `muestraInsuficiente()` en vez de recomendar la
 * pieza de 3 usos y 2 ventas.
 */
export const MUESTRA_MINIMA = 30;

export interface Medicion {
  /** QUÉ SE MIDIÓ. Obligatorio: sin esto un 45 % no significa nada. */
  base: BaseDeMedicion;
  exitos: number;
  /** EL TAMAÑO DE LA MUESTRA. Obligatorio por el mismo motivo. */
  n: number;
  /** exitos / n, o `null` si n = 0 — que no es «0 %», es «no hay dato». */
  tasa: number | null;
  /** El intervalo de Wilson al 95 %. `null` si n = 0. */
  intervalo: { bajo: number; alto: number } | null;
  /** ¿Alcanza para decidir algo? El gate, calculado una vez y viajando con el dato. */
  muestraSuficiente: boolean;
}

/**
 * El único constructor. Wilson y no la fórmula normal (`p ± 1,96·√(p(1-p)/n)`)
 * porque esa se rompe justo donde más hace falta: con n chico da límites fuera
 * de [0, 1] —«entre -4 % y 12 %»— y para 0 de 20 da un intervalo de ancho CERO,
 * o sea «estamos seguros de que es 0 %», que es lo contrario de la verdad.
 */
export function medir(base: BaseDeMedicion, exitos: number, n: number): Medicion {
  if (n <= 0) {
    return { base, exitos: 0, n: 0, tasa: null, intervalo: null, muestraSuficiente: false };
  }

  const p = exitos / n;
  const z2 = Z * Z;
  const denominador = 1 + z2 / n;
  const centro = (p + z2 / (2 * n)) / denominador;
  const margen = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominador;

  return {
    base,
    exitos,
    n,
    tasa: p,
    intervalo: { bajo: Math.max(0, centro - margen), alto: Math.min(1, centro + margen) },
    muestraSuficiente: n >= MUESTRA_MINIMA,
  };
}

/** El gate, dicho al derecho: con esta muestra no se puede recomendar nada. */
export function muestraInsuficiente(m: Medicion): boolean {
  return !m.muestraSuficiente;
}

/**
 * ¿Se puede afirmar que A le gana a B?
 *
 * Solo si los intervalos **no se tocan**. Es deliberadamente conservador: la
 * pregunta que responde no es «¿cuál tiene el número más alto?» (eso lo
 * contesta cualquiera mirando) sino «¿me la puedo jugar a reescribir el
 * material con esto?». Ante intervalos superpuestos la respuesta honesta es
 * «todavía no se sabe», no «probablemente».
 */
export function leGanaClaramente(a: Medicion, b: Medicion): boolean {
  if (!a.intervalo || !b.intervalo) return false;
  return a.intervalo.bajo > b.intervalo.alto;
}

/** El formato de una tabla: «45 % (180/400) [40–50]». Nunca sin la muestra. */
export function formatearMedicion(m: Medicion): string {
  if (m.tasa === null || !m.intervalo) return "— (0 casos)";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const marca = m.muestraSuficiente ? "" : " ⚠muestra chica";
  return `${pct(m.tasa)} (${m.exitos}/${m.n}) [${pct(m.intervalo.bajo)}–${pct(m.intervalo.alto)}]${marca}`;
}
