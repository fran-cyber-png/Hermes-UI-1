import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expresaRechazo, huboRechazo } from './rechazo.js';

/**
 * El detector de rechazo, con sus dos listas de casos: los que TIENEN que
 * frenar la auto-respuesta y —más importante— los que NO, porque son preguntas
 * de alguien que sí quiere que le contesten.
 */

describe('rechazo detectado', () => {
  const rechazos = [
    'no gracias',
    'No, gracias.',
    'no me interesa',
    'Ya no me interesa, gracias',
    'ya no',
    'YA NO 🙏',
    'no me escriban mas por favor',
    'dejen de escribirme',
    'quiero darme de baja',
    'eliminen mi numero de sus listas',
    'número equivocado',
    'no estoy interesada en el diplomado',
  ];

  for (const texto of rechazos) {
    test(`«${texto}» es un no`, () => {
      assert.equal(expresaRechazo(texto), true);
    });
  }
});

describe('lo que NO es rechazo (el falso positivo que cuesta un lead)', () => {
  const dudas = [
    'no me llegó el temario',
    '¿no hay descuento?',
    'no sé si puedo pagar en cuotas',
    'no entendí el horario',
    'ya no me acuerdo si me inscribí, me confirmas?',
    'hola, quiero información',
    'cuánto cuesta?',
    '',
    null,
    undefined,
  ];

  for (const texto of dudas) {
    test(`«${texto}» NO es un no`, () => {
      assert.equal(expresaRechazo(texto), false);
    });
  }
});

describe('la conversación entera, no solo el último mensaje', () => {
  test('un «no me interesa» de ayer sigue valiendo hoy', () => {
    assert.equal(huboRechazo(['hola', 'no me interesa', 'ok']), true);
  });

  test('sin ningún no, no hay rechazo', () => {
    assert.equal(huboRechazo(['hola', 'me pasas el temario?', null]), false);
  });
});
