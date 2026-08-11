import { describe, expect, it } from 'vitest';
import { haceCuanto, rotuloEstado } from './routing';

describe('cómo se dice el estado de una campaña', () => {
  it('los dos que Meta afirma', () => {
    expect(rotuloEstado('activa')).toBe('Activa');
    expect(rotuloEstado('pausada')).toBe('Pausada');
  });

  /**
   * 🔴 Meta tiene más estados de los que este repo conoce y va a agregar más.
   * El server los manda como «desconocido» y la pantalla tiene que DECIRLO: un
   * estado nuevo mostrado como «Pausada» diría que una campaña que está gastando
   * plata no está corriendo.
   */
  it('lo que no se sabe se dice, no se adivina', () => {
    expect(rotuloEstado('desconocido')).toBe('No se sabe');
    // Y un valor que ni siquiera está en el tipo (server más nuevo que el front)
    // cae en la misma rama, nunca en un throw.
    expect(rotuloEstado('recontra_nuevo' as never)).toBe('No se sabe');
  });
});

describe('hace cuánto llegó alguien', () => {
  const AHORA = Date.parse('2026-08-11T18:00:00Z');

  it('cuenta en días, horas, o dice «recién»', () => {
    expect(haceCuanto('2026-08-02T18:00:00Z', AHORA)).toBe('hace 9 días');
    expect(haceCuanto('2026-08-10T18:00:00Z', AHORA)).toBe('hace 1 día');
    expect(haceCuanto('2026-08-11T14:00:00Z', AHORA)).toBe('hace 4 h');
    expect(haceCuanto('2026-08-11T17:50:00Z', AHORA)).toBe('recién');
  });

  /**
   * ⚠️ `null` NO es «hace mucho»: es que por esa campaña no llegó nadie. La fila
   * omite el dato en vez de inventar un plazo.
   */
  it('sin fecha no se inventa un plazo', () => {
    expect(haceCuanto(null, AHORA)).toBeNull();
    expect(haceCuanto('no es una fecha', AHORA)).toBeNull();
  });
});
