import { describe, it, expect } from 'vitest';
import { cuantoFalta, lecturaDeVentana, UMBRAL_ORO_MS } from './ventana';

const AHORA = new Date('2026-08-07T15:00:00Z');
const en = (ms: number) => new Date(AHORA.getTime() + ms).toISOString();
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

describe('cuantoFalta', () => {
  it('elige la unidad que se lee de un vistazo', () => {
    expect(cuantoFalta(3 * DIA)).toBe('3 d');
    expect(cuantoFalta(6 * HORA)).toBe('6 h');
    expect(cuantoFalta(45 * MINUTO)).toBe('45 min');
  });

  it('REDONDEA PARA ABAJO: prometer tiempo que no hay es el error que llega tarde', () => {
    expect(cuantoFalta(6 * HORA + 50 * MINUTO)).toBe('6 h');
    expect(cuantoFalta(2 * DIA + 23 * HORA)).toBe('2 d');
  });

  it('nunca dice «0 min»: el último minuto sigue siendo un minuto', () => {
    expect(cuantoFalta(30 * 1000)).toBe('1 min');
    expect(cuantoFalta(1)).toBe('1 min');
  });
});

describe('lecturaDeVentana', () => {
  it('con la ventana abierta dice cuánto falta', () => {
    expect(lecturaDeVentana(en(6 * HORA), AHORA)?.texto).toBe('6 h');
    expect(lecturaDeVentana(en(3 * DIA), AHORA)?.texto).toBe('3 d');
  });

  /**
   * LA DECISIÓN QUE NO SE NEGOCIA. El plazo es duro solo en la línea de la Cloud
   * API; en las tres whatsmeow Meta no rechaza nada. Una píldora que dijera
   * «cerrada» sería falsa en tres de cuatro líneas.
   */
  it('una ventana CERRADA no dibuja nada: se dice a quién sí, nunca a quién no', () => {
    expect(lecturaDeVentana(en(-HORA), AHORA)).toBe(null);
    expect(lecturaDeVentana(en(-30 * DIA), AHORA)).toBe(null);
    expect(lecturaDeVentana(en(0), AHORA)).toBe(null);
  });

  it('sin ventana no dibuja nada, y un server viejo tampoco', () => {
    expect(lecturaDeVentana(null, AHORA)).toBe(null);
    expect(lecturaDeVentana(undefined, AHORA)).toBe(null);
  });

  it('una fecha ilegible no inventa una cuenta regresiva', () => {
    expect(lecturaDeVentana('mañana a la tarde', AHORA)).toBe(null);
    expect(lecturaDeVentana('', AHORA)).toBe(null);
  });

  it('el oro solo abajo del umbral: si todo lo abierto fuera dorado, el oro no diría «ahora»', () => {
    expect(lecturaDeVentana(en(UMBRAL_ORO_MS - MINUTO), AHORA)?.urgente).toBe(true);
    expect(lecturaDeVentana(en(UMBRAL_ORO_MS + MINUTO), AHORA)?.urgente).toBe(false);
    expect(lecturaDeVentana(en(20 * HORA), AHORA)?.urgente).toBe(false);
    expect(lecturaDeVentana(en(10 * MINUTO), AHORA)?.urgente).toBe(true);
  });

  it('la ayuda explica el plazo, no repite la píldora', () => {
    expect(lecturaDeVentana(en(6 * HORA), AHORA)?.ayuda).toBe(
      'Se le puede escribir: la ventana cierra en 6 h',
    );
  });
});
