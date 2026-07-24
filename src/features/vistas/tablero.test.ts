import { describe, expect, test } from 'vitest';
import {
  COLUMNAS_TRABAJO,
  etapaDeTarjeta,
  quedanPorTraer,
  repartirColumnas,
  type EtapaTrabajo,
} from './tablero';

/**
 * EL TABLERO HONESTO (#90) — la lógica pura, sin DOM.
 *
 * Qué columna pide qué `?etapa=`, dónde cae cada tarjeta con los movimientos
 * optimistas en el medio, y cuántas faltan por traer. VistaEmbudo solo ejecuta;
 * la política se fija acá (mismo patrón que `compuertas.ts`).
 */

const tarjeta = (clave: string, etapa?: string) => ({ clave, etapa_efectiva: etapa });

describe('las columnas de trabajo', () => {
  test('cada columna pide SU etapa efectiva: contactado, cotizado, cierre y perdido — interesado no es columna', () => {
    expect(COLUMNAS_TRABAJO.map((c) => c.id)).toEqual(['contactado', 'cotizado', 'cierre', 'perdido']);
  });
});

describe('repartirColumnas — dónde cae cada tarjeta', () => {
  const cargadas: [EtapaTrabajo, ReturnType<typeof tarjeta>[]][] = [
    ['contactado', [tarjeta('a', 'contactado'), tarjeta('b', 'contactado')]],
    ['cotizado', [tarjeta('c', 'cotizado')]],
    ['cierre', []],
    ['perdido', [tarjeta('d', 'perdido')]],
  ];

  test('sin movimientos, cada tarjeta queda en la columna que la trajo', () => {
    const mapa = repartirColumnas(cargadas, {});
    expect(mapa.get('contactado')!.map((t) => t.clave)).toEqual(['a', 'b']);
    expect(mapa.get('cotizado')!.map((t) => t.clave)).toEqual(['c']);
    expect(mapa.get('perdido')!.map((t) => t.clave)).toEqual(['d']);
  });

  test('un movimiento optimista muda la tarjeta: sale de la columna vieja y entra ARRIBA de la nueva', () => {
    const mapa = repartirColumnas(cargadas, { b: 'cotizado' });
    expect(mapa.get('contactado')!.map((t) => t.clave)).toEqual(['a']);
    expect(mapa.get('cotizado')!.map((t) => t.clave)).toEqual(['b', 'c']);
  });

  test('mientras las columnas se refrescan, una tarjeta duplicada se pinta UNA vez', () => {
    // Tras mover y refetchear, el destino ya la trae pero el origen todavía no
    // la soltó: manda la etapa efectiva de la propia tarjeta, no la columna vieja.
    const enTransicion: [EtapaTrabajo, ReturnType<typeof tarjeta>[]][] = [
      ['contactado', [tarjeta('x', 'cotizado')]],
      ['cotizado', [tarjeta('x', 'cotizado')]],
      ['cierre', []],
      ['perdido', []],
    ];
    const mapa = repartirColumnas(enTransicion, {});
    expect(mapa.get('cotizado')!.map((t) => t.clave)).toEqual(['x']);
    expect(mapa.get('contactado')).toEqual([]);
  });

  test('una tarjeta cuya etapa quedó fuera del tablero (interesado) no se pinta en ninguna columna', () => {
    const conVieja: [EtapaTrabajo, ReturnType<typeof tarjeta>[]][] = [
      ['contactado', [tarjeta('y', 'interesado')]],
      ['cotizado', []],
      ['cierre', []],
      ['perdido', []],
    ];
    const mapa = repartirColumnas(conVieja, {});
    expect(mapa.get('contactado')).toEqual([]);
  });
});

describe('etapaDeTarjeta — de dónde sale la etapa actual para las compuertas', () => {
  test('sin movimiento en vuelo, la manda el server (etapa_efectiva)', () => {
    expect(etapaDeTarjeta(tarjeta('a', 'cotizado'), {})).toBe('cotizado');
  });

  test('con movimiento optimista en vuelo, manda el movimiento', () => {
    expect(etapaDeTarjeta(tarjeta('a', 'contactado'), { a: 'cotizado' })).toBe('cotizado');
  });

  test('sin dato del server no se inventa nada: null, jamás el fallback interesado', () => {
    expect(etapaDeTarjeta({ clave: 'a' }, {})).toBeNull();
  });
});

describe('quedanPorTraer — el «Ver más» honesto por columna', () => {
  test('lo que falta = total real de la columna menos lo cargado', () => {
    expect(quedanPorTraer(1129, 30)).toBe(1099);
  });

  test('nunca negativo (el total puede quedar viejo entre refetches)', () => {
    expect(quedanPorTraer(3, 5)).toBe(0);
  });

  test('sin total todavía, no se promete nada', () => {
    expect(quedanPorTraer(undefined, 30)).toBe(0);
  });
});
