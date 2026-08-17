import { describe, expect, it } from 'vitest';
import {
  CAPAS_INICIALES,
  agregarCapa,
  borrarCapa,
  cambiarCapa,
  capasNecesarias,
  esTocable,
  seleccionables,
  visibles,
  type Capa,
} from './capas';
import type { Figura } from './figuras';

/**
 * LAS CAPAS. Lo que se prueba acá es lo que decide si «bloqueada» y «oculta»
 * son reglas de verdad o solo un ícono distinto en un panel.
 */

function fig(id: string, capaId: string): Figura {
  return { id, capaId, opacidad: 1, clase: 'trazo', color: '#000', grosor: 2, puntos: [[0, 0]] };
}

const CAPAS: Capa[] = [
  { id: 'base', nombre: 'Capa 1', visible: true, bloqueada: false },
  { id: 'oculta', nombre: 'Capa 2', visible: false, bloqueada: false },
  { id: 'trabada', nombre: 'Capa 3', visible: true, bloqueada: true },
];

const FIGURAS = [fig('a', 'base'), fig('b', 'oculta'), fig('c', 'trabada')];

describe('qué se ve y qué se puede agarrar', () => {
  it('una capa oculta no se pinta', () => {
    expect(visibles(FIGURAS, CAPAS).map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('🔴 una capa BLOQUEADA se ve pero no se puede agarrar', () => {
    // Es la diferencia entre las dos listas, y de eso depende que bloquear sirva
    // para lo que sirve: dejar un croquis de fondo a la vista sin tocarlo por
    // accidente mientras se anota encima.
    expect(visibles(FIGURAS, CAPAS).map((f) => f.id)).toContain('c');
    expect(seleccionables(FIGURAS, CAPAS).map((f) => f.id)).not.toContain('c');
  });

  it('una capa oculta tampoco se puede agarrar', () => {
    expect(seleccionables(FIGURAS, CAPAS).map((f) => f.id)).toEqual(['a']);
  });

  it('una figura de una capa que NO existe se trata como visible y tocable', () => {
    // No perder lo que no se entiende: lo contrario deja objetos fantasma que
    // ocupan lugar, no se ven y no se pueden borrar.
    const suelta = fig('z', 'inventada');
    expect(visibles([suelta], CAPAS)).toHaveLength(1);
    expect(seleccionables([suelta], CAPAS)).toHaveLength(1);
    expect(esTocable(CAPAS, 'inventada')).toBe(true);
  });
});

describe('rescatar capas huérfanas', () => {
  it('🔴 una página guardada con una capa que ya no está no pierde sus figuras', () => {
    // Las capas viven en la sesión y las figuras en la base: sin este rescate,
    // abrir la página dejaría objetos invisibles e inalcanzables.
    const rescatadas = capasNecesarias(CAPAS_INICIALES, [fig('a', 'base'), fig('b', 'vieja')]);
    expect(rescatadas.map((c) => c.id)).toEqual(['base', 'vieja']);
    expect(rescatadas[1]).toMatchObject({ visible: true, bloqueada: false });
  });

  it('no duplica las que ya están', () => {
    expect(capasNecesarias(CAPAS, FIGURAS)).toHaveLength(3);
  });
});

describe('administrar capas', () => {
  it('agregar no repite un nombre que ya está', () => {
    // El número sale del conjunto usado y no de un contador: con «Capa 2»
    // borrada, la siguiente vuelve a ser «Capa 2» y no salta a «Capa 7».
    const dos = agregarCapa(CAPAS_INICIALES);
    expect(dos[1].nombre).toBe('Capa 2');
    expect(agregarCapa(dos)[2].nombre).toBe('Capa 3');
  });

  it('cambiar solo toca la capa nombrada', () => {
    const r = cambiarCapa(CAPAS, 'base', { bloqueada: true });
    expect(r[0].bloqueada).toBe(true);
    expect(r[1]).toEqual(CAPAS[1]);
  });

  it('🔴 la ÚLTIMA capa no se puede borrar', () => {
    // Sin ninguna capa, las figuras nuevas no tendrían dónde caer.
    expect(borrarCapa(CAPAS_INICIALES, 'base')).toBeNull();
  });

  it('🔴 borrar una capa dice a dónde mudar lo que tenía', () => {
    // Sus figuras NO se borran: borrar una capa por error no puede llevarse el
    // trabajo de una hora.
    const r = borrarCapa(CAPAS, 'oculta');
    expect(r?.capas.map((c) => c.id)).toEqual(['base', 'trabada']);
    expect(r?.mudarA).toBe('base');
  });
});
