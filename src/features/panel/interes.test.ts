import { describe, expect, it } from 'vitest';
import { decidirInteres } from './interes';

const FORM = { lead_curso: 'Diploma Internacional de Operaciones Psicológicas y Psicosociales' };
const ANUNCIO = { ultima_origen: { fuente: 'anuncio', titulo: 'Diploma de Inteligencia y Contrainteligencia 14' } };

describe('decidirInteres — el clic que destraba el embudo', () => {
  it('con interés registrado no propone nada: ya está', () => {
    expect(decidirInteres(['Inteligencia y Contrainteligencia'], FORM)).toEqual({ modo: 'registrado' });
  });

  it('sin interés pero con el curso del formulario, propone ese y dice de dónde salió', () => {
    const d = decidirInteres([], FORM);
    expect(d.modo).toBe('propuesta');
    if (d.modo !== 'propuesta') throw new Error('debía proponer');
    expect(d.curso.fuente).toBe('lead');
    expect(d.porque).toMatch(/formulario/i);
  });

  it('sin formulario, el anuncio por el que escribió alcanza para proponer', () => {
    const d = decidirInteres([], ANUNCIO);
    expect(d.modo).toBe('propuesta');
    if (d.modo !== 'propuesta') throw new Error('debía proponer');
    expect(d.curso.fuente).toBe('anuncio');
    expect(d.porque).toMatch(/anuncio/i);
  });

  it('el formulario le gana al anuncio: lo eligió ella, no la pauta', () => {
    const d = decidirInteres([], { ...FORM, ...ANUNCIO });
    if (d.modo !== 'propuesta') throw new Error('debía proponer');
    expect(d.curso.fuente).toBe('lead');
  });

  it('sin ninguna fuente NO se inventa un curso — se pide', () => {
    expect(decidirInteres([], {})).toEqual({ modo: 'vacio' });
    expect(decidirInteres([], { lead_curso: '   ' })).toEqual({ modo: 'vacio' });
  });

  it('un origen que no es anuncio (landing, orgánico) no propone curso', () => {
    expect(decidirInteres([], { ultima_origen: { fuente: 'landing', titulo: 'goberna.us' } })).toEqual({
      modo: 'vacio',
    });
  });

  it('si la fila trae un interés viejo y la lista vino vacía, no ofrece registrar lo ya registrado', () => {
    expect(decidirInteres([], { interes_curso: 'OSINT' })).toEqual({ modo: 'vacio' });
  });

  it('el nombre propuesto viene ya acortado por familia: no una línea de 60 caracteres', () => {
    const d = decidirInteres([], ANUNCIO);
    if (d.modo !== 'propuesta') throw new Error('debía proponer');
    expect(d.curso.nombre.length).toBeLessThan(
      'Diploma de Inteligencia y Contrainteligencia 14'.length,
    );
  });
});
