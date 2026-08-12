import { describe, expect, it } from 'vitest';
import {
  cablesDe,
  cablesDeProducto,
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
    expect(r).toEqual([{ de: 'campana:1', a: 'v:luz', tipo: 'regla', color: 'campana' }]);
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
    expect(cablesDe(piezas, ['luz'])).toEqual([
      { de: 'campana:1', a: 'v:luz', tipo: 'regla', color: 'campana' },
    ]);
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

/**
 * 🔴 CADA CABLE LLEVA DE DÓNDE VIENE.
 *
 * Con todas las curvas del mismo navy no se sabía qué era cada nodo ni se podía
 * seguir un cable entre las veintiocho que nacen y mueren en los mismos puntos.
 * El color no es decoración: es el único dato que distingue una campaña de pago
 * de un formulario orgánico cuando lo que mirás es el trazo, no la tarjeta.
 */
describe('el color del cable dice de dónde viene', () => {
  it('una campaña y un formulario no pintan igual', () => {
    const cables = cablesDe(
      [
        pieza({ id: 'campana:1', icono: 'campana', vendedoras: ['luz'] }),
        pieza({ id: 'curso:X', icono: 'formulario', vendedoras: ['luz'] }),
      ],
      ['luz'],
    );
    expect(cables.map((c) => c.color)).toEqual(['campana', 'formulario']);
  });

  /** El cable del producto es el agregado, así que va en el color de la casa. */
  it('el del producto va aparte', () => {
    const p = pieza({ id: 'campana:1', familia: 'F', vendedoras: ['luz'] });
    const producto = { familia: 'F', nombre: 'X', piezas: [p], volumen: 1 };
    const suyos = cablesDeProducto(producto, cablesDe([p], ['luz']));
    expect(suyos).toEqual([{ de: 'prod:F', a: 'v:luz', tipo: 'regla', color: 'producto' }]);
  });

  /**
   * ⚠️ Y el punteado de pertenencia también: es lo que deja ver, de un vistazo,
   * cuántas de las piezas de un producto son pauta y cuántas son formulario.
   */
  it('el punteado de pertenencia hereda el tipo de la pieza', () => {
    const producto = {
      familia: 'F',
      nombre: 'X',
      piezas: [
        pieza({ id: 'campana:1', icono: 'campana', familia: 'F' }),
        pieza({ id: 'curso:X', icono: 'formulario', familia: 'F' }),
      ],
      volumen: 0,
    };
    const { pertenencia } = columnasDeProducto(producto, ['luz']);
    expect(pertenencia.map((c) => c.color)).toEqual(['campana', 'formulario']);
  });
});
