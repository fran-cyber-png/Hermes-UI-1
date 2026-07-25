import { describe, expect, it, vi } from 'vitest';
import { ALTO_MENU_PX, armarAccionesFila, ladoDelMenu } from './accionesFila';

/** Handlers de juguete: el menú solo los ata, nunca decide qué hacen. */
function handlersFalsos() {
  return { fijar: vi.fn(), leido: vi.fn(), favorita: vi.fn() };
}

describe('armarAccionesFila', () => {
  it('lista las tres acciones en el orden de WhatsApp: fijar · no leído · favoritos', () => {
    const acciones = armarAccionesFila({}, handlersFalsos());
    expect(acciones.map((a) => a.id)).toEqual(['fijar', 'leido', 'favorita']);
  });

  it('en una conversación sin marcar, los rótulos proponen la acción', () => {
    const acciones = armarAccionesFila({}, handlersFalsos());
    expect(acciones.map((a) => a.etiqueta)).toEqual([
      'Fijar chat',
      'Marcar como no leído',
      'Añadir a Favoritos',
    ]);
  });

  it('cada marca puesta invierte SU rótulo, y solo el suyo', () => {
    const soloFijada = armarAccionesFila({ fijada: true }, handlersFalsos());
    expect(soloFijada.map((a) => a.etiqueta)).toEqual([
      'Dejar de fijar',
      'Marcar como no leído',
      'Añadir a Favoritos',
    ]);

    const soloNoLeida = armarAccionesFila({ no_leido: true }, handlersFalsos());
    expect(soloNoLeida.map((a) => a.etiqueta)).toEqual([
      'Fijar chat',
      'Marcar como leído',
      'Añadir a Favoritos',
    ]);

    const soloFavorita = armarAccionesFila({ favorita: true }, handlersFalsos());
    expect(soloFavorita.map((a) => a.etiqueta)).toEqual([
      'Fijar chat',
      'Marcar como no leído',
      'Quitar de Favoritos',
    ]);
  });

  it('con las tres marcas puestas, las tres proponen deshacer', () => {
    const acciones = armarAccionesFila({ fijada: true, favorita: true, no_leido: true }, handlersFalsos());
    expect(acciones.map((a) => a.etiqueta)).toEqual([
      'Dejar de fijar',
      'Marcar como leído',
      'Quitar de Favoritos',
    ]);
  });

  it('el estado activo viaja en el item: el menú puede marcarlo sin recalcularlo', () => {
    const acciones = armarAccionesFila({ fijada: true, no_leido: true }, handlersFalsos());
    expect(acciones.map((a) => a.activa)).toEqual([true, true, false]);
  });

  it('cada item invoca SU handler, una sola vez y sin tocar a los otros', () => {
    const handlers = handlersFalsos();
    const acciones = armarAccionesFila({}, handlers);

    acciones.find((a) => a.id === 'favorita')!.onSeleccionar();

    expect(handlers.favorita).toHaveBeenCalledTimes(1);
    expect(handlers.fijar).not.toHaveBeenCalled();
    expect(handlers.leido).not.toHaveBeenCalled();
  });

  it('todos los items traen icono: el menú es icono + texto, nunca texto pelado', () => {
    const acciones = armarAccionesFila({ favorita: true }, handlersFalsos());
    expect(acciones.every((a) => a.Icono != null)).toBe(true);
  });
});

describe('ladoDelMenu', () => {
  /** Una fila cómoda en medio de la lista: 500px de aire abajo. */
  const holgado = {
    arribaDisparador: 300,
    abajoDisparador: 322,
    limiteArriba: 100,
    limiteAbajo: 800,
    altoMenu: ALTO_MENU_PX,
  };

  it('si el menú entra abajo, abre abajo (es lo esperado)', () => {
    expect(ladoDelMenu(holgado)).toBe('abajo');
  });

  it('última fila de la lista: no entra abajo pero sí arriba → abre hacia arriba', () => {
    expect(ladoDelMenu({ ...holgado, arribaDisparador: 760, abajoDisparador: 782 })).toBe('arriba');
  });

  it('justo justo: con el alto exacto disponible abajo, no se da vuelta', () => {
    expect(ladoDelMenu({ ...holgado, abajoDisparador: 800 - ALTO_MENU_PX })).toBe('abajo');
  });

  it('un pixel menos que el alto exacto ya lo manda arriba', () => {
    expect(ladoDelMenu({ ...holgado, abajoDisparador: 800 - ALTO_MENU_PX + 1 })).toBe('arriba');
  });

  it('primera fila pegada al borde de arriba: no entra arriba, se queda abajo', () => {
    expect(ladoDelMenu({ ...holgado, arribaDisparador: 104, abajoDisparador: 126 })).toBe('abajo');
  });

  it('lista enana donde no entra en ningún lado: elige el lado con más aire', () => {
    // 60px arriba, 20px abajo → arriba.
    expect(
      ladoDelMenu({ arribaDisparador: 160, abajoDisparador: 182, limiteArriba: 100, limiteAbajo: 202, altoMenu: ALTO_MENU_PX }),
    ).toBe('arriba');
    // 20px arriba, 60px abajo → abajo.
    expect(
      ladoDelMenu({ arribaDisparador: 120, abajoDisparador: 142, limiteArriba: 100, limiteAbajo: 202, altoMenu: ALTO_MENU_PX }),
    ).toBe('abajo');
  });

  it('empate de aire: desempata abajo (el lado por defecto)', () => {
    expect(
      ladoDelMenu({ arribaDisparador: 140, abajoDisparador: 162, limiteArriba: 100, limiteAbajo: 202, altoMenu: ALTO_MENU_PX }),
    ).toBe('abajo');
  });
});
