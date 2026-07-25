import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EN_COLA_DE_ENVIO,
  ESPERAN_APROBACION,
  OCUPAN_RITMO,
  RESERVAN_EL_DIA,
  esFinal,
  puedeTransicionar,
  transicionar,
} from './estados.js';

/**
 * LA MÁQUINA DE ESTADOS DEL MODO SUPERVISADO (#125 · ADR 0016).
 *
 * Acá se fija el camino de una auto-respuesta supervisada —preparada → aprobada
 * → enviada, y sus tres salidas laterales (descartada, caducada, cancelada)— y
 * sobre todo lo que NO se puede: que una preparada llegue a «enviada» sin que
 * una persona la haya aprobado. Ese salto es la feature entera: si se pudiera
 * dar, el modo supervisado sería el automático con otro nombre.
 */

describe('el camino feliz de una supervisada', () => {
  test('preparada → aprobada → enviada', () => {
    assert.equal(puedeTransicionar('preparada', 'aprobada'), true);
    assert.equal(puedeTransicionar('aprobada', 'enviada'), true);
  });

  test('una preparada NO puede saltar a enviada: sin OK humano no sale', () => {
    assert.equal(puedeTransicionar('preparada', 'enviada'), false);
    const r = transicionar('preparada', 'enviada');
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.motivo : '', /aprobación/i);
  });

  test('tampoco puede colarse en la cola automática', () => {
    assert.equal(puedeTransicionar('preparada', 'pendiente'), false);
  });
});

describe('las salidas laterales', () => {
  test('la vendedora la descarta, o vence sin que nadie la mire', () => {
    assert.equal(puedeTransicionar('preparada', 'descartada'), true);
    assert.equal(puedeTransicionar('preparada', 'caducada'), true);
  });

  test('lo aprobado todavía se puede cancelar: la vendedora contestó a mano', () => {
    assert.equal(puedeTransicionar('aprobada', 'cancelada'), true);
  });

  test('descartar algo ya enviado no existe: lo enviado es final', () => {
    assert.equal(esFinal('enviada'), true);
    assert.equal(esFinal('descartada'), true);
    assert.equal(esFinal('caducada'), true);
    assert.equal(puedeTransicionar('enviada', 'descartada'), false);
  });

  test('lo descartado no revive: aprobar una descartada es un no', () => {
    assert.equal(puedeTransicionar('descartada', 'aprobada'), false);
  });
});

describe('los conjuntos que consultan la cola y los techos', () => {
  test('el despachador solo mira lo que tiene el OK', () => {
    assert.deepEqual([...EN_COLA_DE_ENVIO].sort(), ['aprobada', 'pendiente']);
    assert.ok(!EN_COLA_DE_ENVIO.includes('preparada' as never), 'una preparada no es despachable');
  });

  test('lo que espera el OK humano es solo «preparada»', () => {
    assert.deepEqual([...ESPERAN_APROBACION], ['preparada']);
  });

  test('una preparada YA ocupa cupo de ritmo: reservar de más es el lado seguro', () => {
    assert.ok(OCUPAN_RITMO.includes('preparada'));
    assert.ok(OCUPAN_RITMO.includes('enviada'));
    assert.ok(!OCUPAN_RITMO.includes('descartada' as never), 'lo descartado no consume cupo de WhatsApp');
  });

  test('descartada y caducada SÍ reservan la del día: ya se decidió por esa conversación', () => {
    assert.ok(RESERVAN_EL_DIA.includes('descartada'));
    assert.ok(RESERVAN_EL_DIA.includes('caducada'));
    assert.ok(RESERVAN_EL_DIA.includes('enviada'));
  });
});
