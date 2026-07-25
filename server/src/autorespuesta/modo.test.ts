import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  encendidaEn,
  esModoElegible,
  estadoAlEncolar,
  leerModo,
  modoDelBooleano,
  MODOS,
  MODOS_ELEGIBLES,
  prepara,
  type ModoAutoRespuesta,
} from './modo.js';

/**
 * LOS TRES ESTADOS DEL INTERRUPTOR (#125 · ADR 0016): apagada · supervisada ·
 * automática. El del medio es el que pidió el dueño: la máquina prepara, la
 * vendedora aprueba.
 */

describe('qué hace cada modo', () => {
  test('apagada no prepara nada', () => {
    assert.equal(prepara('apagada'), false);
    assert.equal(estadoAlEncolar('apagada'), null);
  });

  test('supervisada prepara, pero lo que escribe espera el OK humano', () => {
    assert.equal(prepara('supervisada'), true);
    assert.equal(estadoAlEncolar('supervisada'), 'preparada');
  });

  test('automática prepara y lo suyo sale solo', () => {
    assert.equal(prepara('automatica'), true);
    assert.equal(estadoAlEncolar('automatica'), 'pendiente');
  });

  test('los tres, y solo los tres', () => {
    assert.deepEqual([...MODOS], ['apagada', 'supervisada', 'automatica']);
  });
});

describe('leer el modo de lo que hay guardado', () => {
  test('el modo guardado manda', () => {
    assert.equal(leerModo({ modo: 'supervisada', encendida: true }), 'supervisada');
    assert.equal(leerModo({ modo: 'automatica', encendida: true }), 'automatica');
    assert.equal(leerModo({ modo: 'apagada', encendida: false }), 'apagada');
  });

  test('sin la columna todavía (antes del db:push), el booleano viejo decide', () => {
    // La fila que dejó ADR 0015: `encendida` sola. Prendida quería decir
    // «manda sola», que hoy se llama automática.
    assert.equal(leerModo({ modo: null, encendida: true }), 'automatica');
    assert.equal(leerModo({ modo: null, encendida: false }), 'apagada');
  });

  test('un valor que no reconozco NO se interpreta como «mandá»: apagada', () => {
    assert.equal(leerModo({ modo: 'turbo', encendida: true }), 'apagada');
  });

  test('el booleano se deriva del modo, nunca al revés', () => {
    const esperado: Record<ModoAutoRespuesta, boolean> = { apagada: false, supervisada: true, automatica: true };
    for (const m of MODOS) assert.equal(encendidaEn(m), esperado[m]);
  });
});

/**
 * LA PUERTA CERRADA (ADR 0018). `automatica` sigue siendo REPRESENTABLE —una
 * fila vieja puede tenerla y hay que leerla tal cual— pero ya no es ELEGIBLE:
 * nadie puede entrar ahí. Los dos conjuntos son distintos a propósito, y esa
 * distinción es toda la decisión.
 */
describe('a automática ya no se entra', () => {
  test('elegibles son dos: apagada y supervisada', () => {
    assert.deepEqual([...MODOS_ELEGIBLES], ['apagada', 'supervisada']);
  });

  test('automática se sigue reconociendo, pero no se puede elegir', () => {
    assert.equal(esModoElegible('automatica'), false);
    assert.equal(esModoElegible('supervisada'), true);
    assert.equal(esModoElegible('apagada'), true);
    assert.equal(esModoElegible('turbo'), false);
    assert.equal(esModoElegible(null), false);
  });

  test('elegible implica representable: nadie puede elegir algo que leerModo no entienda', () => {
    for (const m of MODOS_ELEGIBLES) assert.ok((MODOS as readonly string[]).includes(m));
  });

  test('el booleano viejo prende en SUPERVISADA, no en automática', () => {
    // Era la puerta trasera: `PUT /interruptor {encendida:true}` dejaba prod
    // mandando sola sin que la UI lo ofreciera nunca. Apagar sigue apagando.
    assert.equal(modoDelBooleano(true), 'supervisada');
    assert.equal(modoDelBooleano(false), 'apagada');
    assert.ok(esModoElegible(modoDelBooleano(true)));
  });
});
