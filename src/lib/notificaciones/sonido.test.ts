// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * jsdom no implementa Web Audio API, así que estos tests instalan un
 * `AudioContext` de mentira en `window` — lo que se verifica es la LÓGICA
 * (arma dos tonos, resume si estaba suspendido, reusa el mismo contexto),
 * no que suene de verdad. Eso último se verificó a mano en un navegador real
 * (`npm run dev`).
 */
class OsciladorFalso {
  type = '';
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class GananciaFalsa {
  gain = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

function instalarAudioContextFalso(estadoInicial: 'running' | 'suspended' = 'running') {
  const resume = vi.fn();
  const osciladores: OsciladorFalso[] = [];
  let creados = 0;
  class AudioContextFalso {
    state = estadoInicial;
    currentTime = 0;
    destination = {};
    resume = resume;
    constructor() {
      creados++;
    }
    createOscillator() {
      const o = new OsciladorFalso();
      osciladores.push(o);
      return o;
    }
    createGain() {
      return new GananciaFalsa();
    }
  }
  // @ts-expect-error — stub mínimo para el test, no el AudioContext real
  window.AudioContext = AudioContextFalso;
  return { resume, osciladores, contados: () => creados };
}

describe('reproducirSonidoMensaje', () => {
  afterEach(() => {
    // @ts-expect-error limpiar entre tests
    delete window.AudioContext;
    vi.resetModules();
  });

  it('sin AudioContext en window (jsdom puro), no revienta', async () => {
    const { reproducirSonidoMensaje } = await import('./sonido');
    expect(() => reproducirSonidoMensaje()).not.toThrow();
  });

  it('arma DOS tonos ascendentes y los arranca', async () => {
    const { osciladores } = instalarAudioContextFalso();
    const { reproducirSonidoMensaje } = await import('./sonido');
    reproducirSonidoMensaje();
    expect(osciladores).toHaveLength(2);
    expect(osciladores[0].frequency.value).toBeLessThan(osciladores[1].frequency.value);
    expect(osciladores[0].start).toHaveBeenCalled();
    expect(osciladores[1].start).toHaveBeenCalled();
  });

  it('si el contexto está suspendido (antes del primer gesto), lo resume', async () => {
    const { resume } = instalarAudioContextFalso('suspended');
    const { reproducirSonidoMensaje } = await import('./sonido');
    reproducirSonidoMensaje();
    expect(resume).toHaveBeenCalled();
  });

  it('reusa el MISMO AudioContext entre mensajes — no crea uno por campanita', async () => {
    const { contados } = instalarAudioContextFalso();
    const { reproducirSonidoMensaje } = await import('./sonido');
    reproducirSonidoMensaje();
    reproducirSonidoMensaje();
    expect(contados()).toBe(1);
  });
});
