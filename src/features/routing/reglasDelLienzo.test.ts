import { describe, expect, it } from 'vitest';
import {
  alSoltar,
  conCambio,
  destinosDe,
  sePuedeUnir,
  type CableLienzo,
  type ColumnaLienzo,
} from './reglasDelLienzo';

const COLUMNAS: ColumnaLienzo[] = [
  { id: 'producto', ancho: 13, nodos: [{ id: 'prod:DIPCPOL', titulo: 'Consultor', icono: 'producto' }] },
  {
    id: 'piezas',
    ancho: 16,
    nodos: [
      { id: 'campana:1', titulo: '[AGO] CP', icono: 'campana' },
      { id: 'curso:X', titulo: 'Formulario CP', icono: 'formulario' },
    ],
  },
  {
    id: 'vendedoras',
    ancho: 12,
    nodos: [
      { id: 'v:ventas11', titulo: 'ventas11', icono: 'vendedora' },
      { id: 'v:ventas12', titulo: 'ventas12', icono: 'vendedora' },
    ],
  },
];

describe('qué puertos se pueden unir', () => {
  it('solo de una columna a la siguiente', () => {
    expect(sePuedeUnir(COLUMNAS, 'campana:1', 'v:ventas11')).toBe(true);
    expect(sePuedeUnir(COLUMNAS, 'prod:DIPCPOL', 'campana:1')).toBe(true);
  });

  /**
   * 🔴 El cable producto → vendedora saltearía la pieza, que es DONDE VIVE LA
   * REGLA. La pantalla lo dibujaría y el server no sabría qué guardar.
   */
  it('no se puede saltear una columna', () => {
    expect(sePuedeUnir(COLUMNAS, 'prod:DIPCPOL', 'v:ventas11')).toBe(false);
  });

  it('no se puede al revés ni consigo mismo', () => {
    // Arrastrar de derecha a izquierda es un gesto que la gente hace; sin la
    // guarda queda un cable invertido que nadie pidió.
    expect(sePuedeUnir(COLUMNAS, 'v:ventas11', 'campana:1')).toBe(false);
    expect(sePuedeUnir(COLUMNAS, 'campana:1', 'campana:1')).toBe(false);
  });

  it('un nodo que no está en ninguna columna no se une a nada', () => {
    expect(sePuedeUnir(COLUMNAS, 'no-existe', 'v:ventas11')).toBe(false);
    expect(sePuedeUnir(COLUMNAS, null, 'v:ventas11')).toBe(false);
    expect(sePuedeUnir(COLUMNAS, 'campana:1', null)).toBe(false);
  });
});

describe('soltar sobre un puerto', () => {
  const CABLES: CableLienzo[] = [{ de: 'campana:1', a: 'v:ventas11', tipo: 'regla' }];

  it('sobre uno libre, conecta', () => {
    expect(alSoltar(CABLES, 'campana:1', 'v:ventas12').accion).toBe('conectar');
  });

  it('sobre uno ya conectado, corta — el mismo gesto deshace', () => {
    expect(alSoltar(CABLES, 'campana:1', 'v:ventas11').accion).toBe('cortar');
  });

  /**
   * ⚠️ Un cable de PERTENENCIA (producto → pieza) no cuenta: lo decide el
   * catálogo, no una persona. Sin esta distinción, arrastrar sobre él lo
   * «cortaría» — y en la próxima carga volvería solo, porque nadie lo guardó.
   */
  it('un cable de pertenencia no se considera conectado', () => {
    const con: CableLienzo[] = [{ de: 'prod:DIPCPOL', a: 'campana:1', tipo: 'pertenencia' }];
    expect(alSoltar(con, 'prod:DIPCPOL', 'campana:1').accion).toBe('conectar');
  });
});

describe('el conjunto que viaja al server', () => {
  const CABLES: CableLienzo[] = [
    { de: 'campana:1', a: 'v:ventas12', tipo: 'regla' },
    { de: 'campana:1', a: 'v:ventas11', tipo: 'regla' },
    { de: 'curso:X', a: 'v:ventas11', tipo: 'regla' },
    { de: 'prod:DIPCPOL', a: 'campana:1', tipo: 'pertenencia' },
  ];

  it('son los destinos de ESE origen, ordenados', () => {
    expect(destinosDe(CABLES, 'campana:1')).toEqual(['v:ventas11', 'v:ventas12']);
  });

  it('no se mezcla con los de otro origen ni con la pertenencia', () => {
    expect(destinosDe(CABLES, 'curso:X')).toEqual(['v:ventas11']);
    expect(destinosDe(CABLES, 'prod:DIPCPOL')).toEqual([]);
  });
});

describe('el cambio se aplica sin mutar', () => {
  const CABLES: CableLienzo[] = [{ de: 'campana:1', a: 'v:ventas11', tipo: 'regla' }];

  it('conectar agrega, y queda pendiente hasta que el server confirme', () => {
    const r = conCambio(CABLES, 'campana:1', 'v:ventas12', 'conectar');
    expect(r).toHaveLength(2);
    expect(r.find((c) => c.a === 'v:ventas12')?.pendiente).toBe(true);
    expect(CABLES).toHaveLength(1);
  });

  it('cortar saca solo ese', () => {
    expect(conCambio(CABLES, 'campana:1', 'v:ventas11', 'cortar')).toEqual([]);
  });

  it('conectar dos veces no duplica', () => {
    const una = conCambio(CABLES, 'campana:1', 'v:ventas12', 'conectar');
    expect(conCambio(una, 'campana:1', 'v:ventas12', 'conectar')).toHaveLength(2);
  });
});
