import { describe, expect, test } from 'vitest';
import {
  alternarFila,
  alternarPagina,
  cuantos,
  estaElegido,
  NADA,
  necesitaConfirmar,
  ofrecerElRecorte,
  todoElRecorte,
  type Seleccion,
} from './seleccion';

/**
 * La selección del padrón, pura. El caso que importa es el modo `recorte`: lo
 * elegido son 17.014 y en pantalla hay 50, así que ninguna de estas preguntas se
 * puede responder mirando las filas visibles.
 */

const PAGINA = [1, 2, 3];
const TOTAL = 17_014;

describe('cuántos hay elegidos', () => {
  test('en modo lista, los tildados', () => {
    expect(cuantos({ modo: 'lista', ids: [1, 2] }, TOTAL)).toBe(2);
    expect(cuantos(NADA, TOTAL)).toBe(0);
  });

  test('🔴 en modo recorte, TODO el recorte — no las filas visibles', () => {
    // El bug que esto impide: contar `ids.length` y decir «3 elegidos» cuando el
    // supervisor eligió 17.014, o al revés, repartir 17.014 creyendo que son 3.
    expect(cuantos(todoElRecorte(), TOTAL)).toBe(17_014);
  });

  test('los destildados se restan del total', () => {
    expect(cuantos({ modo: 'recorte', excluidos: [5, 9] }, TOTAL)).toBe(17_012);
  });

  test('nunca da negativo aunque los excluidos superen al total', () => {
    // El total llega de una consulta anterior y los excluidos se acumulan acá:
    // un refresco a destiempo los puede cruzar, y «−2 elegidos» es peor que 0.
    expect(cuantos({ modo: 'recorte', excluidos: [1, 2, 3] }, 2)).toBe(0);
  });
});

describe('si una fila está elegida', () => {
  test('en modo lista, solo las tildadas', () => {
    const s: Seleccion = { modo: 'lista', ids: [1] };
    expect(estaElegido(s, 1)).toBe(true);
    expect(estaElegido(s, 2)).toBe(false);
  });

  test('🔴 en modo recorte, TODAS salvo las excluidas — incluidas las que nunca se vieron', () => {
    const s: Seleccion = { modo: 'recorte', excluidos: [2] };
    expect(estaElegido(s, 1)).toBe(true);
    expect(estaElegido(s, 2)).toBe(false);
    expect(estaElegido(s, 99_999)).toBe(true);
  });
});

describe('tildar y destildar una fila', () => {
  test('en modo lista agrega y saca', () => {
    expect(alternarFila(NADA, 7)).toEqual({ modo: 'lista', ids: [7] });
    expect(alternarFila({ modo: 'lista', ids: [7] }, 7)).toEqual({ modo: 'lista', ids: [] });
  });

  test('🔴 destildar en modo recorte NO rompe el modo', () => {
    // El bug clásico: destildar uno de 17.014 y quedarse con los 49 visibles, sin
    // ningún síntoma hasta ver el acuse.
    const s = alternarFila(todoElRecorte(), 5);
    expect(s.modo).toBe('recorte');
    expect(cuantos(s, TOTAL)).toBe(17_013);
  });

  test('volver a tildar lo destildado lo devuelve al recorte', () => {
    const sacado = alternarFila(todoElRecorte(), 5);
    expect(cuantos(alternarFila(sacado, 5), TOTAL)).toBe(17_014);
  });
});

describe('la casilla de la cabecera', () => {
  test('tilda y destilda la página en modo lista', () => {
    const s = alternarPagina(NADA, PAGINA, true);
    expect(s).toEqual({ modo: 'lista', ids: [1, 2, 3] });
    expect(alternarPagina(s, PAGINA, false)).toEqual({ modo: 'lista', ids: [] });
  });

  test('no duplica lo que ya estaba', () => {
    const s = alternarPagina({ modo: 'lista', ids: [2] }, PAGINA, true);
    expect(s).toEqual({ modo: 'lista', ids: [2, 1, 3] });
  });

  test('🔴 destildar la página en modo recorte excluye, no cambia de modo', () => {
    const s = alternarPagina(todoElRecorte(), PAGINA, false);
    expect(s.modo).toBe('recorte');
    expect(cuantos(s, TOTAL)).toBe(17_011);
  });
});

describe('cuándo se ofrece el salto al recorte entero', () => {
  test('con la página completa y más afuera, sí', () => {
    expect(ofrecerElRecorte({ modo: 'lista', ids: PAGINA }, PAGINA, TOTAL)).toBe(true);
  });

  test('con la página a medias, no', () => {
    // Saltar de 2 elegidos a 17.014 es un accidente esperando.
    expect(ofrecerElRecorte({ modo: 'lista', ids: [1, 2] }, PAGINA, TOTAL)).toBe(false);
  });

  test('si el recorte entra entero en la página, no hay nada que ofrecer', () => {
    expect(ofrecerElRecorte({ modo: 'lista', ids: PAGINA }, PAGINA, 3)).toBe(false);
  });

  test('ya en modo recorte no se vuelve a ofrecer', () => {
    expect(ofrecerElRecorte(todoElRecorte(), PAGINA, TOTAL)).toBe(false);
  });

  test('sin filas no se ofrece', () => {
    expect(ofrecerElRecorte(NADA, [], TOTAL)).toBe(false);
  });
});

describe('cuándo hay que confirmar', () => {
  test('un lote chico se reparte de un clic', () => {
    expect(necesitaConfirmar(1)).toBe(false);
    expect(necesitaConfirmar(499)).toBe(false);
  });

  test('un lote que nadie puede revisar pide confirmación', () => {
    // No bloquea: repartir 17.014 es decisión del supervisor. Pero deja de ser un
    // clic suelto y pasa a ser una confirmación con la cifra escrita (regla #7).
    expect(necesitaConfirmar(500)).toBe(true);
    expect(necesitaConfirmar(17_014)).toBe(true);
  });
});
