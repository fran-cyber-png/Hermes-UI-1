import { describe, expect, it, vi } from 'vitest';
import { armarItemsMenu, HERRAMIENTAS } from './itemsHerramientas';

describe('armarItemsMenu', () => {
  it('arma las cinco herramientas del FLUJO.md, en orden', () => {
    const items = armarItemsMenu('conv:whatsapp:521:519');
    expect(items.map((i) => i.id)).toEqual(['correo', 'mensajes', 'etiquetas', 'notas', 'catalogo']);
    expect(items).toHaveLength(HERRAMIENTAS.length);
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

    // Las otras cuatro siguen sin handler propio.
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
