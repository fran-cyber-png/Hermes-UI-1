import { describe, expect, it, vi } from 'vitest';
import {
  categoriasDeLaBarra,
  filtrosActivos,
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

  it('«puedo-escribirle» NO revive como «Por vencer»: eso abría la cola vacía', () => {
    // Medido contra producción el 25-jul-2026: `ventana_abierta` es true en 0 de
    // 1.867 conversaciones (la cola es 100% WhatsApp y la ventana es de
    // comentarios FB/IG). Mandar a la vendedora que volvía a un filtro que da
    // cero filas es peor que no migrar nada.
    const a = almacen({ [KEY_FILTRO_VIEJO]: JSON.stringify('puedo-escribirle') });
    expect(migracionDesdeKeyVieja(a.leer, a.borrar)).toEqual({ tab: 'todo', filtroSec: '' });
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
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'sin-responder', categoria: null })).toEqual({
      intencion: 'sin-responder',
    });
  });

  it('los tres ejes se combinan (tab + filtro + categoría)', () => {
    expect(
      parametrosDeCola({ tab: 'no-leidos', filtroSec: 'pide-info', categoria: 'precio' }),
    ).toEqual({ tab: 'no-leidos', intencion: 'pide-info', categoria: 'precio' });
  });
});

describe('filtrosActivos — qué está recortando la cola AHORA MISMO', () => {
  const limpia = { tab: 'todo', filtroSec: '', categoria: null, busqueda: '' } as const;

  it('la cola sin recortes no tiene nada activo', () => {
    expect(filtrosActivos(limpia)).toEqual([]);
  });

  it('el tab «Todo» no cuenta como recorte, los otros sí', () => {
    expect(filtrosActivos({ ...limpia, tab: 'no-leidos' })).toEqual([{ clave: 'tab', label: 'No leídos' }]);
    expect(filtrosActivos({ ...limpia, tab: 'favoritos' })).toEqual([{ clave: 'tab', label: 'Favoritos' }]);
  });

  it('nombra el filtro secundario con su rótulo visible, no con su valor', () => {
    expect(filtrosActivos({ ...limpia, filtroSec: 'pide-info' })).toEqual([{ clave: 'filtro', label: 'Piden info' }]);
    expect(filtrosActivos({ ...limpia, filtroSec: 'sin-responder' })).toEqual([
      { clave: 'filtro', label: 'Sin responder' },
    ]);
  });

  it('la categoría y la búsqueda también son recortes, y se acumulan en orden', () => {
    expect(filtrosActivos({ tab: 'no-leidos', filtroSec: 'pide-info', categoria: 'precio', busqueda: ' juan ' })).toEqual([
      { clave: 'tab', label: 'No leídos' },
      { clave: 'filtro', label: 'Piden info' },
      { clave: 'categoria', label: 'precio' },
      { clave: 'busqueda', label: '«juan»' },
    ]);
  });

  it('una búsqueda de puros espacios no recorta nada', () => {
    expect(filtrosActivos({ ...limpia, busqueda: '   ' })).toEqual([]);
  });
});

describe('categoriasDeLaBarra — el orden de los chips de categoría', () => {
  const cat = (nombre: string, orden: number, esFavorito = false, conteo = 0) => ({
    nombre,
    color: 'azul',
    orden,
    esFavorito,
    conteo,
  });

  it('las favoritas van primero, y dentro de cada grupo manda el orden manual', () => {
    const barra = categoriasDeLaBarra([
      cat('reclamo', 2),
      cat('precio', 5, true),
      cat('interesada', 1),
      cat('urgente', 0, true),
    ]);
    expect(barra.map((c) => c.nombre)).toEqual(['urgente', 'precio', 'interesada', 'reclamo']);
  });

  it('la categoría ACTIVA entra siempre, aunque quede fuera del tope', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => cat(`c${i}`, i));
    const barra = categoriasDeLaBarra(muchas, 'c19');
    expect(barra.map((c) => c.nombre)).toContain('c19');
  });

  it('no muestra una lista infinita: corta en el tope', () => {
    const muchas = Array.from({ length: 30 }, (_, i) => cat(`c${i}`, i));
    expect(categoriasDeLaBarra(muchas).length).toBeLessThanOrEqual(12);
  });

  it('sin catálogo no hay chips (y no revienta)', () => {
    expect(categoriasDeLaBarra([])).toEqual([]);
    expect(categoriasDeLaBarra(undefined)).toEqual([]);
  });
});
