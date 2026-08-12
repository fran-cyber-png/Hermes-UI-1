import { describe, expect, test } from 'vitest';
import { CITADO_DESCONOCIDO, extractoDeCita, rotuloDeCita, sePuedeCitar, TOPE_EXTRACTO } from './cita';
import type { CitaHilo } from './cita';

/**
 * CÓMO SE ROTULA UNA CITA.
 *
 * La regla vale la pena testear porque el caso que importa es el FEO: el mensaje
 * citado que Hermes no tiene. Ahí hay que decir algo, y lo que se diga no puede
 * afirmar de quién era ni qué decía — pero tampoco puede hacer desaparecer la
 * cita, porque entonces la respuesta se lee como un mensaje suelto.
 */

const cita = (over: Partial<CitaHilo> = {}): CitaHilo => ({
  mensajeExternalId: 'wa:ABC',
  texto: 'El diploma sale S/ 450',
  direccion: 'saliente',
  mediaClase: null,
  ...over,
});

describe('de quién era', () => {
  test('lo nuestro dice «Vos»', () => {
    expect(rotuloDeCita(cita({ direccion: 'saliente' }), 'Javier').autor).toBe('Vos');
  });

  test('lo del lead dice su nombre', () => {
    expect(rotuloDeCita(cita({ direccion: 'entrante' }), 'Javier').autor).toBe('Javier');
  });

  test('sin nombre del contacto cae en «Esta persona», nunca en el teléfono crudo', () => {
    expect(rotuloDeCita(cita({ direccion: 'entrante' }), null).autor).toBe('Esta persona');
    expect(rotuloDeCita(cita({ direccion: 'entrante' }), '   ').autor).toBe('Esta persona');
  });

  test('🔴 sin dirección NO se dibuja autor: no se afirma de quién era', () => {
    // Es el mensaje que Hermes no encontró. Poner «Esta persona» ahí sería decir
    // que era del lead sin haberlo mirado — y la mitad de las veces sería nuestro.
    expect(rotuloDeCita(cita({ direccion: null, texto: null }), 'Javier').autor).toBeNull();
  });
});

describe('qué decía', () => {
  test('el texto tal cual cuando entra', () => {
    expect(extractoDeCita({ texto: 'S/ 450', mediaClase: null })).toBe('S/ 450');
  });

  test('los saltos de línea se aplastan: la tirita es UNA línea', () => {
    // Sin esto, un mensaje de ocho renglones se ve como una tirita vacía.
    expect(extractoDeCita({ texto: 'hola\n\n  mundo  ', mediaClase: null })).toBe('hola mundo');
  });

  test('lo largo se corta CON «…» — cortar sin marca parece que terminaba ahí', () => {
    const largo = 'a'.repeat(TOPE_EXTRACTO + 50);
    const r = extractoDeCita({ texto: largo, mediaClase: null });
    expect(r.endsWith('…')).toBe(true);
    expect(r.length).toBe(TOPE_EXTRACTO + 1);
  });

  test('un adjunto sin texto se nombra por lo que es', () => {
    expect(extractoDeCita({ texto: null, mediaClase: 'imagen' })).toBe('Foto');
    expect(extractoDeCita({ texto: null, mediaClase: 'documento' })).toBe('Documento');
    expect(extractoDeCita({ texto: '', mediaClase: 'audio' })).toBe('Audio');
  });

  test('una clase de adjunto desconocida cae en «Adjunto», nunca en un throw', () => {
    // El server manda la clase cruda: una nueva no puede romper el hilo entero.
    expect(extractoDeCita({ texto: null, mediaClase: 'ubicacion' })).toBe('Adjunto');
  });

  test('🔴 el citado que no está dice el hueco honesto', () => {
    expect(extractoDeCita({ texto: null, mediaClase: null })).toBe(CITADO_DESCONOCIDO);
  });

  test('el texto le gana al adjunto: un flyer con leyenda se cita por la leyenda', () => {
    expect(extractoDeCita({ texto: 'mirá el temario', mediaClase: 'imagen' })).toBe('mirá el temario');
  });
});

describe('qué se puede citar', () => {
  test('un mensaje con texto, sí', () => {
    expect(sePuedeCitar({ texto: 'hola' })).toBe(true);
  });

  test('un adjunto sin texto, también', () => {
    expect(sePuedeCitar({ texto: null, media: { clase: 'imagen' } })).toBe(true);
  });

  test('🔴 la burbuja de «Vino del anuncio» NO se puede citar', () => {
    // No es un mensaje que alguien escribió: es una marca que Hermes dibuja. Su
    // tirita saldría en blanco, y una cita en blanco no señala nada.
    expect(sePuedeCitar({ texto: null, media: null })).toBe(false);
    expect(sePuedeCitar({ texto: '   ' })).toBe(false);
  });
});
