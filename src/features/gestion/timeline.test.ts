import { describe, expect, it } from 'vitest';
import { agruparInteresesPorDia, normalizarIntereses } from './timeline';

/**
 * LA LÍNEA DE TIEMPO DEL INTERÉS (#57) — la lógica pura, sin DOM.
 *
 * Zona horaria inyectada ('UTC') para que el día no dependa del runner. En vivo
 * el default es America/Lima (la vendedora es peruana).
 */

describe('normalizarIntereses — tolera las dos formas del endpoint', () => {
  it('lee la forma NUEVA con fecha (interesesDetalle)', () => {
    const d = {
      interesesDetalle: {
        'conv:1': [{ curso: 'Inteligencia', creadoAt: '2026-07-01T12:00:00.000Z' }],
      },
    };
    expect(normalizarIntereses(d, 'conv:1')).toEqual([
      { curso: 'Inteligencia', creadoAt: '2026-07-01T12:00:00.000Z' },
    ]);
  });

  it('tolera la forma VIEJA/cacheada sin fecha (intereses plano) → creadoAt null', () => {
    const d = { intereses: { 'conv:1': ['Inteligencia', 'OSINT'] } };
    expect(normalizarIntereses(d, 'conv:1')).toEqual([
      { curso: 'Inteligencia', creadoAt: null },
      { curso: 'OSINT', creadoAt: null },
    ]);
  });

  it('prefiere la forma nueva cuando vienen las dos', () => {
    const d = {
      intereses: { 'conv:1': ['viejo'] },
      interesesDetalle: { 'conv:1': [{ curso: 'nuevo', creadoAt: '2026-07-01T00:00:00.000Z' }] },
    };
    expect(normalizarIntereses(d, 'conv:1')).toEqual([
      { curso: 'nuevo', creadoAt: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('clave sin intereses → lista vacía', () => {
    expect(normalizarIntereses({}, 'conv:x')).toEqual([]);
  });
});

describe('agruparInteresesPorDia — ordena y agrupa por fecha', () => {
  it('ordena cronológicamente (el más viejo primero) aunque lleguen al revés', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'OSINT', creadoAt: '2026-07-15T12:00:00.000Z' },
        { curso: 'Inteligencia', creadoAt: '2026-07-01T12:00:00.000Z' },
      ],
      'UTC',
    );
    expect(grupos.map((g) => g.etiqueta)).toEqual(['1 jul', '15 jul']);
    expect(grupos.map((g) => g.cursos)).toEqual([['Inteligencia'], ['OSINT']]);
  });

  it('agrupa por día: dos cursos el mismo día comparten fecha', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'Inteligencia', creadoAt: '2026-07-01T09:00:00.000Z' },
        { curso: 'OSINT', creadoAt: '2026-07-01T18:00:00.000Z' },
      ],
      'UTC',
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].etiqueta).toBe('1 jul');
    expect(grupos[0].cursos).toEqual(['Inteligencia', 'OSINT']);
  });

  it('los sin fecha (caché viejo) van al final, sin etiqueta', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'Sin fecha', creadoAt: null },
        { curso: 'Inteligencia', creadoAt: '2026-07-01T00:00:00.000Z' },
      ],
      'UTC',
    );
    expect(grupos[0].etiqueta).toBe('1 jul');
    expect(grupos[grupos.length - 1]).toEqual({ dia: '', etiqueta: '', cursos: ['Sin fecha'] });
  });

  it('no duplica un curso repetido el mismo día', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'OSINT', creadoAt: '2026-07-01T09:00:00.000Z' },
        { curso: 'OSINT', creadoAt: '2026-07-01T10:00:00.000Z' },
      ],
      'UTC',
    );
    expect(grupos[0].cursos).toEqual(['OSINT']);
  });

  it('lista vacía → sin grupos', () => {
    expect(agruparInteresesPorDia([], 'UTC')).toEqual([]);
  });
});
