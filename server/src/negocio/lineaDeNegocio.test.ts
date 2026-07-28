import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { esConsultoria, lineaDeNegocio } from './lineaDeNegocio.js';

/**
 * Los casos de este test salieron del corpus REAL de producción (27-jul-2026,
 * 90 días): las 8 conversaciones de consultoría, más los dos textos que
 * mencionan «Consultor» y NO lo son. Esos dos son la mitad del valor del test —
 * fijan el borde por el que un criterio ancho se pasaría.
 */

// El prellenado del anuncio, tal cual llegó las 8 veces.
const PRELLENADO = 'Hola. Quiero más información sobre el servicio de Consultoría.';

describe('lineaDeNegocio', () => {
  test('el prellenado del anuncio de Consultoría se reconoce', () => {
    assert.equal(lineaDeNegocio({ textoPrimerEntrante: PRELLENADO }), 'consultoria');
  });

  test('sin tildes y en cualquier caja: es la misma frase', () => {
    assert.equal(
      lineaDeNegocio({ textoPrimerEntrante: 'HOLA. QUIERO INFO SOBRE EL SERVICIO DE CONSULTORIA' }),
      'consultoria',
    );
  });

  test('la CAMPAÑA manda cuando existe: es lo afirmado por quien armó la pauta', () => {
    assert.equal(lineaDeNegocio({ campana: '[JUL] CONSULTORÍA | CP | WSP' }), 'consultoria');
  });

  test('🔴 «Consult» suelto en un volcado de formulario NO es consultoría', () => {
    // Caso real del corpus: un formulario pegado en el chat que termina cortado
    // en «Consult». Un `contains("consultor")` se lo llevaba puesto.
    const volcado = 'Nehemías José\nJaén Celada\nnjaen@mtsconsortium.com\nRepública de Panamá\nConsult';
    assert.equal(lineaDeNegocio({ textoPrimerEntrante: volcado }), 'escuela');
  });

  test('🔴 preguntar por un diploma NO es consultoría', () => {
    // También del corpus. Es un lead de la Escuela, y mandarle el guión de
    // consultoría sería contestarle otra cosa de la que preguntó.
    const texto = 'Quiero información a cerca de una publicación que vi, hace poco sobre un diploma';
    assert.equal(lineaDeNegocio({ textoPrimerEntrante: texto }), 'escuela');
  });

  test('la palabra «consultoría» suelta tampoco alcanza', () => {
    assert.equal(lineaDeNegocio({ textoPrimerEntrante: 'trabajo en una consultoría' }), 'escuela');
  });

  test('sin ninguna señal cae en escuela — el default NO es un empate', () => {
    assert.equal(lineaDeNegocio({}), 'escuela');
    assert.equal(lineaDeNegocio({ textoPrimerEntrante: null, campana: null }), 'escuela');
    assert.equal(lineaDeNegocio({ textoPrimerEntrante: 'Hola, quiero info' }), 'escuela');
  });

  test('esConsultoria es el mismo veredicto, en booleano', () => {
    assert.equal(esConsultoria({ textoPrimerEntrante: PRELLENADO }), true);
    assert.equal(esConsultoria({ textoPrimerEntrante: 'Hola' }), false);
  });
});
