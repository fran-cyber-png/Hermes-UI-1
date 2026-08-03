import { describe, it, expect } from 'vitest';
import {
  compararRespuesta,
  compararReglas,
  resumirCorrida,
  costoAproximado,
} from './corridas';

const r = (textoOriginal: string | null, texto: string | null) => ({
  id: 1,
  clave: 'conv:whatsapp:519:5198',
  textoOriginal,
  estadoOriginal: 'enviada',
  texto,
  estado: 'enviada',
  motivo: null,
  acciones: [],
});

describe('compararRespuesta', () => {
  it('el mismo texto es «igual»', () => {
    expect(compararRespuesta(r('hola', 'hola'))).toBe('igual');
  });

  it('texto distinto es «cambio»', () => {
    expect(compararRespuesta(r('hola', 'buenas'))).toBe('cambio');
  });

  /**
   * Los dos casos que un `===` a secas escondería, y que son hallazgos
   * distintos: que el bot DEJE de hablar donde antes hablaba no es lo mismo que
   * lo contrario. Mezclarlos en «cambió» haría que una regla nueva que enmudece
   * al bot se vea igual que una que lo mejora.
   */
  it('antes hablaba y ahora no: se distingue', () => {
    expect(compararRespuesta(r('algo', null))).toBe('ahora-calla');
    expect(compararRespuesta(r('algo', '   '))).toBe('ahora-calla');
  });

  it('antes no hablaba y ahora sí: se distingue del anterior', () => {
    expect(compararRespuesta(r(null, 'algo'))).toBe('antes-callaba');
  });

  it('sin texto en ninguno de los dos lados no es «igual»', () => {
    // Serían «iguales» por comparación de strings, y decir «diría lo mismo»
    // sobre dos silencios es afirmar de más: no hay nada que comparar.
    expect(compararRespuesta(r(null, null))).toBe('sin-datos');
  });

  it('el espacio en blanco no cuenta como texto', () => {
    expect(compararRespuesta(r('  hola  ', 'hola'))).toBe('igual');
  });
});

describe('resumirCorrida', () => {
  it('cuenta cada clase por separado', () => {
    const resumen = resumirCorrida([
      r('a', 'a'),
      r('a', 'b'),
      r('a', null),
      r(null, 'b'),
      r(null, null),
    ]);
    expect(resumen).toEqual({
      igual: 1,
      cambio: 1,
      'ahora-calla': 1,
      'antes-callaba': 1,
      'sin-datos': 1,
    });
  });

  it('sin respuestas, todo en cero — no explota', () => {
    expect(resumirCorrida([])).toEqual({
      igual: 0,
      cambio: 0,
      'ahora-calla': 0,
      'antes-callaba': 0,
      'sin-datos': 0,
    });
  });
});

describe('costoAproximado', () => {
  it('el corpus completo medido (778k in, 8k out) ronda el dólar', () => {
    const usd = costoAproximado(778_427, 8_274);
    expect(usd).toBeGreaterThan(0.5);
    expect(usd).toBeLessThan(1.5);
  });

  it('una corrida vacía no cuesta nada', () => {
    expect(costoAproximado(0, 0)).toBe(0);
  });
});

describe('compararReglas', () => {
  const vacio = {
    identidad: 0, pregunta_pais: 0, anuncia_otra_persona: 0,
    cifra_de_precio: 0, dice_ser_bot: 0, sede_inexistente: 0,
  };

  it('las reglas que nadie rompió no aparecen: el tablero no se llena de ceros', () => {
    const r = compararReglas({ antes: vacio, ahora: vacio });
    expect(r).toHaveLength(0);
  });

  /**
   * El orden es la decisión que importa. Lo que EMPEORÓ va primero aunque sea
   * por poco: enterrarlo debajo de una mejora grande es cómo se aprueba una
   * regresión sin verla.
   */
  it('lo que empeoró va primero, aunque haya mejorado mucho otra cosa', () => {
    const r = compararReglas({
      antes: { ...vacio, identidad: 39, cifra_de_precio: 0 },
      ahora: { ...vacio, identidad: 0, cifra_de_precio: 2 },
    });
    expect(r[0]!.regla).toBe('cifra_de_precio'); // empeoró: 0 → 2
    expect(r[1]!.regla).toBe('identidad'); // mejoró: 39 → 0
  });

  it('entre mejoras, primero la más grande', () => {
    const r = compararReglas({
      antes: { ...vacio, identidad: 39, pregunta_pais: 9 },
      ahora: vacio,
    });
    expect(r.map((c) => c.regla)).toEqual(['identidad', 'pregunta_pais']);
  });

  it('el delta dice la dirección', () => {
    const r = compararReglas({
      antes: { ...vacio, pregunta_pais: 9 },
      ahora: { ...vacio, pregunta_pais: 1 },
    });
    expect(r[0]!.delta).toBe(-8);
  });
});
