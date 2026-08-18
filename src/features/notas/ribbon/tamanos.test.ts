import { expect, test } from 'vitest';
import { TAMANO_POR_DEFECTO } from '../estilosDeTexto';
import { TAMANOS_SUGERIDOS, TAMANO_MAX, TAMANO_MIN, leerTamano, siguienteTamano, tamanoLibre } from './tamanos';

/**
 * AGRANDAR Y ACHICAR — la decisión, sin editor.
 *
 * Los tres consumidores (el selector, «Agrandar» y «Achicar») tienen que estar
 * de acuerdo sobre qué tamaños existen; lo que se fija acá es el paso, que es la
 * parte que se puede hacer mal de varias formas y ninguna da error.
 */

test('sin estilo puesto, el tamaño de arranque es el del papel', () => {
  // 🔴 No cero, no `null`: el texto MIDE 16 px (`index.css`), así que es desde
  // ahí que tiene que arrancar «Agrandar». Con cero, el primer clic saltaría a 8.
  expect(leerTamano(undefined)).toBe(TAMANO_POR_DEFECTO);
  expect(leerTamano(null)).toBe(TAMANO_POR_DEFECTO);
  expect(leerTamano('')).toBe(TAMANO_POR_DEFECTO);
  expect(leerTamano('18px')).toBe(18);
  expect(leerTamano('12.5px')).toBe(12.5);
});

test('el paso camina la lista, no suma un número fijo', () => {
  // Con un `+2` fijo, llegar de 16 a 72 son 28 clics; y abajo, de 8 a 10 se
  // saltearía el 9. La lista tiene el salto que corresponde a cada zona.
  expect(siguienteTamano(16, 1)).toBe(18);
  expect(siguienteTamano(48, 1)).toBe(72);
  expect(siguienteTamano(9, -1)).toBe(8);
  expect(siguienteTamano(16, -1)).toBe(14);
});

test('un tamaño escrito a mano salta al sugerido de ESE lado', () => {
  // 15 no está en la lista. Agrandar tiene que dar 16 y achicar 14: nunca uno
  // del otro lado, que se leería como que el botón hace lo contrario.
  expect(siguienteTamano(15, 1)).toBe(16);
  expect(siguienteTamano(15, -1)).toBe(14);
});

test('en los extremos devuelve null y no se aplica nada', () => {
  // `null` y no «el mismo valor otra vez»: reaplicar ensucia el historial de
  // deshacer con pasos que no cambian nada, y ahí `Mod+Z` deja de deshacer lo
  // que la persona hizo.
  expect(siguienteTamano(TAMANO_MAX, 1)).toBe(null);
  expect(siguienteTamano(TAMANO_MIN, -1)).toBe(null);
  // Entre el último sugerido y el tope todavía hay a dónde ir.
  expect(siguienteTamano(72, 1)).toBe(TAMANO_MAX);
  expect(siguienteTamano(8, -1)).toBe(TAMANO_MIN);
});

test('un número fuera de rango no vale', () => {
  // Un `fontSize: 0` o uno de 5.000 px no es un tamaño: es una página que
  // después hay que ir a arreglar a mano en el `jsonb`.
  expect(tamanoLibre('15')).toBe('15px');
  expect(tamanoLibre('15,5')).toBe('15.5px');
  expect(tamanoLibre('0')).toBe(null);
  expect(tamanoLibre('5000')).toBe(null);
  expect(tamanoLibre('grande')).toBe(null);
});

test('el tamaño por defecto está entre los sugeridos', () => {
  // Si no lo estuviera, el selector mostraría «16» y esa opción no aparecería en
  // su propia lista: no habría forma de volver después de cambiar.
  expect(TAMANOS_SUGERIDOS as readonly number[]).toContain(TAMANO_POR_DEFECTO);
});
