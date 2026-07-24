import { describe, expect, it } from 'vitest';
import { esAtajoLibreta, ordenarNotas, type Nota } from './notas';

/**
 * Puro, sin DOM (issue #47): el orden de la lista (espejo del `ORDER BY` del
 * server) y el atajo de teclado de la libreta.
 */

function nota(p: Partial<Nota>): Nota {
  return {
    id: 1,
    clave: 'general',
    vendedoraId: 'ana',
    texto: 'x',
    fijada: false,
    creadoAt: '2026-07-01T00:00:00Z',
    editadoAt: null,
    archivadoAt: null,
    ...p,
  };
}

describe('ordenarNotas', () => {
  it('las fijadas van primero, aunque sean más viejas', () => {
    const vieja = nota({ id: 1, fijada: true, creadoAt: '2026-01-01T00:00:00Z' });
    const nueva = nota({ id: 2, fijada: false, creadoAt: '2026-07-01T00:00:00Z' });
    expect(ordenarNotas([nueva, vieja]).map((n) => n.id)).toEqual([1, 2]);
  });

  it('entre notas del mismo estado de fijada, la más nueva va primero', () => {
    const a = nota({ id: 1, creadoAt: '2026-07-01T00:00:00Z' });
    const b = nota({ id: 2, creadoAt: '2026-07-10T00:00:00Z' });
    const c = nota({ id: 3, creadoAt: '2026-07-05T00:00:00Z' });
    expect(ordenarNotas([a, b, c]).map((n) => n.id)).toEqual([2, 3, 1]);
  });

  it('no muta el array original', () => {
    const lista = [nota({ id: 1 }), nota({ id: 2, fijada: true })];
    const copia = [...lista];
    ordenarNotas(lista);
    expect(lista).toEqual(copia);
  });

  it('lista vacía no revienta', () => {
    expect(ordenarNotas([])).toEqual([]);
  });
});

describe('esAtajoLibreta', () => {
  it('«n» sola SÍ es el atajo', () => {
    expect(esAtajoLibreta({ key: 'n' })).toBe(true);
    expect(esAtajoLibreta({ key: 'N' })).toBe(true);
  });

  it('⌘N / Ctrl+N NO son el atajo (son del sistema/navegador)', () => {
    expect(esAtajoLibreta({ key: 'n', metaKey: true })).toBe(false);
    expect(esAtajoLibreta({ key: 'n', ctrlKey: true })).toBe(false);
    expect(esAtajoLibreta({ key: 'n', altKey: true })).toBe(false);
  });

  it('otra tecla no dispara el atajo', () => {
    expect(esAtajoLibreta({ key: 'm' })).toBe(false);
    expect(esAtajoLibreta({ key: 'Enter' })).toBe(false);
  });
});
