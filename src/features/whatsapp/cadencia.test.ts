import { describe, expect, it } from 'vitest';
import {
  CADENCIA_HILO_FRIO_MS,
  CADENCIA_HILO_TIBIO_MS,
  CADENCIA_HILO_VIVO_MS,
  CADENCIA_SESION_MS,
  esLineaQueNoCorre,
  intervaloDeLaSesion,
  intervaloDelHilo,
} from './cadencia';

const AHORA = new Date('2026-08-19T12:00:00.000Z').getTime();
const haceMs = (ms: number) => new Date(AHORA - ms).toISOString();

describe('intervaloDelHilo — los tres escalones', () => {
  it('un mensaje de recién: el ritmo de siempre', () => {
    expect(intervaloDelHilo(haceMs(1_000), AHORA)).toBe(CADENCIA_HILO_VIVO_MS);
    expect(intervaloDelHilo(haceMs(119_000), AHORA)).toBe(CADENCIA_HILO_VIVO_MS);
  });

  it('de hace media hora: tibio', () => {
    expect(intervaloDelHilo(haceMs(30 * 60_000), AHORA)).toBe(CADENCIA_HILO_TIBIO_MS);
  });

  it('de ayer: frío', () => {
    expect(intervaloDelHilo(haceMs(24 * 60 * 60_000), AHORA)).toBe(CADENCIA_HILO_FRIO_MS);
  });

  /**
   * Los bordes exactos, porque «< 2 min» y «<= 2 min» se leen igual y no son lo
   * mismo: a los 2 minutos clavados el hilo ya no es un ping-pong.
   */
  it('los bordes están donde dicen', () => {
    expect(intervaloDelHilo(haceMs(2 * 60_000 - 1), AHORA)).toBe(CADENCIA_HILO_VIVO_MS);
    expect(intervaloDelHilo(haceMs(2 * 60_000), AHORA)).toBe(CADENCIA_HILO_TIBIO_MS);
    expect(intervaloDelHilo(haceMs(60 * 60_000 - 1), AHORA)).toBe(CADENCIA_HILO_TIBIO_MS);
    expect(intervaloDelHilo(haceMs(60 * 60_000), AHORA)).toBe(CADENCIA_HILO_FRIO_MS);
  });
});

/**
 * 🔴 EL CANDADO DEL FRENTE: LA CADENCIA DEGRADA HACIA MÁS FRECUENTE.
 *
 * Un hilo que se pide de más cuesta 21 ms; uno que se pide de menos le esconde
 * a la vendedora el mensaje que está esperando. Todos los casos en los que «no
 * se sabe» tienen que caer en el escalón más CORTO — y `NaN` es el que muerde
 * en silencio: con él las dos comparaciones dan `false` y el hilo se iría solo
 * al escalón más lento.
 */
describe('sin datos, el escalón más rápido', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['una cadena que no es fecha', 'la semana pasada'],
    ['una cadena vacía', ''],
  ])('%s → 5 s', (_que, valor) => {
    expect(intervaloDelHilo(valor as string | null | undefined, AHORA)).toBe(CADENCIA_HILO_VIVO_MS);
  });

  it('una fecha del FUTURO se lee como «recién», no como frío', () => {
    // El reloj del server puede ir adelante del nuestro: transcurrido negativo.
    expect(intervaloDelHilo(new Date(AHORA + 10 * 60_000).toISOString(), AHORA)).toBe(
      CADENCIA_HILO_VIVO_MS,
    );
  });

  it('acepta Date y número, no sólo la cadena ISO del server', () => {
    expect(intervaloDelHilo(new Date(AHORA - 1000), AHORA)).toBe(CADENCIA_HILO_VIVO_MS);
    expect(intervaloDelHilo(AHORA - 1000, new Date(AHORA))).toBe(CADENCIA_HILO_VIVO_MS);
  });
});

/**
 * 🔴 EL TECHO DE 60 s NO ES UNA PREFERENCIA.
 *
 * Los ✓✓ de la Cloud API no salen por el bus de tiempo real (el webhook llama a
 * `aplicarRecibo` en su bucle de `statuses[]` y no emite nada), así que en la
 * línea que trae los leads el ÚNICO que hace aparecer el tilde es este poll.
 * Subir este número esconde el ✓✓ el mismo tiempo que se suba.
 */
describe('el techo del escalón más lento', () => {
  it('nunca pasa de un minuto, por los ✓✓ de la Cloud API', () => {
    expect(CADENCIA_HILO_FRIO_MS).toBeLessThanOrEqual(60_000);
    const deHaceUnAno = new Date(AHORA - 365 * 24 * 60 * 60_000).toISOString();
    expect(intervaloDelHilo(deHaceUnAno, AHORA)).toBeLessThanOrEqual(60_000);
  });

  it('y los escalones están ordenados: más viejo nunca es más frecuente', () => {
    const escalones = [
      intervaloDelHilo(haceMs(1_000), AHORA),
      intervaloDelHilo(haceMs(30 * 60_000), AHORA),
      intervaloDelHilo(haceMs(24 * 60 * 60_000), AHORA),
    ];
    expect(escalones).toEqual([...escalones].sort((a, b) => a - b));
  });
});

/**
 * EL 404 DE LA SESIÓN: «esa línea no está corriendo» es estable, no transitorio.
 *
 * 19.313 de los 58.429 pedidos del 18-ago terminaron ahí, repreguntando cada
 * 10 s una respuesta que sólo cambia cuando alguien monta la línea — y cuando
 * eso pasa, el server lo empuja por el SSE.
 */
describe('intervaloDeLaSesion', () => {
  it('sin error, repregunta cada minuto', () => {
    expect(intervaloDeLaSesion(undefined)).toBe(CADENCIA_SESION_MS);
    expect(intervaloDeLaSesion(null)).toBe(CADENCIA_SESION_MS);
  });

  it('un 404 congela el poll', () => {
    expect(intervaloDeLaSesion({ status: 404 })).toBe(false);
  });

  /**
   * 🔴 Y CUALQUIER OTRO ERROR SIGUE REPREGUNTANDO. Un 503 o una red caída sí se
   * arreglan solos: congelar ahí dejaría el semáforo del header apagado hasta
   * que llegue un evento del stream… que con el server caído tampoco llega.
   */
  it.each([[401], [403], [500], [502], [503]])('un %i sigue repreguntando', (status) => {
    expect(intervaloDeLaSesion({ status })).toBe(CADENCIA_SESION_MS);
  });

  it('reconoce el 404 por su `status`, sin importar de qué clase sea el error', () => {
    class ErrorCualquiera extends Error {
      status = 404;
    }
    expect(esLineaQueNoCorre(new ErrorCualquiera('esa línea no está corriendo'))).toBe(true);
    expect(esLineaQueNoCorre(new Error('sin status'))).toBe(false);
    expect(esLineaQueNoCorre('404')).toBe(false);
    expect(esLineaQueNoCorre(null)).toBe(false);
  });
});
