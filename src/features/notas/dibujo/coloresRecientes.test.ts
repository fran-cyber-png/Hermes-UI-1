// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Por su EFECTO al importarse: vitest no copia el `localStorage` de la ventana
// de jsdom a los globales, y el andamio de la casa ya trae ese remiendo (lo
// documenta en su docblock). Sin esto, `localStorage` es `undefined` acá.
import '../../../pruebas/dom';
import { TOPE_RECIENTES, agregarReciente, leerRecientes } from './coloresRecientes';

/**
 * LOS COLORES RECIENTES.
 *
 * Corre en jsdom porque lo único que este módulo hace además de listas es tocar
 * `localStorage`, y lo que importa probar es justamente eso: que sobreviva a un
 * almacenamiento con basura adentro y a uno que tira al escribir.
 */

const CLAVE = 'hermes.libreta.coloresRecientes';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('guardar y leer', () => {
  it('el último usado queda primero', () => {
    agregarReciente('#111111');
    agregarReciente('#222222');
    expect(leerRecientes()).toEqual(['#222222', '#111111']);
  });

  it('🔴 repetir un color lo MUEVE al frente, no lo duplica', () => {
    // Una lista con el mismo color cuatro veces desperdicia el único espacio que
    // tiene: el más usado sería el que más lugar ocupa.
    agregarReciente('#111111');
    agregarReciente('#222222');
    agregarReciente('#111111');
    expect(leerRecientes()).toEqual(['#111111', '#222222']);
  });

  it(`no guarda más de ${TOPE_RECIENTES}`, () => {
    for (let i = 0; i < TOPE_RECIENTES + 5; i++) {
      agregarReciente(`#0000${i.toString(16).padStart(2, '0')}`);
    }
    expect(leerRecientes()).toHaveLength(TOPE_RECIENTES);
  });

  it('normaliza a minúsculas para no guardar el mismo color dos veces', () => {
    agregarReciente('#AABBCC');
    agregarReciente('#aabbcc');
    expect(leerRecientes()).toEqual(['#aabbcc']);
  });

  it('lo que no es un color no entra', () => {
    agregarReciente('rojo');
    agregarReciente('#12');
    expect(leerRecientes()).toEqual([]);
  });
});

describe('lo defensivo', () => {
  it.each([
    ['JSON roto', '[{'],
    ['no es un array', '{"a":1}'],
    ['vacío', ''],
  ])('%s vale lista vacía', (_caso, guardado) => {
    localStorage.setItem(CLAVE, guardado);
    expect(() => leerRecientes()).not.toThrow();
    expect(leerRecientes()).toEqual([]);
  });

  it('🔴 se sanea al LEER, no solo al escribir', () => {
    // Lo que hay en `localStorage` lo pudo dejar una versión anterior, otra
    // pestaña, o alguien a mano.
    localStorage.setItem(CLAVE, JSON.stringify(['#aabbcc', 'rojo', 42, null, '#ddeeff']));
    expect(leerRecientes()).toEqual(['#aabbcc', '#ddeeff']);
  });

  it('un almacenamiento que TIRA al escribir no rompe nada', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cuota llena');
    });
    expect(() => agregarReciente('#123456')).not.toThrow();
    // Y devuelve la lista igual, para que la pantalla muestre algo coherente.
    expect(agregarReciente('#123456')).toEqual(['#123456']);
  });
});
