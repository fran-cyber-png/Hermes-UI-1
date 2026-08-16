import { describe, it, expect } from 'vitest';
import { lineaEfectiva, opcionesDeLinea, seDibujaElSelector } from './alcance';
import { LINEA_MIAS } from '../../dominio/cola';
import type { LineaWhatsapp } from '../../dominio/lineas';

/**
 * QUÉ LÍNEAS OFRECE EL SELECTOR.
 *
 * El caso que motiva todo: cinco vendedoras nuevas atienden UNA línea y el
 * selector les ponía adelante las otras tres, dos de las cuales se distinguen por
 * una `s` y una tilde («Ventas Perú» / «Venta Peru»).
 */

const L = (numero: string, etiqueta: string, mias?: boolean): LineaWhatsapp => ({
  numero,
  etiqueta,
  estado: 'conectado',
  ...(mias === undefined ? {} : { mias }),
});

const LAS_CUATRO = [
  L('51986394450', 'Ventas Perú'),
  L('51941654039', 'Walter Ventas'),
  L('51944531711', 'Venta Peru'),
  L('51984429504', 'Ventas Meta'),
];

describe('opcionesDeLinea', () => {
  it('sin líneas propias ofrece TODAS: fail-open, como siempre', () => {
    const o = opcionesDeLinea(LAS_CUATRO, false);
    expect(o.map((x) => x.etiqueta)).toEqual([
      'Todas',
      'Ventas Perú',
      'Walter Ventas',
      'Venta Peru',
      'Ventas Meta',
    ]);
  });

  /**
   * EL CASO DE LAS CINCO NUEVAS. Con una sola línea propia queda UNA opción, y
   * por `seDibujaElSelector` el control desaparece: no hay elección que tomar.
   */
  it('con UNA línea propia queda una sola opción, y el selector no se dibuja', () => {
    const propias = LAS_CUATRO.map((l) => (l.numero === '51984429504' ? { ...l, mias: true } : l));
    const o = opcionesDeLinea(propias, true);
    expect(o.map((x) => x.etiqueta)).toEqual(['Ventas Meta']);
    expect(seDibujaElSelector(o)).toBe(false);
  });

  /**
   * Luz atiende dos. Ahí sí hay elección — pero **sin «Todas»**: agregarla
   * volvería a poner adelante las colas de Walter y Sindy, que es justo lo que
   * este módulo saca.
   */
  it('con VARIAS propias ofrece «Las mías» + las suyas, y nunca «Todas»', () => {
    const propias = LAS_CUATRO.map((l) =>
      l.numero === '51986394450' || l.numero === '51984429504' ? { ...l, mias: true } : l,
    );
    const o = opcionesDeLinea(propias, true);
    expect(o.map((x) => x.etiqueta)).toEqual(['Las mías', 'Ventas Perú', 'Ventas Meta']);
    expect(o.some((x) => x.numero === '')).toBe(false);
    expect(seDibujaElSelector(o)).toBe(true);
  });

  it('una sola línea viva y sin mapa sigue sin dibujar selector (regla vieja, intacta)', () => {
    expect(seDibujaElSelector(opcionesDeLinea([L('51986394450', 'Ventas Perú')], false))).toBe(true);
    // ↑ «Todas» + la línea son dos opciones. Que el shell lo esconda con una sola
    // línea VIVA es otra decisión y vive en `useLineas().hayVarias`.
  });
});

describe('lineaEfectiva', () => {
  const propias = LAS_CUATRO.map((l) => (l.numero === '51984429504' ? { ...l, mias: true } : l));
  const unaSola = opcionesDeLinea(propias, true);

  it('respeta lo guardado si sigue siendo una opción', () => {
    expect(lineaEfectiva('51984429504', unaSola)).toBe('51984429504');
  });

  /**
   * EL CASO QUE JUSTIFICA LA FUNCIÓN. Cuando el selector no se dibuja no hay
   * control para corregir un valor guardado malo: sin esto, quien ayer eligió
   * «Todas» vería las cuatro líneas para siempre, sin nada que lo explique.
   */
  it('un valor guardado que ya no corresponde cae a LO SUYO, no a «Todas»', () => {
    expect(lineaEfectiva('', unaSola)).toBe('51984429504');
    expect(lineaEfectiva('51941654039', unaSola)).toBe('51984429504');
    expect(lineaEfectiva(LINEA_MIAS, unaSola)).toBe('51984429504');
  });

  it('sin mapa, un valor raro cae a «Todas» — que ahí sí es lo correcto', () => {
    expect(lineaEfectiva('51999999999', opcionesDeLinea(LAS_CUATRO, false))).toBe('');
  });

  it('con varias propias, lo que no corresponde cae a «Las mías»', () => {
    const dos = opcionesDeLinea(
      LAS_CUATRO.map((l) =>
        l.numero === '51986394450' || l.numero === '51984429504' ? { ...l, mias: true } : l,
      ),
      true,
    );
    expect(lineaEfectiva('51941654039', dos)).toBe(LINEA_MIAS);
  });

  it('sin opciones no rompe', () => {
    expect(lineaEfectiva('51984429504', [])).toBe('');
  });
});
