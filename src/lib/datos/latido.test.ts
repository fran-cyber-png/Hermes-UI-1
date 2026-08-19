import { beforeEach, describe, expect, it } from 'vitest';
import {
  COLA_CON_STREAM_MS,
  COLA_SIN_STREAM_BASE_MS,
  COLA_SIN_STREAM_JITTER_MS,
  LATIDO_VENCE_MS,
  intervaloDeCola,
  marcarLatido,
  olvidarLatido,
  streamVivo,
} from './latido';

const AHORA = new Date('2026-08-19T12:00:00.000Z').getTime();

beforeEach(() => olvidarLatido());

describe('streamVivo', () => {
  /**
   * 🔴 NUNCA HABER LATIDO ES «MUERTO», y esa es la lectura que degrada hacia
   * MÁS pedidos: al abrir la app, la cola pollea rápido hasta que el stream dé
   * su primera señal. Al revés, la app arrancaría confiando cinco minutos en un
   * push que todavía no se sabe si conectó.
   */
  it('sin ningún latido, está muerto', () => {
    expect(streamVivo(AHORA)).toBe(false);
  });

  it('recién latido, vivo', () => {
    marcarLatido(AHORA);
    expect(streamVivo(AHORA)).toBe(true);
  });

  it('un keep-alive perdido (25 s) no lo mata: puede ser un GC o una pestaña dormida', () => {
    marcarLatido(AHORA);
    expect(streamVivo(AHORA + 25_000)).toBe(true);
    expect(streamVivo(AHORA + 50_000)).toBe(true);
  });

  it('dos latidos perdidos sí: a los 60 s está muerto', () => {
    marcarLatido(AHORA);
    expect(streamVivo(AHORA + LATIDO_VENCE_MS - 1)).toBe(true);
    expect(streamVivo(AHORA + LATIDO_VENCE_MS)).toBe(false);
  });

  it('revive con el siguiente latido', () => {
    marcarLatido(AHORA);
    expect(streamVivo(AHORA + 90_000)).toBe(false);
    marcarLatido(AHORA + 90_000);
    expect(streamVivo(AHORA + 90_000)).toBe(true);
  });

  it('olvidarLatido lo mata: un corte conocido no espera al vencimiento', () => {
    marcarLatido(AHORA);
    olvidarLatido();
    expect(streamVivo(AHORA)).toBe(false);
  });
});

describe('intervaloDeCola', () => {
  it('con el stream vivo, la cola es una red muy espaciada', () => {
    expect(intervaloDeCola(true, 0)).toBe(COLA_CON_STREAM_MS);
    expect(intervaloDeCola(true, 0.99)).toBe(COLA_CON_STREAM_MS);
  });

  /**
   * ⚠️ El jitter NO se saca del camino sin stream: el SSE empuja el mismo evento
   * a todas las pestañas en el mismo instante, y un valor clavado sincroniza a
   * las ~8 vendedoras sobre la consulta más cara del sistema.
   */
  it('sin stream, vuelve el ritmo de hoy — con jitter', () => {
    expect(intervaloDeCola(false, 0)).toBe(COLA_SIN_STREAM_BASE_MS);
    expect(intervaloDeCola(false, 0.999)).toBeLessThan(
      COLA_SIN_STREAM_BASE_MS + COLA_SIN_STREAM_JITTER_MS,
    );
    expect(intervaloDeCola(false, 0.999)).toBeGreaterThan(COLA_SIN_STREAM_BASE_MS);
    expect(intervaloDeCola(false, 0)).not.toBe(intervaloDeCola(false, 0.5));
  });

  it('el camino con stream es MUCHO más espaciado que el de hoy', () => {
    expect(intervaloDeCola(true, 0.5)).toBeGreaterThan(intervaloDeCola(false, 0.999) * 5);
  });
});
