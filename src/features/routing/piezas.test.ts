import { describe, expect, it } from 'vitest';
import {
  cablesDe,
  cablesHuerfanos,
  columnasDePieza,
  columnasDeProducto,
  leerId,
  type Pieza,
} from './piezas';

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

/**
 * 🔴 EL CONTEXTO NO SE PIERDE AL ABRIR.
 *
 * La versión anterior reemplazaba el lienzo por el «nivel de adentro» de la
 * campaña —anuncios · campaña · vendedoras—, y ahí **el producto y las campañas
 * hermanas desaparecían**. El dueño lo dijo mirando la captura el 12-ago-2026:
 * *«no sale el producto atrás de todo, tiene que ser más fácil de interactuar y
 * vigilar todo»*. Estos tests fijan que abrir SUMA detalle y no QUITA contexto.
 */
describe('🔴 abrir una campaña no se lleva el producto ni a sus hermanas', () => {
  const unaCampana = pieza({ id: 'campana:1', titulo: 'AGO OSINT', familia: 'DIPICOT' });
  const otraCampana = pieza({ id: 'campana:2', titulo: 'JUL OSINT', familia: 'DIPICOT' });
  const formulario = pieza({
    id: 'curso:Diploma',
    titulo: 'Diploma',
    icono: 'formulario',
    familia: 'DIPICOT',
  });
  const producto = {
    familia: 'DIPICOT',
    nombre: 'Diploma en Inteligencia',
    piezas: [unaCampana, otraCampana, formulario],
    volumen: 41,
  };
  const anuncios = [{ adId: '9', titular: 'Estudiá OSINT', personas: 7 }];

  const abierto = columnasDeProducto(producto, ['luz'], {
    id: 'campana:1',
    anuncios,
    cargando: false,
  });

  it('el producto sigue a la cabeza', () => {
    expect(abierto.columnas[0]?.nodos.map((n) => n.id)).toEqual(['prod:DIPICOT']);
  });

  it('y las tres piezas siguen a la vista, no solo la abierta', () => {
    expect(abierto.columnas[1]?.nodos.map((n) => n.id)).toEqual([
      'campana:1',
      'campana:2',
      'curso:Diploma',
    ]);
  });

  it('las columnas son las MISMAS abierta y cerrada: abrir suma detalle, no cambia la topología', () => {
    const cerrado = columnasDeProducto(producto, ['luz']);
    expect(abierto.columnas.map((c) => c.id)).toEqual(cerrado.columnas.map((c) => c.id));
    expect(abierto.pertenencia).toEqual(cerrado.pertenencia);
  });

  it('los anuncios cuelgan de la campaña abierta y de ninguna otra', () => {
    const [uno, dos] = abierto.columnas[1]!.nodos;
    expect(uno?.adentro?.map((a) => a.titulo)).toEqual(['Estudiá OSINT']);
    expect(dos?.adentro).toBeUndefined();
  });

  /**
   * ⚠️ Sin esto, una campaña cuyos anuncios están viajando se lee igual que una
   * que no tiene ninguno — y «ningún anuncio trajo gente» sería una afirmación
   * falsa sobre la pauta, dicha con total seguridad.
   */
  it('cargando no es lo mismo que no tener anuncios', () => {
    const cargando = columnasDeProducto(producto, ['luz'], {
      id: 'campana:1',
      anuncios: [],
      cargando: true,
    });
    expect(cargando.columnas[1]?.nodos[0]?.cargando).toBe(true);
    expect(abierto.columnas[1]?.nodos[0]?.cargando).toBe(false);
  });

  /** Un formulario no tiene anuncios adentro: ofrecer el chevron sería mentir. */
  it('solo las campañas se pueden abrir', () => {
    const nodos = abierto.columnas[1]!.nodos;
    expect(nodos.map((n) => n.abrible)).toEqual([true, true, false]);
  });

  it('una pieza suelta también se abre, y sin columna de producto inventada', () => {
    const cols = columnasDePieza(unaCampana, ['luz'], { id: 'campana:1', anuncios, cargando: false });
    expect(cols.map((c) => c.id)).toEqual(['pieza', 'vendedoras']);
    expect(cols[0]?.nodos[0]?.adentro).toHaveLength(1);
  });
});
