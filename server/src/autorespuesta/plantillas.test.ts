import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { catalogo, elegir, horaEnCriollo, render, saludoDe } from './plantillas.js';

/**
 * EL CATÁLOGO. Lo que se fija acá no es estética: es el contrato de contenido
 * de la excepción (ADR 0015) — que el mensaje avise que es automático, que no
 * lleve emojis y que nunca salga con un marcador sin rellenar.
 */

describe('el contrato de las plantillas', () => {
  for (const p of catalogo()) {
    test(`«${p.id}» avisa que es un mensaje automático`, () => {
      assert.match(p.cuerpo, /autom[áa]tico/i, 'si no lo dice, está fingiendo ser una persona');
    });

    test(`«${p.id}» no lleva emojis (regla dura #4 de la casa)`, () => {
      assert.equal(/\p{Extended_Pictographic}/u.test(p.cuerpo), false);
    });

    test(`«${p.id}» dice a qué hora responde una persona`, () => {
      assert.match(p.cuerpo, /\{\{hora_apertura\}\}/);
    });
  }
});

describe('elegir', () => {
  test('con curso conocido gana la que lo nombra', () => {
    assert.equal(elegir({ esPrimerContacto: true, curso: 'Diplomado' })?.id, 'fuera-de-horario-interes');
  });

  test('sin curso, primer contacto y seguimiento se distinguen', () => {
    assert.equal(elegir({ esPrimerContacto: true, curso: null })?.id, 'fuera-de-horario-primer-contacto');
    assert.equal(elegir({ esPrimerContacto: false, curso: null })?.id, 'fuera-de-horario-seguimiento');
  });

  test('con el catálogo vacío no hay nada que mandar', () => {
    assert.equal(elegir({ esPrimerContacto: true, curso: null }, []), null);
  });
});

describe('render', () => {
  test('rellena los marcadores', () => {
    const texto = render('{{saludo}}, sobre {{curso}} a las {{hora_apertura}}.', {
      saludo: 'Hola Ana',
      curso: 'Gestión Pública',
      horaApertura: '9:00 de la mañana',
    });
    assert.equal(texto, 'Hola Ana, sobre Gestión Pública a las 9:00 de la mañana.');
  });

  test('un marcador sin valor LANZA: antes nada que mandar «{{curso}}» a un cliente', () => {
    assert.throws(() =>
      render('{{saludo}}, sobre {{curso}}', { saludo: 'Hola', curso: null, horaApertura: '9:00' }),
    );
  });
});

describe('saludoDe', () => {
  test('usa el primer nombre cuando es usable', () => {
    assert.equal(saludoDe('Ana Lucía Pérez'), 'Hola Ana');
  });

  test('no saluda por nombre a un teléfono ni a un nombre vacío', () => {
    assert.equal(saludoDe('51961506674'), 'Hola');
    assert.equal(saludoDe(null), 'Hola');
    assert.equal(saludoDe('   '), 'Hola');
    assert.equal(saludoDe('A'), 'Hola', 'una inicial suelta no es un nombre');
  });
});

describe('horaEnCriollo', () => {
  test('lo dice como una persona, y sin punto final que duplique el de la frase', () => {
    assert.equal(horaEnCriollo('09:00'), '9:00 de la mañana');
    assert.equal(horaEnCriollo('14:30'), '2:30 de la tarde');
    assert.equal(horaEnCriollo('20:00'), '8:00 de la noche');
    assert.equal(horaEnCriollo('00:15'), '12:15 de la mañana');
  });
});
