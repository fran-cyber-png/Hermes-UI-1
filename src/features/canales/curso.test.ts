import { describe, expect, test } from 'vitest';
import { COLORES } from '../gestion/paletaCategorias';
import { colorDeCurso, cursoDeFila, PALETA_CURSO } from './curso';

/**
 * LA PRECEDENCIA DEL CHIP DE CURSO (#72, decisión del dueño 2026-07-24) y su
 * color. Todo puro: sin React, sin base.
 */

describe('cursoDeFila — el interés manda, el lead respalda, el anuncio es el último recurso', () => {
  // El referral de Click-to-WhatsApp viaja SOLO en el primer mensaje: en cuanto
  // la persona escribe una segunda vez, `ultima_origen` queda en null y el chip
  // perdía el anuncio. `origen_anuncio` (el primero de la conversación) es lo
  // que mira el Dashboard, y ahora también el chip.
  test('el anuncio sale del PRIMERO de la conversación, no del último mensaje', () => {
    const r = cursoDeFila({
      origen_anuncio: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' },
      ultima_origen: null,
    });
    expect(r?.fuente).toBe('anuncio');
    expect(r?.nombre).toBe('Inteligencia Estratégica');
  });

  test('sin `origen_anuncio` (server viejo) sigue usando `ultima_origen`', () => {
    const r = cursoDeFila({ ultima_origen: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' } });
    expect(r?.fuente).toBe('anuncio');
  });

  test('con interés registrado, gana el interés aunque haya lead y anuncio', () => {
    const r = cursoDeFila({
      interes_curso: 'Diploma de Especialización en Inteligencia y Contrainteligencia 14',
      lead_curso: 'Diploma Internacional del Consultor Político',
      ultima_origen: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' },
    });
    expect(r?.fuente).toBe('interes');
    expect(r?.nombre).toBe('Inteligencia y Contrainteligencia');
  });

  test('sin interés, gana el curso del formulario que llenó (el lead)', () => {
    const r = cursoDeFila({
      lead_curso: 'Diploma Internacional del Consultor Político',
      ultima_origen: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' },
    });
    expect(r?.fuente).toBe('lead');
    expect(r?.nombre).toBe('Consultor Político');
  });

  test('sin interés ni lead, respalda la campaña del anuncio', () => {
    const r = cursoDeFila({ ultima_origen: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' } });
    expect(r?.fuente).toBe('anuncio');
    expect(r?.nombre).toBe('Inteligencia Estratégica');
  });

  test('un origen que NO es anuncio (una landing) no da curso: no se inventa', () => {
    expect(cursoDeFila({ ultima_origen: { fuente: 'landing', titulo: 'goberna.us/oratoria' } })).toBeNull();
  });

  test('sin ninguna de las tres fuentes, no hay chip', () => {
    expect(cursoDeFila({})).toBeNull();
    expect(cursoDeFila({ interes_curso: null, lead_curso: null, ultima_origen: null })).toBeNull();
  });

  test('cadenas vacías o en blanco no cuentan como fuente', () => {
    const r = cursoDeFila({ interes_curso: '   ', ultima_origen: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' } });
    expect(r?.fuente).toBe('anuncio');
    expect(cursoDeFila({ ultima_origen: { fuente: 'anuncio', titulo: '' } })).toBeNull();
  });

  test('dos redacciones del MISMO diploma comparten familia y por lo tanto color', () => {
    const a = cursoDeFila({ interes_curso: 'Diploma de Especialización en Inteligencia y Contrainteligencia 14' });
    const b = cursoDeFila({ interes_curso: 'diploma internacional de inteligencia y contrainteligencia' });
    expect(a?.familia).toBe(b?.familia);
    expect(a?.color).toBe(b?.color);
  });
});

describe('colorDeCurso — determinista, sin oro y sin el neutro', () => {
  test('el mismo curso da siempre el mismo color', () => {
    expect(colorDeCurso('DIPICOT')).toBe(colorDeCurso('DIPICOT'));
  });

  test('la paleta del curso NO tiene oro ni ámbar ni el gris neutro', () => {
    expect(PALETA_CURSO).not.toContain('pizarra');
    for (const c of PALETA_CURSO) {
      expect(c).not.toMatch(/oro|gold|ambar|amarillo/i);
      expect(COLORES).toContain(c);
    }
  });

  test('reparte: familias distintas no caen todas en el mismo color', () => {
    const familias = ['DIPICOT', 'DIPCPOL', 'EPCOORP', 'DIPIAMP', 'DIPOSOC', 'DIPTEEI', 'DIPDIRS', 'DIPSTC'];
    const usados = new Set(familias.map(colorDeCurso));
    expect(usados.size).toBeGreaterThanOrEqual(4);
  });

  test('siempre devuelve un color de la paleta, incluso con entrada vacía', () => {
    expect(PALETA_CURSO).toContain(colorDeCurso(''));
  });
});
