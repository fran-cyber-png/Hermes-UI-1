import { describe, expect, it } from 'vitest';
import { etiquetaDeFecha, etiquetaDeMonto, hitosDe } from './hitos';

const venta = (fecha: string, folio = 'F1', monto = '1200', moneda = 'S/') => ({
  folio,
  estado: 'pagada',
  monto,
  moneda,
  fecha,
});

describe('hitosDe — la historia en una sola línea', () => {
  it('mezcla compras e intereses, del más nuevo al más viejo', () => {
    const h = hitosDe({
      ventas: [venta('2026-03-10T12:00:00Z', 'F-VIEJA')],
      intereses: [
        { curso: 'Consultoría', creadoAt: '2026-05-01T12:00:00Z' },
        { curso: 'Oratoria', creadoAt: '2026-01-01T12:00:00Z' },
      ],
    });

    expect(h.map((x) => (x.tipo === 'compra' ? x.folio : x.curso))).toEqual([
      'Consultoría',
      'F-VIEJA',
      'Oratoria',
    ]);
  });

  it('lo SIN FECHA va al final, nunca arriba', () => {
    // Arriba se leería como «lo más reciente», y eso es afirmar algo que no
    // sabemos. Al final se lee como lo que es: pasó, sin cuándo.
    const h = hitosDe({
      intereses: [
        { curso: 'Sin fecha', creadoAt: null },
        { curso: 'Con fecha', creadoAt: '2026-01-01T12:00:00Z' },
      ],
    });
    expect(h.map((x) => x.tipo === 'interes' && x.curso)).toEqual(['Con fecha', 'Sin fecha']);
  });

  it('una fecha ilegible se trata como SIN fecha, no rompe el orden', () => {
    const h = hitosDe({
      ventas: [venta('no-es-una-fecha', 'F-ROTA')],
      intereses: [{ curso: 'Consultoría', creadoAt: '2026-01-01T12:00:00Z' }],
    });
    expect(h[0].tipo).toBe('interes');
    expect(h[1]).toMatchObject({ tipo: 'compra', at: null, folio: 'F-ROTA' });
  });

  it('el mismo día, la COMPRA va antes que el interés', () => {
    // Si ese día compró, eso es lo primero que la vendedora tiene que ver.
    const h = hitosDe({
      ventas: [venta('2026-04-02T10:00:00Z', 'F-HOY')],
      intereses: [{ curso: 'Consultoría', creadoAt: '2026-04-02T10:00:00Z' }],
    });
    expect(h[0]).toMatchObject({ tipo: 'compra' });
  });

  it('sin datos devuelve una lista vacía, no lanza', () => {
    expect(hitosDe({})).toEqual([]);
  });
});

describe('etiquetaDeFecha', () => {
  const ahora = new Date('2026-07-27T12:00:00Z');

  it('dentro del año en curso omite el año', () => {
    expect(etiquetaDeFecha('2026-03-14T12:00:00Z', ahora)).toBe('14 mar');
  });

  it('de otro año LO DICE: «es cliente» y «fue cliente» no son lo mismo', () => {
    expect(etiquetaDeFecha('2024-12-15T12:00:00Z', ahora)).toBe('15 dic 24');
  });

  it('sin fecha o ilegible, cadena vacía — nunca «hoy»', () => {
    expect(etiquetaDeFecha(null, ahora)).toBe('');
    expect(etiquetaDeFecha('cualquier cosa', ahora)).toBe('');
  });
});

describe('etiquetaDeMonto', () => {
  it('junta moneda y monto legible', () => {
    expect(etiquetaDeMonto('1200', 'S/')).toBe('S/ 1,200');
  });

  it('SIN MONEDA no inventa una: en la Escuela hay ventas en dólares', () => {
    expect(etiquetaDeMonto('1200', '')).toBe('1,200');
  });

  it('un monto vacío o en cero no dibuja nada', () => {
    expect(etiquetaDeMonto('', 'S/')).toBe('');
    expect(etiquetaDeMonto('0', 'S/')).toBe('');
  });
});

describe('el formato de Cerberus — DD/MM/YYYY, el que rompía el timeline entero', () => {
  it('lee «17/07/2026 00:34» — `new Date()` lo daba por inválido', () => {
    // Medido contra producción: las 3 compras de un cliente real salían «sin
    // fecha» porque JS leía el 17 como mes. El síntoma se confunde con «Cerberus
    // no mandó la fecha», que es lo contrario de lo que pasaba.
    const h = hitosDe({ ventas: [venta('17/07/2026 00:34', 'F-MX')] });
    expect(h[0].at).not.toBeNull();
    expect(etiquetaDeFecha(h[0].at, new Date('2026-07-27T12:00:00'))).toBe('17 jul');
  });

  it('ordena bien tres compras reales en formato Cerberus', () => {
    const h = hitosDe({
      ventas: [
        venta('15/05/2025 00:52', 'GOB-07529'),
        venta('17/07/2026 00:34', 'GOB-13851'),
        venta('30/07/2025 20:47', 'GOB-08763'),
      ],
    });
    expect(h.map((x) => x.tipo === 'compra' && x.folio)).toEqual([
      'GOB-13851',
      'GOB-08763',
      'GOB-07529',
    ]);
  });

  it('sin hora también entra', () => {
    expect(hitosDe({ ventas: [venta('01/03/2026', 'F')] })[0].at).not.toBeNull();
  });

  it('la medianoche NO se corre de día: se lee local, no UTC', () => {
    // Con UTC, una compra de las 00:34 en Lima se leía del día anterior.
    const h = hitosDe({ ventas: [venta('17/07/2026 00:34', 'F')] });
    expect(etiquetaDeFecha(h[0].at, new Date('2026-07-27T12:00:00'))).toBe('17 jul');
  });

  it('el ISO de siempre sigue funcionando', () => {
    const h = hitosDe({ intereses: [{ curso: 'X', creadoAt: '2026-03-14T12:00:00Z' }] });
    expect(h[0].at).not.toBeNull();
  });
});
