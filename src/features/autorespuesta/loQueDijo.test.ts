import { describe, expect, test } from 'vitest';
import type { MensajeHilo } from '../whatsapp/conversacionWa';
import { loQueDijo } from './loQueDijo';

/**
 * QUÉ DIJO LA PERSONA — el dato que hace supervisable una sugerencia.
 *
 * La plantilla es la misma para toda la campaña. Lo único que cambia entre
 * aprobar a ciegas y supervisar de verdad es poder leer, al lado del texto que
 * se va a mandar, LO QUE ESA PERSONA ESCRIBIÓ. Si preguntó «¿va dirigido a
 * policías o a cualquiera?» y el acuse le manda el flyer genérico, se ve en un
 * segundo y se edita.
 *
 * Y hay una distinción que #153 midió y que cambia la decisión: **el 90% de los
 * primeros mensajes no los escribió nadie** — son el copy pre-rellenado del
 * anuncio de click-to-WhatsApp («Hola quiero más información del Diploma de…»),
 * 161 veces idéntico. Eso es un CLIC, no una frase. Tratarlo como una pregunta
 * es el error que hace que la vendedora crea que le contestó algo a alguien.
 */

const msj = (over: Partial<MensajeHilo> = {}): MensajeHilo => ({
  id: 1,
  direccion: 'entrante',
  autor: 'ella',
  texto: 'Hola',
  occurred_at: '2026-07-25T04:40:00.000Z',
  external_id: 'wa:1',
  ...over,
});

describe('lo último que escribió', () => {
  test('gana el ÚLTIMO entrante con texto, no el primero', () => {
    // Es lo que quedó sin responder, y es a lo que la plantilla tiene que servir.
    const d = loQueDijo([
      msj({ id: 1, texto: 'Hola quiero más información del Diploma de Inteligencia' }),
      msj({ id: 2, texto: '¿el curso va dirigido a policías?' }),
    ]);
    expect(d.clase).toBe('propio');
    expect(d.clase === 'propio' && d.texto).toBe('¿el curso va dirigido a policías?');
  });

  test('lo que mandamos nosotros no cuenta: no es lo que ella dijo', () => {
    const d = loQueDijo([
      msj({ id: 1, texto: '¿cuánto cuesta?' }),
      msj({ id: 2, direccion: 'saliente', texto: 'S/ 550' }),
    ]);
    expect(d.clase === 'propio' && d.texto).toBe('¿cuánto cuesta?');
  });

  test('sin texto propio, lo dice — no inventa una pregunta', () => {
    expect(loQueDijo([]).clase).toBe('nada');
    expect(loQueDijo([msj({ texto: null })]).clase).toBe('nada');
    expect(loQueDijo([msj({ texto: '   ' })]).clase).toBe('nada');
  });

  test('un audio o una imagen sin texto se nombran, no se ocultan', () => {
    // #153: 732 entrantes son multimedia con `texto = null`. En LATAM eso son
    // notas de voz. Decir «no escribió nada» ahí sería mentira: escribió, con
    // la voz, y Hermes no lo puede leer. La vendedora tiene que saberlo ANTES
    // de aprobar una plantilla que quizá no viene al caso.
    const d = loQueDijo([msj({ texto: null, media: { clase: 'audio' } as never })]);
    expect(d.clase).toBe('sin-texto');
  });
});

describe('el copy del anuncio no es una pregunta', () => {
  test('el pre-rellenado de click-to-WhatsApp se marca como lo que es: un clic', () => {
    const d = loQueDijo([
      msj({ texto: 'Hola quiero más información del Diploma de Inteligencia y Contrainteligencia' }),
    ]);
    expect(d.clase).toBe('copy-del-anuncio');
  });

  test('las variantes del mismo pre-rellenado también', () => {
    for (const t of [
      'Hola, quiero más información',
      'hola me interesa mas informacion sobre el diplomado',
      'Hola, deseo más información del curso',
    ]) {
      expect(loQueDijo([msj({ texto: t })]).clase, t).toBe('copy-del-anuncio');
    }
  });

  test('si DESPUÉS del copy escribió algo suyo, gana lo suyo', () => {
    const d = loQueDijo([
      msj({ id: 1, texto: 'Hola quiero más información' }),
      msj({ id: 2, texto: 'se puede pagar en cuotas?' }),
    ]);
    expect(d.clase).toBe('propio');
  });

  test('ante la duda, PROPIO: se prefiere hacer mirar de más que de menos', () => {
    // Marcar de más como «es solo el copy» haría que la vendedora deje de leer
    // justo lo que tiene que leer. El error barato es el otro.
    const d = loQueDijo([msj({ texto: 'Hola, quiero información sobre si tiene valor oficial' })]);
    expect(d.clase).toBe('propio');
  });
});
