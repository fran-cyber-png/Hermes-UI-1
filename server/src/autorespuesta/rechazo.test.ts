import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { esDespedida, expresaRechazo, huboRechazo } from './rechazo.js';

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

/**
 * EL NO CON MOTIVO (#166). Los textos son los de la conversación real que
 * disparó el issue: una abogada que revisó el material y explicó por qué no le
 * servía, y a la que el sistema le preparó un «gracias por escribirnos».
 */
describe('el no con motivo', () => {
  const noes = [
    'Soy abogada, y no me es de mucha utilidad',
    'no me es de utilidad para lo que hago',
    'gracias pero no es lo que buscaba',
    'revisé el temario y no es lo que necesito',
    'no me sirve',
    'no aplica para mi',
  ];

  for (const texto of noes) {
    test(`«${texto}» es un no`, () => {
      assert.equal(expresaRechazo(texto), true);
    });
  }

  /**
   * El falso positivo que costaría una venta: la MISMA frase, pero pidiendo
   * algo. Quien pregunta por otra opción quiere comprar.
   */
  const siguenInteresados = [
    'ese horario no me sirve, ¿hay otro grupo?',
    'el link no me sirve, me lo puedes reenviar',
    'no es lo que buscaba, ¿tienen uno de gestión pública?',
    'no me sirve el de julio, quiero el de agosto',
  ];

  for (const texto of siguenInteresados) {
    test(`«${texto}» NO es un no: está pidiendo algo`, () => {
      assert.equal(expresaRechazo(texto), false);
    });
  }
});

/**
 * EL CIERRE CORTÉS (#166). No es un no —es una conversación terminada— y por
 * eso tiene su propia puerta. El borde que más importa está abajo: «gracias» a
 * secas es lo que contesta quien acaba de recibir el flyer y sigue leyendo.
 */
describe('la despedida', () => {
  const despedidas = [
    'Agradezco mucho la atención prestada',
    'gracias por la atención',
    'Muchas gracias por todo',
    'gracias por su tiempo, que estén bien',
    'quedo agradecida',
  ];

  for (const texto of despedidas) {
    test(`«${texto}» cierra la conversación`, () => {
      assert.equal(esDespedida(texto), true);
    });
  }

  const noCierran = [
    'gracias',
    'Gracias!',
    'muchas gracias',
    'ok gracias',
    'gracias, ¿y cuánto cuesta?',
    'gracias por la información, me interesa inscribirme',
    'gracias por tu tiempo, ¿me puedes pasar el temario?',
    'hola, quiero información',
    '',
    null,
    undefined,
  ];

  for (const texto of noCierran) {
    test(`«${texto}» NO cierra nada`, () => {
      assert.equal(esDespedida(texto), false);
    });
  }

  test('una despedida no es un rechazo: son dos puertas distintas', () => {
    assert.equal(expresaRechazo('Agradezco mucho la atención prestada'), false);
    assert.equal(esDespedida('no me interesa'), false);
  });
});

describe('la conversación entera, no solo el último mensaje', () => {
  test('un «no me interesa» de ayer sigue valiendo hoy', () => {
    assert.equal(huboRechazo(['hola', 'no me interesa', 'ok']), true);
  });

  test('sin ningún no, no hay rechazo', () => {
    assert.equal(huboRechazo(['hola', 'me pasas el temario?', null]), false);
  });
});
