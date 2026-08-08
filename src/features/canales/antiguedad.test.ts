import { describe, expect, test } from 'vitest';
import { cuantoHace, lecturaDeAntiguedad, UMBRAL_SILENCIO_MS } from './antiguedad';

/**
 * LA LECTURA DE LA ANTIGÜEDAD — puro, sin DOM.
 *
 * Los casos que importan son los que NO dibujan nada: son cuatro razones
 * distintas que se ven igual en pantalla, y confundirlas es lo que hace que una
 * tarjeta afirme una antigüedad que nadie midió.
 */

const DIA = 86_400_000;
const AHORA = new Date('2026-08-08T12:00:00Z');
const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

describe('cuantoHace — redondea para ABAJO', () => {
  test('la escala completa', () => {
    expect(cuantoHace(3 * 3_600_000)).toBe('3 h');
    expect(cuantoHace(3 * DIA)).toBe('3 d');
    expect(cuantoHace(13 * DIA)).toBe('1 sem');
    expect(cuantoHace(45 * DIA)).toBe('1 mes');
  });

  test('🔴 13 días son «1 sem», no «2»', () => {
    // Exagerar la antigüedad hace descartar a alguien antes de tiempo. El error
    // que se puede pagar es el que agranda.
    expect(cuantoHace(13 * DIA)).toBe('1 sem');
    expect(cuantoHace(6 * DIA)).toBe('6 d');
  });
});

describe('lecturaDeAntiguedad — las cuatro razones para no dibujar nada', () => {
  test('el server no manda el campo (server viejo): null', () => {
    expect(lecturaDeAntiguedad(undefined, AHORA)).toBeNull();
  });

  test('el server no la pudo determinar (`null`): null, no «hace 0 d»', () => {
    expect(lecturaDeAntiguedad(null, AHORA)).toBeNull();
  });

  test('entró hoy: no hay antigüedad que reportar', () => {
    expect(lecturaDeAntiguedad(hace(5 * 3_600_000), AHORA)).toBeNull();
    expect(lecturaDeAntiguedad(hace(UMBRAL_SILENCIO_MS - 1), AHORA)).toBeNull();
    expect(lecturaDeAntiguedad(hace(UMBRAL_SILENCIO_MS), AHORA)).not.toBeNull();
  });

  test('una fecha ilegible no inventa una cuenta', () => {
    expect(lecturaDeAntiguedad('no es una fecha', AHORA)).toBeNull();
  });

  test('🔴 y la quinta: si el reloj de arriba ya dice lo mismo, se calla', () => {
    // El caso más frecuente: a la mayoría le mandamos algo y nunca le
    // insistimos, así que los dos relojes coinciden. «3 d ··· 3 d» no agrega un
    // dato, agrega una pregunta.
    expect(lecturaDeAntiguedad(hace(3 * DIA), AHORA, { yaVisible: '3 d' })).toBeNull();
    // Pero cuando difieren, el segundo número ES la información.
    expect(lecturaDeAntiguedad(hace(12 * DIA), AHORA, { yaVisible: '2 d' })?.texto).toBe('1 sem');
  });
});

describe('lecturaDeAntiguedad — lo que dice cuando dice algo', () => {
  test('el texto y la ayuda nombran la columna', () => {
    const l = lecturaDeAntiguedad(hace(3 * DIA), AHORA, { columna: 'Cotizados' });
    expect(l?.texto).toBe('3 d');
    expect(l?.ayuda).toBe('Lleva 3 d en Cotizados');
  });

  test('sin columna, la ayuda sigue siendo verdadera', () => {
    expect(lecturaDeAntiguedad(hace(3 * DIA), AHORA)?.ayuda).toBe('Lleva 3 d en esta etapa');
  });

  test('una fecha futura (reloj desfasado) no dibuja nada', () => {
    expect(lecturaDeAntiguedad(new Date(AHORA.getTime() + DIA).toISOString(), AHORA)).toBeNull();
  });
});
