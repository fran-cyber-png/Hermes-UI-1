import { describe, expect, it } from 'vitest';
import { resumirIntereses } from './resumenInteres';

const HOY = new Date('2026-07-25T15:00:00');

describe('resumirIntereses — el interés se acumula, y se lee', () => {
  it('sin intereses no hay resumen: el hueco lo explica el bloque, no una línea vacía', () => {
    expect(resumirIntereses([], HOY)).toEqual({ cuantos: 0, linea: null });
  });

  it('uno solo, de hoy, se dice «hoy» y no una fecha que hay que traducir', () => {
    const r = resumirIntereses([{ curso: 'OSINT', creadoAt: '2026-07-25T09:00:00' }], HOY);
    expect(r).toEqual({ cuantos: 1, linea: '1 curso anotado · hoy' });
  });

  it('varios: cuenta y fecha del ÚLTIMO, que es el que dice qué quiere hoy', () => {
    const r = resumirIntereses(
      [
        { curso: 'Inteligencia', creadoAt: '2026-07-01T10:00:00' },
        { curso: 'OSINT', creadoAt: '2026-07-15T10:00:00' },
      ],
      HOY,
    );
    expect(r.cuantos).toBe(2);
    expect(r.linea).toBe('2 cursos anotados · el último, 15 jul');
  });

  it('el orden en que llegan no cambia cuál es el último', () => {
    const desordenados = resumirIntereses(
      [
        { curso: 'OSINT', creadoAt: '2026-07-15T10:00:00' },
        { curso: 'Inteligencia', creadoAt: '2026-07-01T10:00:00' },
      ],
      HOY,
    );
    expect(desordenados.linea).toBe('2 cursos anotados · el último, 15 jul');
  });

  it('un interés del año pasado se delata con el año', () => {
    const r = resumirIntereses([{ curso: 'Inteligencia', creadoAt: '2025-12-15T10:00:00' }], HOY);
    expect(r.linea).toBe('1 curso anotado · 15 dic 25');
  });

  it('sin fecha (caché viejo, forma plana) cuenta pero NO inventa un cuándo', () => {
    const r = resumirIntereses([{ curso: 'Inteligencia', creadoAt: null }], HOY);
    expect(r).toEqual({ cuantos: 1, linea: '1 curso anotado' });
  });

  it('una fecha basura no rompe el resumen ni escribe «Invalid Date»', () => {
    const r = resumirIntereses([{ curso: 'Inteligencia', creadoAt: 'ayer nomás' }], HOY);
    expect(r.linea).toBe('1 curso anotado');
  });
});
