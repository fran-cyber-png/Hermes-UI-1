import { describe, expect, it } from 'vitest';
import { FILAS_PRIORITARIAS_CON_FOTO, esPrioritaria, quiereFoto, siguienteConFoto } from './fotoVisible';

/**
 * El guardarraíl anti-ban de #71: la cola NO puede pedir la foto de ~1300
 * filas de un saque (rate-limit / riesgo de baneo del número vinculado, #59).
 * Estas dos funciones son la lógica pura detrás del IntersectionObserver de
 * `FilaConversacion` — el observer en sí es DOM y vive ahí sin test (el
 * entorno de vitest del front es `node`, sin DOM).
 */
describe('esPrioritaria', () => {
  it('las primeras N filas piden foto sin esperar al scroll', () => {
    expect(esPrioritaria(0)).toBe(true);
    expect(esPrioritaria(FILAS_PRIORITARIAS_CON_FOTO - 1)).toBe(true);
  });

  it('de ahí en más, no — esperan al observer', () => {
    expect(esPrioritaria(FILAS_PRIORITARIAS_CON_FOTO)).toBe(false);
    expect(esPrioritaria(500)).toBe(false);
  });

  it('sin índice (fila sin posición conocida), no es prioritaria', () => {
    expect(esPrioritaria(undefined)).toBe(false);
  });

  it('el corte N es configurable (para el test, no para la cola real)', () => {
    expect(esPrioritaria(2, 3)).toBe(true);
    expect(esPrioritaria(3, 3)).toBe(false);
  });
});

describe('quiereFoto', () => {
  it('solo WhatsApp tiene foto de perfil para pedir', () => {
    expect(quiereFoto('whatsapp')).toBe(true);
  });

  it('FB/IG/Messenger no exponen esa foto por esta vía', () => {
    expect(quiereFoto('facebook')).toBe(false);
    expect(quiereFoto('instagram')).toBe(false);
    expect(quiereFoto('messenger')).toBe(false);
  });
});

describe('siguienteConFoto', () => {
  it('arranca sin foto y un lote sin intersección no la prende', () => {
    expect(siguienteConFoto(false, [{ isIntersecting: false }])).toBe(false);
    expect(siguienteConFoto(false, [])).toBe(false);
  });

  it('un lote con la fila entrando al viewport la prende', () => {
    expect(siguienteConFoto(false, [{ isIntersecting: true }])).toBe(true);
  });

  it('alcanza con que UNA entrada del lote intersecte', () => {
    expect(siguienteConFoto(false, [{ isIntersecting: false }, { isIntersecting: true }])).toBe(true);
  });

  it('es sticky: una vez prendida, un lote posterior sin intersección no la apaga', () => {
    expect(siguienteConFoto(true, [{ isIntersecting: false }])).toBe(true);
    expect(siguienteConFoto(true, [])).toBe(true);
  });
});
