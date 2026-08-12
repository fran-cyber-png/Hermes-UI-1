import { describe, expect, it } from 'vitest';
import { cablesDe, cablesHuerfanos, leerId, type Pieza } from './piezas';

const pieza = (p: Partial<Pieza>): Pieza => ({
  id: 'campana:1',
  titulo: 'x',
  icono: 'campana',
  pie: '',
  familia: null,
  volumen: 0,
  vendedoras: [],
  ...p,
});

describe('🔴 el cable no puede volverse invisible por la grafía', () => {
  /**
   * En producción el mismo humano tiene dos grafías vivas: Cerberus empuja `Luz`
   * y ella entra como `luz`. Si el cable guardado dice una y la columna la otra,
   * el cable apuntaba a un nodo inexistente: no se dibujaba, no se podía cortar,
   * y la fila de la izquierda igual decía que la campaña era de alguien.
   */
  it('resuelve el destino normalizando, y usa la grafía de la columna', () => {
    const r = cablesDe([pieza({ vendedoras: ['Luz'] })], ['luz', 'Tracy']);
    expect(r).toEqual([{ de: 'campana:1', a: 'v:luz', tipo: 'regla' }]);
  });

  it('anda en los dos sentidos', () => {
    expect(cablesDe([pieza({ vendedoras: ['tracy'] })], ['Tracy'])[0]?.a).toBe('v:Tracy');
  });

  it('y no le importan los espacios de más', () => {
    expect(cablesDe([pieza({ vendedoras: ['  Luz  '] })], ['luz'])[0]?.a).toBe('v:luz');
  });
});

describe('un cable hacia alguien que ya no está', () => {
  const piezas = [pieza({ vendedoras: ['luz', 'se-fue@goberna.com'] })];

  it('no se dibuja: inventarle un nodo sería ofrecer a alguien que el server rechaza', () => {
    expect(cablesDe(piezas, ['luz'])).toEqual([{ de: 'campana:1', a: 'v:luz', tipo: 'regla' }]);
  });

  it('pero se DENUNCIA, para que la ausencia no sea muda', () => {
    expect(cablesHuerfanos(piezas, ['luz'])).toEqual(['se-fue@goberna.com']);
  });

  it('sin huérfanos no hay nada que denunciar', () => {
    expect(cablesHuerfanos(piezas, ['luz', 'se-fue@goberna.com'])).toEqual([]);
  });
});

describe('los ids del lienzo', () => {
  /** ⚠️ Un curso puede tener `:` adentro; con `split` la clave se partiría al medio. */
  it('un curso con dos puntos vuelve entero', () => {
    expect(leerId('curso:Diploma: OSINT & SOCMINT')).toEqual({
      tipo: 'curso',
      clave: 'Diploma: OSINT & SOCMINT',
    });
  });

  it('un id sin prefijo no rompe', () => {
    expect(leerId('suelto')).toEqual({ tipo: 'suelto', clave: '' });
  });
});
