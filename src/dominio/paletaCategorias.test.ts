import { describe, expect, it } from 'vitest';
import {
  CLASE_BORDE,
  CLASE_BORDE_NEUTRO,
  CLASE_FONDO,
  CLASE_TEXTO,
  COLORES,
  claseBorde,
  esColorCategoria,
  normalizarNombre,
  resolverColor,
} from './paletaCategorias';

describe('paleta de categorías', () => {
  it('el enum de color rechaza gold y cualquier desconocido', () => {
    expect(esColorCategoria('azul')).toBe(true);
    expect(esColorCategoria('pizarra')).toBe(true);
    for (const malo of ['gold', 'dorado', 'amarillo', 'oro', 'amber', 'inexistente', '']) {
      expect(esColorCategoria(malo)).toBe(false);
    }
  });

  it('la paleta y sus mapas no contienen ningún token de oro/ámbar/amarillo', () => {
    const humoOro = /gold|oro|dorado|amarill|ambar|ámbar|amber|yellow/i;
    for (const c of COLORES) expect(humoOro.test(c)).toBe(false);
    const clases = [...Object.values(CLASE_BORDE), ...Object.values(CLASE_TEXTO), ...Object.values(CLASE_FONDO)];
    for (const clase of clases) expect(humoOro.test(clase)).toBe(false);
    expect(COLORES).toHaveLength(8);
  });

  it('normalizarNombre recorta, baja a minúsculas y capa a 30', () => {
    expect(normalizarNombre('  Interesada  ')).toBe('interesada');
    expect(normalizarNombre('PRECIO')).toBe('precio');
    expect(normalizarNombre('x'.repeat(40))).toHaveLength(30);
  });
});

describe('resolución string → color (el color de quien mira)', () => {
  const catalogo = [
    { nombre: 'interesada', color: 'azul' },
    { nombre: 'reclamo', color: 'rojo' },
  ];

  it('una etiqueta que matchea una categoría del que mira toma su clase de borde', () => {
    expect(resolverColor('Interesada', catalogo)).toBe('azul');
    expect(claseBorde(resolverColor('Interesada', catalogo))).toBe('border-cat-azul');
  });

  it('una etiqueta que NO matchea ninguna categoría se pinta neutra', () => {
    expect(resolverColor('spam', catalogo)).toBeNull();
    expect(claseBorde(resolverColor('spam', catalogo))).toBe(CLASE_BORDE_NEUTRO);
  });

  it('una categoría con color inválido (p.ej. dato viejo) cae a neutro, no revienta', () => {
    expect(resolverColor('rara', [{ nombre: 'rara', color: 'gold' }])).toBeNull();
  });
});
