import { describe, expect, it } from 'vitest';
import { repartirEnCuotas } from './cuotas';

/**
 * EL ESPEJO DE `_distribuir_monto_en_cuotas` (`ceberusapp/sales/views.py:860`).
 *
 * Lo que estos tests protegen no es la aritmética: es que **lo que la pantalla
 * promete sea lo que Cerberus va a escribir**. Un espejo que divide distinto es
 * peor que no mostrar nada, porque la vendedora le dice al cliente un número que
 * después no aparece en su cronograma.
 */

describe('repartirEnCuotas', () => {
  it('una sola cuota se lleva el total — el caso normal, pago al contado', () => {
    expect(repartirEnCuotas(199, 1)).toEqual([199]);
  });

  it('reparte parejo cuando divide exacto', () => {
    expect(repartirEnCuotas(600, 3)).toEqual([200, 200, 200]);
    expect(repartirEnCuotas(199, 2)).toEqual([99.5, 99.5]);
  });

  it('🔴 los centavos que sobran van a las PRIMERAS, nunca a la última', () => {
    // 100 en 3 = 10.000 centavos: base 3.333, sobran 1. Python reparte
    // `base + (1 if idx < resto else 0)`, así que la primera se lleva el centavo.
    // Al revés, la ÚLTIMA cuota saldría más cara que las anteriores y eso es lo
    // que el cliente ve al final de su cronograma.
    expect(repartirEnCuotas(100, 3)).toEqual([33.34, 33.33, 33.33]);
    // 100 en 6 = base 1.666 y sobran CUATRO centavos: se van de a uno a las
    // cuatro primeras, y las dos últimas quedan un centavo más baratas.
    expect(repartirEnCuotas(100, 6)).toEqual([16.67, 16.67, 16.67, 16.67, 16.66, 16.66]);
  });

  it('la suma del reparto es SIEMPRE el total: no se pierde ni se inventa un centavo', () => {
    for (const [total, n] of [
      [100, 3],
      [199, 7],
      [4900, 12],
      [0.03, 2],
      [1234.56, 5],
    ] as const) {
      const suma = repartirEnCuotas(total, n).reduce((s, c) => s + c, 0);
      expect(Math.round(suma * 100)).toBe(Math.round(total * 100));
    }
  });

  it('el redondeo a centavos va por el texto, no por `monto * 100`', () => {
    // `8.615 * 100` da 861.4999999999999 en binario: con `Math.round` esto sería
    // 861 y Cerberus escribiría 862. El espejo tiene que llegar al mismo lugar.
    expect(repartirEnCuotas(8.615, 1)).toEqual([8.62]);
  });

  it('sin cuotas devuelve la lista vacía, no un error — es «todavía no hay cronograma»', () => {
    expect(repartirEnCuotas(199, 0)).toEqual([]);
    expect(repartirEnCuotas(199, -2)).toEqual([]);
    expect(repartirEnCuotas(Number.NaN, 3)).toEqual([0, 0, 0]);
  });

  it('un total en cero reparte ceros, y no divide por cero', () => {
    expect(repartirEnCuotas(0, 3)).toEqual([0, 0, 0]);
  });
});
