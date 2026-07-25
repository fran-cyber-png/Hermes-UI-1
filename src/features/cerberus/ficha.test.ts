import { describe, expect, it } from 'vitest';
import { esAnulada, resumenCompras, type VentaFicha } from './ficha';

function venta(p: Partial<VentaFicha> = {}): VentaFicha {
  return { folio: 'GOB-1', estado: 'Pagado', monto: '100.00', moneda: 'MXN', fecha: '2026-01-01', ...p };
}

describe('resumenCompras — la cifra que cambia el trato', () => {
  it('sin ventas no hay cifra: no es «MXN 0», es que no compró', () => {
    expect(resumenCompras([])).toBeNull();
  });

  it('suma las pagadas de la misma moneda y las cuenta', () => {
    expect(resumenCompras([venta({ monto: '1960.00' }), venta({ folio: 'GOB-2', monto: '2800.00' })])).toEqual({
      moneda: 'MXN',
      total: 4760,
      n: 2,
    });
  });

  it('la anulada no suma ni cuenta — decir que compró 2 veces cuando una se cayó es mentir', () => {
    expect(
      resumenCompras([
        venta({ monto: '1960.00' }),
        venta({ folio: 'GOB-2', monto: '2800.00', estado: 'Anulada' }),
      ]),
    ).toEqual({ moneda: 'MXN', total: 1960, n: 1 });
  });

  it('«ANULADO» en mayúsculas también es anulado', () => {
    expect(esAnulada(venta({ estado: 'ANULADO' }))).toBe(true);
    expect(esAnulada(venta({ estado: 'Pagado' }))).toBe(false);
  });

  it('si todas están anuladas no queda cifra que mostrar', () => {
    expect(resumenCompras([venta({ estado: 'Anulada' })])).toBeNull();
  });

  it('no mezcla monedas: manda la de la venta más reciente y las otras quedan afuera de la suma', () => {
    const r = resumenCompras([
      venta({ moneda: 'PEN', monto: '500.00' }),
      venta({ folio: 'GOB-2', moneda: 'MXN', monto: '2800.00' }),
    ]);
    expect(r).toEqual({ moneda: 'PEN', total: 500, n: 1 });
  });

  it('un monto que no es número no rompe la suma ni la ensucia con NaN', () => {
    expect(resumenCompras([venta({ monto: 'sin dato' }), venta({ folio: 'GOB-2', monto: '300.50' })])).toEqual({
      moneda: 'MXN',
      total: 300.5,
      n: 2,
    });
  });
});
