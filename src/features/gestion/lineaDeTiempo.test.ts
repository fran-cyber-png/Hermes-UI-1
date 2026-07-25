import { describe, expect, it } from 'vitest';
import { agruparInteresesPorDia, normalizarIntereses, propuestaDeCurso } from './lineaDeTiempo';

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

describe('propuestaDeCurso — el interés que se deduce del anuncio (#102)', () => {
  const derivadoAnuncio = {
    derivados: {
      'conv:1': {
        curso: 'Inteligencia y Contrainteligencia',
        familia: 'DIPICOT',
        fuente: 'anuncio' as const,
        textoOrigen: '[JUL] INTELIGENCIA | WSP',
      },
    },
  };

  it('propone el curso y dice de dónde salió', () => {
    const p = propuestaDeCurso(derivadoAnuncio, 'conv:1', []);
    expect(p?.texto).toBe('Inteligencia y Contrainteligencia');
    expect(p?.origen).toBe('del anuncio');
    expect(p?.confirmable).toBe(true);
    expect(p?.detalle).toContain('[JUL] INTELIGENCIA | WSP');
  });

  it('un interés ya registrado manda: no se propone nada', () => {
    const p = propuestaDeCurso(derivadoAnuncio, 'conv:1', [{ curso: 'OSINT', creadoAt: null }]);
    expect(p).toBeNull();
  });

  it('si el anuncio no mapea a ningún curso, muestra el título crudo y NO se puede confirmar', () => {
    const p = propuestaDeCurso(
      {
        derivados: {
          'conv:1': {
            curso: null,
            familia: null,
            fuente: 'anuncio' as const,
            textoOrigen: 'Reel spot antiguo',
          },
        },
      },
      'conv:1',
      [],
    );
    expect(p?.texto).toBe('Reel spot antiguo');
    expect(p?.confirmable).toBe(false);
  });

  it('cuando salió del formulario lo dice: el chip nunca miente sobre su fuente', () => {
    const p = propuestaDeCurso(
      {
        derivados: {
          'conv:1': {
            curso: 'OSINT & SOCMINT',
            familia: 'DIPOSOC',
            fuente: 'lead' as const,
            textoOrigen: 'Diploma técnico en Osint & Socmint',
          },
        },
      },
      'conv:1',
      [],
    );
    expect(p?.origen).toBe('del formulario');
  });

  it('un caché viejo (sin `derivados`) no rompe: simplemente no propone', () => {
    expect(propuestaDeCurso({ intereses: { 'conv:1': [] } }, 'conv:1', [])).toBeNull();
    expect(propuestaDeCurso(derivadoAnuncio, 'conv:otra', [])).toBeNull();
  });
});

describe('agruparInteresesPorDia — ordena y agrupa por fecha', () => {
  // `hoy` fijo para que el sufijo de año no dependa de cuándo corre el test.
  const HOY = new Date('2026-07-24T12:00:00.000Z');

  it('ordena cronológicamente (el más viejo primero) aunque lleguen al revés', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'OSINT', creadoAt: '2026-07-15T12:00:00.000Z' },
        { curso: 'Inteligencia', creadoAt: '2026-07-01T12:00:00.000Z' },
      ],
      'UTC',
      HOY,
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
      HOY,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].etiqueta).toBe('1 jul');
    expect(grupos[0].cursos).toEqual(['Inteligencia', 'OSINT']);
  });

  it('el año NO se muestra si es el año en curso; SÍ cuando es otro año («15 dic 25»)', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'Viejo', creadoAt: '2025-12-15T12:00:00.000Z' },
        { curso: 'Nuevo', creadoAt: '2026-07-01T12:00:00.000Z' },
      ],
      'UTC',
      HOY,
    );
    expect(grupos.map((g) => g.etiqueta)).toEqual(['15 dic 25', '1 jul']);
  });

  it('la clave `dia` queda en ISO YYYY-MM-DD (para el atributo dateTime)', () => {
    const grupos = agruparInteresesPorDia(
      [{ curso: 'OSINT', creadoAt: '2026-07-01T09:00:00.000Z' }],
      'UTC',
      HOY,
    );
    expect(grupos[0].dia).toBe('2026-07-01');
  });

  it('los sin fecha (caché viejo) van al final, sin etiqueta', () => {
    const grupos = agruparInteresesPorDia(
      [
        { curso: 'Sin fecha', creadoAt: null },
        { curso: 'Inteligencia', creadoAt: '2026-07-01T00:00:00.000Z' },
      ],
      'UTC',
      HOY,
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
      HOY,
    );
    expect(grupos[0].cursos).toEqual(['OSINT']);
  });

  it('lista vacía → sin grupos', () => {
    expect(agruparInteresesPorDia([], 'UTC', HOY)).toEqual([]);
  });
});
