import { describe, expect, it, vi } from 'vitest';
import {
  categoriasDeLaBarra,
  filtrosActivos,
  KEY_FILTRO_VIEJO,
  LINEA_MIAS,
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
  it('«pide-info» sobrevive: hoy la misma pregunta la contesta «Preguntaron precio»', () => {
    const a = almacen({ [KEY_FILTRO_VIEJO]: JSON.stringify('pide-info') });
    expect(migracionDesdeKeyVieja(a.leer, a.borrar)).toEqual({ tab: 'todo', filtroSec: 'pregunto-precio' });
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
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'pregunto-precio', categoria: null })).toEqual({
      intencion: 'pregunto-precio',
    });
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'te-escribieron', categoria: null })).toEqual({
      intencion: 'te-escribieron',
    });
  });

  it('los tres ejes se combinan (tab + filtro + categoría)', () => {
    expect(
      parametrosDeCola({ tab: 'no-leidos', filtroSec: 'pregunto-precio', categoria: 'precio' }),
    ).toEqual({ tab: 'no-leidos', intencion: 'pregunto-precio', categoria: 'precio' });
  });

  it('la línea viaja como `linea`, y «todas» no emite el param', () => {
    // El vacío TIENE que caerse de la URL: si viajara como `linea=`, el server
    // vería el param presente y —con la guarda que rechaza lo que no es un
    // teléfono— respondería 400 sobre la cola completa, que es el caso normal.
    expect(parametrosDeCola({ tab: 'todo', filtroSec: '', categoria: null, linea: '' })).toEqual({});
    expect(parametrosDeCola({ tab: 'todo', filtroSec: '', categoria: null, linea: '51941654039' })).toEqual({
      linea: '51941654039',
    });
  });

  it('la línea convive con los recortes: es otro eje, no los reemplaza', () => {
    expect(
      parametrosDeCola({ tab: 'no-leidos', filtroSec: 'pregunto-precio', categoria: null, linea: '51941654039' }),
    ).toEqual({ tab: 'no-leidos', intencion: 'pregunto-precio', linea: '51941654039' });
  });

  it('«las mías» NO viaja como `linea`: no es un teléfono y el server lo rechazaría', () => {
    // Comparte el estado con la línea (es el mismo eje: ¿qué cola miro?) pero
    // sale por otro parámetro. Si viajara como `linea=mias`, la guarda de la
    // ruta —la que exige un teléfono— respondería 400 y la vendedora vería un
    // error en vez de su cola.
    expect(parametrosDeCola({ tab: 'todo', filtroSec: '', categoria: null, linea: LINEA_MIAS })).toEqual({
      mias: '1',
    });
  });

  it('«las mías» y una línea explícita no pueden viajar juntas: es un solo eje', () => {
    // No hay estado que las tenga a las dos, así que no hay nada que arbitrar en
    // el server. El test lo fija porque el bug sería silencioso: dos banderas
    // independientes habilitarían «las mías Y solo Walter».
    const p = parametrosDeCola({ tab: 'todo', filtroSec: '', categoria: null, linea: LINEA_MIAS });
    expect(p.linea).toBeUndefined();
  });

  it('los filtros del bot viajan como `intencion`, igual que los otros tres', () => {
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'bot-escalada', categoria: null })).toEqual({
      intencion: 'bot-escalada',
    });
    expect(parametrosDeCola({ tab: 'todo', filtroSec: 'bot-caliente', categoria: null })).toEqual({
      intencion: 'bot-caliente',
    });
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
    expect(filtrosActivos({ ...limpia, filtroSec: 'pregunto-precio' })).toEqual([
      { clave: 'filtro', label: 'Preguntaron precio' },
    ]);
    expect(filtrosActivos({ ...limpia, filtroSec: 'te-escribieron' })).toEqual([
      { clave: 'filtro', label: 'Te escribieron' },
    ]);
  });

  it('la categoría y la búsqueda también son recortes, y se acumulan en orden', () => {
    expect(
      filtrosActivos({ tab: 'no-leidos', filtroSec: 'pregunto-precio', categoria: 'precio', busqueda: ' juan ' }),
    ).toEqual([
      { clave: 'tab', label: 'No leídos' },
      { clave: 'filtro', label: 'Preguntaron precio' },
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
