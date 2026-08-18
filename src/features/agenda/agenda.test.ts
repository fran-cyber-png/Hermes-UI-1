import { describe, expect, it } from 'vitest';
import { HORAS_RAPIDAS, opcionesRapidas } from './agenda';

/**
 * LAS FECHAS RÁPIDAS — el «dos toques» del chat, que es toda la velocidad de
 * agendar. Puro: no toca red ni DOM.
 */

// Un martes a las 11:20, para que «hoy + 2 h» y «el lunes que viene» no caigan
// en el mismo día por casualidad.
const MARTES_11_20 = new Date(2026, 7, 18, 11, 20);

describe('opcionesRapidas', () => {
  it('el índice 1 sigue siendo MAÑANA — VistaAgenda lo lee por posición', () => {
    const o = opcionesRapidas(MARTES_11_20);
    expect(o[1].cuando.getDate()).toBe(19);
    expect(o[1].cuando.getHours()).toBe(9);
  });

  it('sin hora elegida, hoy cae dentro de dos horas EN PUNTO', () => {
    const [hoy] = opcionesRapidas(MARTES_11_20);
    expect(hoy.cuando.getHours()).toBe(13);
    expect(hoy.cuando.getMinutes()).toBe(0);
    expect(hoy.etiqueta).toBe('Hoy 13:00');
  });

  it('con una hora elegida, TODAS las opciones caen a esa hora', () => {
    const o = opcionesRapidas(MARTES_11_20, 16);
    expect(o.map((x) => x.cuando.getHours())).toEqual([16, 16, 16, 16]);
    expect(o[0].etiqueta).toBe('Hoy 16:00');
  });

  it('«Próxima semana» es el lunes que viene, nunca hoy', () => {
    const proxima = opcionesRapidas(MARTES_11_20).at(-1)!;
    expect(proxima.cuando.getDay()).toBe(1);
    expect(proxima.cuando.getDate()).toBe(24);
  });

  it('las horas ofrecidas son las de la jornada, sin el almuerzo', () => {
    expect(HORAS_RAPIDAS).toEqual([10, 11, 12, 15, 16, 17]);
  });
});
