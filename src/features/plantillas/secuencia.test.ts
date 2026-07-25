import { describe, expect, it } from 'vitest';
import {
  avanzar,
  enviados,
  estaCorriendo,
  INICIAL,
  quedoAMedias,
  rotulo,
  type EstadoSecuencia,
  type EventoSecuencia,
} from './secuencia';

/** Corre una tanda de eventos desde el estado inicial. */
function correr(...eventos: EventoSecuencia[]): EstadoSecuencia {
  return eventos.reduce(avanzar, INICIAL);
}

describe('la secuencia de envío', () => {
  it('arranca en el paso 1 de N', () => {
    const e = correr({ tipo: 'arrancar', total: 4 });
    expect(e).toEqual({ fase: 'enviando', paso: 1, total: 4 });
    expect(rotulo(e)).toBe('Enviando 1 de 4');
  });

  it('no arranca una secuencia vacía', () => {
    expect(correr({ tipo: 'arrancar', total: 0 })).toEqual(INICIAL);
  });

  it('avanza paso a paso y termina en el último', () => {
    const e = correr(
      { tipo: 'arrancar', total: 3 },
      { tipo: 'paso-ok' },
      { tipo: 'paso-ok' },
      { tipo: 'paso-ok' },
    );
    expect(e).toEqual({ fase: 'terminada', total: 3 });
    expect(rotulo(e)).toBe('Los 3 mensajes salieron');
    expect(enviados(e)).toBe(3);
  });

  it('«enviando 2 de 4» es exactamente lo que se ve a mitad de camino', () => {
    const e = correr({ tipo: 'arrancar', total: 4 }, { tipo: 'paso-ok' });
    expect(rotulo(e)).toBe('Enviando 2 de 4');
    expect(enviados(e)).toBe(1);
  });

  it('cancelar NO des-envía: el mensaje en vuelo sale y ahí se corta', () => {
    const pidioCancelar = correr(
      { tipo: 'arrancar', total: 4 },
      { tipo: 'paso-ok' },
      { tipo: 'cancelar' },
    );
    expect(pidioCancelar).toEqual({ fase: 'cancelando', paso: 2, total: 4 });
    expect(rotulo(pidioCancelar)).toMatch(/se corta después de este/i);

    const final = avanzar(pidioCancelar, { tipo: 'paso-ok' });
    expect(final).toEqual({ fase: 'cancelada', enviados: 2, total: 4 });
    expect(rotulo(final)).toBe('Cancelada: salieron 2 de 4');
  });

  it('cancelar en el hueco entre dos mensajes: el pendiente NO sale', () => {
    // El caso más común: entre paso y paso hay un segundo y medio de espera, y
    // ahí no hay nada en vuelo. Salieron 2, el 3 nunca se mandó.
    const e = correr(
      { tipo: 'arrancar', total: 4 },
      { tipo: 'paso-ok' },
      { tipo: 'paso-ok' },
      { tipo: 'cancelar' },
      { tipo: 'cortar-antes-de-enviar' },
    );
    expect(e).toEqual({ fase: 'cancelada', enviados: 2, total: 4 });
    expect(rotulo(e)).toBe('Cancelada: salieron 2 de 4');
  });

  it('los dos momentos de cancelar dan cuentas distintas, y las dos son ciertas', () => {
    const base = correr({ tipo: 'arrancar', total: 4 }, { tipo: 'paso-ok' }, { tipo: 'cancelar' });
    // En vuelo: el 2 sale igual.
    expect(avanzar(base, { tipo: 'paso-ok' })).toEqual({ fase: 'cancelada', enviados: 2, total: 4 });
    // En el hueco: el 2 no llegó a salir.
    expect(avanzar(base, { tipo: 'cortar-antes-de-enviar' })).toEqual({
      fase: 'cancelada',
      enviados: 1,
      total: 4,
    });
  });

  it('cancelado significa que NO sale ni uno más', () => {
    const final = correr(
      { tipo: 'arrancar', total: 4 },
      { tipo: 'cancelar' },
      { tipo: 'paso-ok' },
      // Un `paso-ok` de más (una respuesta que llegó tarde) no reanima la secuencia.
      { tipo: 'paso-ok' },
    );
    expect(final).toEqual({ fase: 'cancelada', enviados: 1, total: 4 });
  });

  it('si el mensaje en vuelo falla al cancelar, no cuenta como enviado', () => {
    const final = correr(
      { tipo: 'arrancar', total: 4 },
      { tipo: 'paso-ok' },
      { tipo: 'cancelar' },
      { tipo: 'paso-fallo', motivo: 'el número está suspendido' },
    );
    expect(final).toEqual({ fase: 'cancelada', enviados: 1, total: 4 });
  });

  it('un fallo corta la secuencia y dice dónde y por qué', () => {
    const e = correr(
      { tipo: 'arrancar', total: 4 },
      { tipo: 'paso-ok' },
      { tipo: 'paso-ok' },
      { tipo: 'paso-fallo', motivo: 'el número está suspendido por WhatsApp' },
    );
    expect(e).toEqual({
      fase: 'fallo',
      paso: 3,
      total: 4,
      enviados: 2,
      motivo: 'el número está suspendido por WhatsApp',
    });
    expect(rotulo(e)).toBe('Se cortó en el 3 de 4: el número está suspendido por WhatsApp');
  });

  it('cancelar cuando no hay nada corriendo no hace nada', () => {
    expect(avanzar(INICIAL, { tipo: 'cancelar' })).toEqual(INICIAL);
    const terminada: EstadoSecuencia = { fase: 'terminada', total: 2 };
    expect(avanzar(terminada, { tipo: 'cancelar' })).toBe(terminada);
  });

  it('se puede volver a arrancar después de terminar, cancelar o fallar', () => {
    for (const previo of [
      { fase: 'terminada', total: 2 },
      { fase: 'cancelada', enviados: 1, total: 4 },
      { fase: 'fallo', paso: 2, total: 4, enviados: 1, motivo: 'x' },
    ] as EstadoSecuencia[]) {
      expect(avanzar(previo, { tipo: 'arrancar', total: 3 })).toEqual({
        fase: 'enviando',
        paso: 1,
        total: 3,
      });
    }
  });

  it('sabe cuándo está corriendo y cuándo quedó a medias', () => {
    expect(estaCorriendo({ fase: 'enviando', paso: 1, total: 2 })).toBe(true);
    expect(estaCorriendo({ fase: 'cancelando', paso: 1, total: 2 })).toBe(true);
    expect(estaCorriendo({ fase: 'terminada', total: 2 })).toBe(false);

    expect(quedoAMedias({ fase: 'cancelada', enviados: 1, total: 4 })).toBe(true);
    expect(quedoAMedias({ fase: 'cancelada', enviados: 4, total: 4 })).toBe(false);
    expect(quedoAMedias({ fase: 'terminada', total: 4 })).toBe(false);
  });

  it('un solo mensaje no se anuncia en plural', () => {
    expect(rotulo({ fase: 'terminada', total: 1 })).toBe('Mensaje enviado');
  });
});
