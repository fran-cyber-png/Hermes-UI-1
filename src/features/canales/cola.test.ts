import { describe, expect, it, vi } from 'vitest';
import {
  KEY_FILTRO_VIEJO,
  migracionDesdeKeyVieja,
  migrarFiltroViejo,
  parametrosDeCola,
} from './cola';

/** Un localStorage de mentira: devuelve lo sembrado y registra qué se borró. */
function almacen(inicial: Record<string, string>) {
  const datos = { ...inicial };
  const borrar = vi.fn((k: string) => {
    delete datos[k];
  });
  return { leer: (k: string) => datos[k] ?? null, borrar, datos };
}

describe('migracionDesdeKeyVieja', () => {
  it('«pide-info» sobrevive como filtro secundario, no se pierde', () => {
    const a = almacen({ [KEY_FILTRO_VIEJO]: JSON.stringify('pide-info') });
    expect(migracionDesdeKeyVieja(a.leer, a.borrar)).toEqual({ tab: 'todo', filtroSec: 'pide-info' });
  });

  it('«puedo-escribirle» se traduce a su reencarnación «Por vencer»', () => {
    const a = almacen({ [KEY_FILTRO_VIEJO]: JSON.stringify('puedo-escribirle') });
    expect(migracionDesdeKeyVieja(a.leer, a.borrar)).toEqual({ tab: 'todo', filtroSec: 'por-vencer' });
  });

  it('borra la key vieja para no volver a pisar lo que la vendedora elija después', () => {
    const a = almacen({ [KEY_FILTRO_VIEJO]: JSON.stringify('pide-info') });
    migracionDesdeKeyVieja(a.leer, a.borrar);
    expect(a.borrar).toHaveBeenCalledWith(KEY_FILTRO_VIEJO);
    expect(a.datos[KEY_FILTRO_VIEJO]).toBeUndefined();
  });

  it('sin key vieja (usuaria nueva o ya migrada) no hay nada que migrar', () => {
    const a = almacen({});
    expect(migracionDesdeKeyVieja(a.leer, a.borrar)).toBeNull();
  });

  it('un valor corrupto no revienta: cae en Todo sin filtro', () => {
    const a = almacen({ [KEY_FILTRO_VIEJO]: '{no es json' });
    expect(migracionDesdeKeyVieja(a.leer, a.borrar)).toEqual({ tab: 'todo', filtroSec: '' });
  });
});

describe('migrarFiltroViejo', () => {
  it('el valor viejo «puedo-escribirle» cae en el tab por defecto «todo»', () => {
    // El default cambió (#49): sin esto, el caché persistido abría un filtro muerto.
    expect(migrarFiltroViejo('puedo-escribirle')).toBe('todo');
  });

  it('«pide-info» ya no es un tab: también migra a «todo» (sobrevive como filtro secundario)', () => {
    expect(migrarFiltroViejo('pide-info')).toBe('todo');
  });

  it('un tab válido pasa tal cual', () => {
    expect(migrarFiltroViejo('no-leidos')).toBe('no-leidos');
    expect(migrarFiltroViejo('favoritos')).toBe('favoritos');
    expect(migrarFiltroViejo('todo')).toBe('todo');
  });

  it('null, vacío o basura caen en «todo»', () => {
    expect(migrarFiltroViejo(null)).toBe('todo');
    expect(migrarFiltroViejo('')).toBe('todo');
    expect(migrarFiltroViejo('cualquier-cosa')).toBe('todo');
  });
});

describe('parametrosDeCola', () => {
  it('el default (tab todo, sin filtro ni categoría) no emite ningún param', () => {
    expect(parametrosDeCola({ tab: 'todo', filtroSec: '', categoria: null })).toEqual({});
  });

  it('el tab no-default viaja como `tab`', () => {
    expect(parametrosDeCola({ tab: 'no-leidos', filtroSec: '', categoria: null })).toEqual({ tab: 'no-leidos' });
    expect(parametrosDeCola({ tab: 'favoritos', filtroSec: '', categoria: null })).toEqual({ tab: 'favoritos' });
  });

  it('el filtro secundario viaja como `intencion` (compat con el server)', () => {
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'pide-info', categoria: null })).toEqual({ intencion: 'pide-info' });
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'por-vencer', categoria: null })).toEqual({ intencion: 'por-vencer' });
  });

  it('los tres ejes se combinan (tab + filtro + categoría)', () => {
    expect(
      parametrosDeCola({ tab: 'no-leidos', filtroSec: 'pide-info', categoria: 'precio' }),
    ).toEqual({ tab: 'no-leidos', intencion: 'pide-info', categoria: 'precio' });
  });
});
