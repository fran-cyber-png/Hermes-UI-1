import { describe, expect, it } from 'vitest';
import { aHex, desdeHex, hexAHsv, hsvAHex, hsvARgb, rgbAHsv, tintaSobre } from './color';

/**
 * LAS CONVERSIONES DE COLOR.
 *
 * Es el archivo donde un error se ve como «el color que elegí no es el que
 * salió», imposible de depurar mirando la pantalla. Los valores esperados son
 * conocidos —los de la paleta de la app y los primarios— y no calculados con las
 * mismas funciones que se están probando.
 */

describe('leer un HEX escrito o pegado', () => {
  it.each([
    ['#3b82f6', { r: 59, g: 130, b: 246 }],
    ['3b82f6', { r: 59, g: 130, b: 246 }],
    ['#3B82F6', { r: 59, g: 130, b: 246 }],
    ['  #3b82f6  ', { r: 59, g: 130, b: 246 }],
    ['#fff', { r: 255, g: 255, b: 255 }],
    ['#000', { r: 0, g: 0, b: 0 }],
  ])('«%s» se entiende', (texto, esperado) => {
    expect(desdeHex(texto)).toEqual(esperado);
  });

  it('la forma corta duplica cada dígito, como en CSS', () => {
    // `#39f` es `#3399ff`, no `#0309 0f`.
    expect(desdeHex('#39f')).toEqual({ r: 51, g: 153, b: 255 });
  });

  it.each(['', '#', '#12', '#12345', '#zzzzzz', 'rojo', '#1234567'])('«%s» no es un color', (texto) => {
    expect(desdeHex(texto)).toBeNull();
  });

  it('🔴 lo que no se entiende da null y NO negro', () => {
    // Un campo que convierte «#zzz» en negro le muestra a la vendedora un color
    // que no pidió y la deja sin saber que se equivocó al tipear.
    expect(desdeHex('#zzz')).toBeNull();
  });
});

describe('escribir un HEX', () => {
  it('siempre seis dígitos en minúscula', () => {
    expect(aHex({ r: 59, g: 130, b: 246 })).toBe('#3b82f6');
    expect(aHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(aHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
  });

  it('recorta lo que se salga del byte en vez de producir basura', () => {
    expect(aHex({ r: 300, g: -20, b: 12.6 })).toBe('#ff000d');
  });
});

describe('RGB y HSV', () => {
  it.each([
    ['rojo', { h: 0, s: 1, v: 1 }, { r: 255, g: 0, b: 0 }],
    ['verde', { h: 120, s: 1, v: 1 }, { r: 0, g: 255, b: 0 }],
    ['azul', { h: 240, s: 1, v: 1 }, { r: 0, g: 0, b: 255 }],
    ['blanco', { h: 0, s: 0, v: 1 }, { r: 255, g: 255, b: 255 }],
    ['negro', { h: 0, s: 0, v: 0 }, { r: 0, g: 0, b: 0 }],
  ])('%s', (_n, hsv, rgb) => {
    expect(hsvARgb(hsv)).toEqual(rgb);
  });

  it('la ida y la vuelta conserva el color de la paleta', () => {
    for (const hex of ['#111827', '#ef4444', '#eab308', '#3b82f6', '#ffffff', '#000000']) {
      expect(hsvAHex(hexAHsv(hex)!), hex).toBe(hex);
    }
  });

  it('un matiz fuera de rango se normaliza en vez de romper', () => {
    expect(hsvARgb({ h: 480, s: 1, v: 1 })).toEqual(hsvARgb({ h: 120, s: 1, v: 1 }));
    expect(hsvARgb({ h: -120, s: 1, v: 1 })).toEqual(hsvARgb({ h: 240, s: 1, v: 1 }));
  });

  it('🔴 un gris devuelve saturación 0, que es lo que deja conservar el matiz', () => {
    // El selector se apoya en esto: con `s === 0` no pisa el matiz que el
    // usuario tenía puesto, y por eso pasar por el negro no salta la barra al
    // rojo. Ver el docblock de `rgbAHsv`.
    expect(rgbAHsv({ r: 0, g: 0, b: 0 }).s).toBe(0);
    expect(rgbAHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(rgbAHsv({ r: 255, g: 255, b: 255 }).s).toBe(0);
  });
});

describe('la tinta de la vista previa', () => {
  it('🔴 se lee sobre los dos extremos de la paleta', () => {
    // Sin esto, el HEX escrito sobre la muestra desaparece justo en el blanco y
    // en el negro, que son los dos colores que más se usan.
    expect(tintaSobre('#ffffff')).toBe('#000000');
    expect(tintaSobre('#000000')).toBe('#ffffff');
  });

  it('🔴 elige por LUMINANCIA, no por el canal más alto', () => {
    // El verde puro y el azul puro tienen exactamente el mismo canal máximo
    // (255) y son opuestos para el ojo: el verde aporta el 72 % de la luminancia
    // y el azul el 7 %. Cualquier heurística por «canal más grande» los trataría
    // igual y dejaría el texto ilegible sobre uno de los dos.
    expect(tintaSobre('#00ff00')).toBe('#000000');
    expect(tintaSobre('#0000ff')).toBe('#ffffff');
  });

  it('el azul de la app lleva tinta oscura, que es la que más contrasta', () => {
    // Luminancia 0,236: negro da 5,7:1 y blanco 3,7:1.
    expect(tintaSobre('#3b82f6')).toBe('#000000');
    expect(tintaSobre('#111827')).toBe('#ffffff');
  });

  it('un color ilegible no rompe: cae a la tinta oscura', () => {
    expect(tintaSobre('no soy un color')).toBe('#000000');
  });
});
