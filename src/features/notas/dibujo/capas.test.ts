import { describe, expect, it } from 'vitest';
import {
  CAPAS_INICIALES,
  agregarCapa,
  borrarCapa,
  cambiarCapa,
  capasNecesarias,
  duplicarCapa,
  esTocable,
  figurasDe,
  moverCapa,
  opacidadEfectiva,
  ordenarParaPintar,
  seleccionables,
  visibles,
  type Capa,
} from './capas';
import type { Figura } from './figuras';

/**
 * LAS CAPAS. Lo que se prueba acá es lo que decide si «bloqueada» y «oculta»
 * son reglas de verdad o solo un ícono distinto en un panel.
 */

function fig(id: string, capaId: string, opacidad = 1): Figura {
  return { id, capaId, opacidad, clase: 'trazo', color: '#000', grosor: 2, puntos: [[0, 0]] };
}

const CAPAS: Capa[] = [
  { id: 'base', nombre: 'Capa 1', visible: true, bloqueada: false, opacidad: 1 },
  { id: 'oculta', nombre: 'Capa 2', visible: false, bloqueada: false, opacidad: 1 },
  { id: 'trabada', nombre: 'Capa 3', visible: true, bloqueada: true, opacidad: 0.5 },
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
    const dos = agregarCapa(CAPAS_INICIALES).capas;
    expect(dos[1].nombre).toBe('Capa 2');
    expect(agregarCapa(dos).capas[2].nombre).toBe('Capa 3');
  });

  it('🔴 la capa nueva va ENCIMA de la activa, no al final', () => {
    // Es lo que se espera al apretar «+» parado en una capa del medio; mandarla
    // siempre al tope obliga a arrastrarla de vuelta cada vez.
    const r = agregarCapa(CAPAS, 'base');
    expect(r.capas.map((c) => c.id)).toEqual(['base', r.nueva.id, 'oculta', 'trabada']);
  });

  it('la capa nueva nace visible, desbloqueada y opaca', () => {
    expect(agregarCapa(CAPAS_INICIALES).nueva).toMatchObject({ visible: true, bloqueada: false, opacidad: 1 });
  });

  it('cambiar solo toca la capa nombrada', () => {
    const r = cambiarCapa(CAPAS, 'base', { bloqueada: true });
    expect(r[0].bloqueada).toBe(true);
    expect(r[1]).toEqual(CAPAS[1]);
  });

  it('🔴 la ÚLTIMA capa no se puede borrar', () => {
    // Sin ninguna capa, las figuras nuevas no tendrían dónde caer.
    expect(borrarCapa(CAPAS_INICIALES, FIGURAS, 'base')).toBeNull();
  });

  it('🔴 borrar una capa DICE cuántos objetos se lleva', () => {
    // Es lo que deja preguntar antes con un número de verdad, en vez de un
    // «¿estás segura?» que nadie lee.
    const r = borrarCapa(CAPAS, FIGURAS, 'oculta');
    expect(r?.capas.map((c) => c.id)).toEqual(['base', 'trabada']);
    expect(r?.seLleva).toEqual(['b']);
  });

  it('al borrar queda activa la capa DE AL LADO, no el fondo', () => {
    // Borrando la 3 de tres, se queda parado en la 2 y no salta al principio.
    expect(borrarCapa(CAPAS, FIGURAS, 'trabada')?.activaNueva).toBe('oculta');
  });
});

describe('el orden de pintado', () => {
  it('🔴 manda la CAPA primero y la figura después', () => {
    // Antes las capas eran solo etiquetas y el orden lo decidía el array de
    // figuras: arrastrar una capa no cambiaba nada de lo que se veía.
    const sueltas = [fig('z', 'trabada'), fig('a', 'base')];
    expect(ordenarParaPintar(sueltas, CAPAS).map((f) => f.id)).toEqual(['a', 'z']);
  });

  it('dentro de una capa se conserva el orden del array', () => {
    const dos = [fig('primera', 'base'), fig('segunda', 'base')];
    expect(ordenarParaPintar(dos, CAPAS).map((f) => f.id)).toEqual(['primera', 'segunda']);
  });

  it('una figura de una capa desconocida va al final, no desaparece', () => {
    const suelta = fig('huerfana', 'niIdea');
    expect(ordenarParaPintar([suelta, fig('a', 'base')], CAPAS).map((f) => f.id)).toEqual(['a', 'huerfana']);
  });

  it('moverCapa reubica y recorta a los extremos', () => {
    expect(moverCapa(CAPAS, 'base', 2).map((c) => c.id)).toEqual(['oculta', 'trabada', 'base']);
    expect(moverCapa(CAPAS, 'base', -5).map((c) => c.id)).toEqual(['base', 'oculta', 'trabada']);
    expect(moverCapa(CAPAS, 'inventada', 0)).toEqual(CAPAS);
  });
});

describe('la opacidad', () => {
  it('🔴 la de la capa MULTIPLICA la del objeto, no la pisa', () => {
    // Un objeto al 50 % en una capa al 50 % se ve al 25 %. Pisar el valor haría
    // que mover el deslizador de la capa destruyera lo que la vendedora eligió
    // a mano, sin forma de recuperarlo.
    expect(opacidadEfectiva(fig('x', 'trabada', 0.5), CAPAS)).toBeCloseTo(0.25, 5);
  });

  it('subir la capa de vuelta devuelve al objeto SU opacidad', () => {
    const plena = cambiarCapa(CAPAS, 'trabada', { opacidad: 1 });
    expect(opacidadEfectiva(fig('x', 'trabada', 0.5), plena)).toBeCloseTo(0.5, 5);
  });

  it('una capa desconocida no atenúa nada', () => {
    expect(opacidadEfectiva(fig('x', 'niIdea', 0.8), CAPAS)).toBeCloseTo(0.8, 5);
  });
});

describe('duplicar una capa', () => {
  it('🔴 copia sus objetos con ids NUEVOS y en la capa nueva', () => {
    const r = duplicarCapa(CAPAS, FIGURAS, 'base');
    const copias = figurasDe(r!.figuras, r!.nueva.id);
    expect(copias).toHaveLength(1);
    expect(copias[0].id).not.toBe('a');
  });

  it('🔴 la copia NO se corre de lugar', () => {
    // Al revés de duplicar objetos sueltos: acá la copia va en otra capa, así
    // que queda calcada encima del original — que es para lo que sirve.
    const conPos: Figura[] = [{ ...fig('a', 'base'), clase: 'trazo', puntos: [[10, 20]] } as Figura];
    const r = duplicarCapa(CAPAS, conPos, 'base');
    const copia = figurasDe(r!.figuras, r!.nueva.id)[0];
    expect(copia.clase === 'trazo' && copia.puntos[0]).toEqual([10, 20]);
  });

  it('la capa nueva va justo encima y conserva las perillas', () => {
    const r = duplicarCapa(CAPAS, FIGURAS, 'trabada');
    expect(r!.capas.map((c) => c.id)).toEqual(['base', 'oculta', 'trabada', r!.nueva.id]);
    expect(r!.nueva).toMatchObject({ bloqueada: true, opacidad: 0.5 });
    expect(r!.nueva.nombre).toContain('copia');
  });

  it('duplicar una capa que no existe no rompe', () => {
    expect(duplicarCapa(CAPAS, FIGURAS, 'inventada')).toBeNull();
  });
});
