import { describe, expect, test } from 'vitest';
import { alternar, comoQuery, contarActivos } from './padron';

/**
 * Las tres reglas puras del recorte, sin DOM ni red. La que importa es la
 * primera: un filtro apagado tiene que viajar AUSENTE, no en `false` ni como
 * lista vacía — las dos formas hacen que el server filtre por lo contrario de lo
 * que se pidió.
 */

describe('cómo viajan los filtros', () => {
  test('lo apagado NO se manda', () => {
    expect(comoQuery({ conVenta: false, q: '', pais: [] })).toBe('');
  });

  test('una lista vacía es «cualquiera», no «ninguno»', () => {
    // Mandar `pais=` haría que el server no encuentre a nadie: sería «ningún
    // país» en vez de «cualquier país».
    expect(comoQuery({ pais: [], curso: ['Foro de Estado'] })).toBe('curso=Foro+de+Estado');
  });

  test('varias opciones de una dimensión viajan separadas por coma', () => {
    expect(decodeURIComponent(comoQuery({ pais: ['Perú', 'México'] }))).toBe('pais=Perú,México');
  });

  test('lo prendido sí viaja', () => {
    const q = comoQuery({ conVenta: true, sinHabilitar: true, pagina: 3 });
    expect(q).toContain('conVenta=true');
    expect(q).toContain('sinHabilitar=true');
    expect(q).toContain('pagina=3');
  });
});

describe('alternar un valor', () => {
  test('lo agrega si no está y lo saca si está', () => {
    expect(alternar(undefined, 'Perú')).toEqual(['Perú']);
    expect(alternar(['Perú'], 'México')).toEqual(['Perú', 'México']);
    expect(alternar(['Perú', 'México'], 'Perú')).toEqual(['México']);
  });

  test('no muta el arreglo original', () => {
    const previo = ['Perú'];
    alternar(previo, 'México');
    expect(previo).toEqual(['Perú']);
  });
});

describe('cuántos filtros están puestos', () => {
  test('sin nada, cero', () => {
    expect(contarActivos({ pagina: 1, porPagina: 50 })).toBe(0);
  });

  test('cuenta cada VALOR, no cada dimensión', () => {
    // Tres países son tres chips que se sacan de a uno: si contara dimensiones,
    // el contador diría 1 y la barra mostraría 3.
    expect(contarActivos({ pais: ['Perú', 'México', 'Bolivia'] })).toBe(3);
  });

  test('suma texto y toggles', () => {
    expect(contarActivos({ q: ' javier ', conVenta: true, pais: ['Perú'] })).toBe(3);
  });

  test('un texto en blanco no cuenta como filtro', () => {
    expect(contarActivos({ q: '   ' })).toBe(0);
  });
});
