import { describe, expect, it, vi } from 'vitest';
import { armarItemsMenu, HERRAMIENTAS } from './itemsHerramientas';

describe('armarItemsMenu', () => {
  /**
   * Las cinco de `FLUJO.md` **en su orden**, más una sexta que no estaba ahí.
   *
   * «Datos recomendados» se agregó el 4-ago-2026 y no reusa el slot `catalogo`
   * a propósito: aquél es el catálogo de CURSOS con contexto (#51), que se
   * consulta; éste es el catálogo `hechos`, que se EDITA y es del equipo.
   *
   * Va última para no reordenar lo decidido: el orden de las cinco primeras es
   * el de `FLUJO.md` y este test lo fija.
   */
  it('arma las herramientas en el orden de FLUJO.md, con «datos» al final', () => {
    const items = armarItemsMenu('conv:whatsapp:521:519');
    expect(items.map((i) => i.id)).toEqual([
      'correo',
      'mensajes',
      'etiquetas',
      'notas',
      'catalogo',
      'datos',
    ]);
    expect(items).toHaveLength(HERRAMIENTAS.length);
  });

  /**
   * La puerta al catálogo de datos tiene que EXISTIR y estar habilitada: su
   * versión anterior vivía en `hechos/BloqueHechos.tsx`, que **nadie monta**
   * desde que el panel derecho se reescribió como timeline (`0b3d17b`). Una
   * pantalla a la que no se llega es código muerto con tests.
   */
  it('«datos» se habilita cuando se le pasa su handler', () => {
    const abrir = vi.fn();
    const items = armarItemsMenu('conv:whatsapp:521:519', { datos: abrir });
    const datos = items.find((i) => i.id === 'datos')!;

    expect(datos.onSeleccionar, 'sin handler la pantalla es inalcanzable').not.toBeNull();
    datos.onSeleccionar!();
    expect(abrir).toHaveBeenCalledWith('conv:whatsapp:521:519');
  });

  it('sin handlers, todas quedan deshabilitadas (onSeleccionar null)', () => {
    const items = armarItemsMenu('conv:whatsapp:521:519');
    expect(items.every((i) => i.onSeleccionar === null)).toBe(true);
  });

  it('con handler, el item se habilita e invoca el callback con la clave correcta', () => {
    const onCorreo = vi.fn();
    const items = armarItemsMenu('conv:whatsapp:521:519', { correo: onCorreo });

    const correo = items.find((i) => i.id === 'correo')!;
    expect(correo.onSeleccionar).not.toBeNull();
    correo.onSeleccionar!();
    expect(onCorreo).toHaveBeenCalledTimes(1);
    expect(onCorreo).toHaveBeenCalledWith('conv:whatsapp:521:519');

    // Las otras siguen sin handler propio.
    const resto = items.filter((i) => i.id !== 'correo');
    expect(resto.every((i) => i.onSeleccionar === null)).toBe(true);
  });

  it('no muta el handler entre llamadas con distinta clave', () => {
    const onNotas = vi.fn();
    const paraA = armarItemsMenu('conv:a', { notas: onNotas }).find((i) => i.id === 'notas')!;
    const paraB = armarItemsMenu('conv:b', { notas: onNotas }).find((i) => i.id === 'notas')!;

    paraA.onSeleccionar!();
    paraB.onSeleccionar!();

    expect(onNotas).toHaveBeenNthCalledWith(1, 'conv:a');
    expect(onNotas).toHaveBeenNthCalledWith(2, 'conv:b');
  });
});
