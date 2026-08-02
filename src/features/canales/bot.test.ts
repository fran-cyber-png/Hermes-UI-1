import { describe, expect, it } from 'vitest';
import { marcaDelBot } from './bot';

describe('marcaDelBot', () => {
  it('la escalada por cerrar se lee como «Listo para cerrar»', () => {
    // El caso que costó tres leads el 1-ago-2026: el bot marcaba esto y nadie lo veía.
    expect(marcaDelBot({ bot_escalada: true, bot_motivo: 'por_cerrar' })).toEqual({
      tono: 'escalada',
      texto: 'Listo para cerrar',
      titulo: 'El bot se frenó y espera a una persona: listo para cerrar',
    });
  });

  it('los seis motivos del server tienen lectura propia, y ninguna se confunde con otra', () => {
    const motivos = [
      'por_cerrar',
      'pidio_humano',
      'pregunto_si_es_bot',
      'sin_respuesta_en_catalogo',
      'frustrado',
      'error_bot',
    ];
    const textos = motivos.map((m) => marcaDelBot({ bot_escalada: true, bot_motivo: m })?.texto);
    expect(textos.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
    expect(new Set(textos).size).toBe(motivos.length);
    // Y ninguno cae en el genérico: si alguien agrega un motivo al server y se
    // olvida acá, este test no lo atrapa — pero sí atrapa haber roto uno de los seis.
    expect(textos).not.toContain('Pidió ayuda');
  });

  it('un motivo que el front no conoce NO se calla ni inventa: dice el hecho que sí sabe', () => {
    // El enum de escaladas crece del lado del server. Un server más nuevo que
    // esta app tiene que producir «el bot se frenó», nunca una fila sin marca
    // (que se leería como «nadie pidió ayuda») ni un motivo parecido.
    expect(marcaDelBot({ bot_escalada: true, bot_motivo: 'motivo_del_futuro' })).toEqual({
      tono: 'escalada',
      texto: 'Pidió ayuda',
      titulo: 'El bot se frenó y espera a una persona',
    });
  });

  it('la escalada le gana a la temperatura: una espera a una persona, la otra no', () => {
    const m = marcaDelBot({ bot_escalada: true, bot_motivo: 'por_cerrar', bot_temperatura: 'caliente' });
    expect(m?.tono).toBe('escalada');
  });

  it('caliente sin escalar se dibuja, con el motivo libre del modelo en el title', () => {
    expect(marcaDelBot({ bot_temperatura: 'caliente', bot_motivo: 'preguntó por las cuotas' })).toEqual({
      tono: 'caliente',
      texto: 'Caliente',
      titulo: 'El bot la ve caliente: preguntó por las cuotas',
    });
  });

  it('caliente sin motivo tampoco se calla', () => {
    expect(marcaDelBot({ bot_temperatura: 'caliente' })?.titulo).toBe('El bot la ve caliente');
  });

  it('tibio y frío no se dibujan: serían 50 de 66 filas', () => {
    expect(marcaDelBot({ bot_temperatura: 'tibio' })).toBeNull();
    expect(marcaDelBot({ bot_temperatura: 'frio' })).toBeNull();
  });

  it('sin dato no hay marca — la ausencia NO es «el bot la vio fría»', () => {
    // El radar y la agenda arman `Conversacion` sin estos campos, y un server sin
    // la migración del bot tampoco los trae.
    expect(marcaDelBot({})).toBeNull();
    expect(marcaDelBot({ bot_escalada: null, bot_temperatura: null, bot_motivo: null })).toBeNull();
  });

  it('`bot_escalada: false` no es una marca: el bot la calificó y siguió trabajando', () => {
    expect(marcaDelBot({ bot_escalada: false, bot_temperatura: 'tibio' })).toBeNull();
  });
});
