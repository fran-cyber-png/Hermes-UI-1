import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { tieneContenido } from './contenido.js';

/**
 * La causa raíz del «(no es texto)»: WhatsApp manda recibos y ajustes de
 * protocolo (protocolMessage, senderKeyDistributionMessage…) como si fueran
 * mensajes del contacto. `tieneContenido` es el filtro puro que separa esos
 * "no-mensajes" del contenido real — incluida la media, que SÍ es contenido
 * aunque la descarga falle después.
 */

describe('tieneContenido', () => {
  test('un protocolMessage solo (recibo, revoke, ajuste efímero) no es contenido', () => {
    assert.equal(tieneContenido({ protocolMessage: {} }), false);
  });

  test('un texto normal (extendedTextMessage) sí es contenido', () => {
    assert.equal(tieneContenido({ extendedTextMessage: { text: 'x' } }), true);
  });

  test('una imagen sí es contenido, aunque venga vacía en el proto (la descarga se intenta aparte)', () => {
    assert.equal(tieneContenido({ imageMessage: {} }), true);
  });

  test('messageContextInfo solo (acompaña contenido real, nunca es contenido en sí) no es contenido', () => {
    assert.equal(tieneContenido({ messageContextInfo: {} }), false);
  });

  test('messageContextInfo + protocolMessage sigue sin ser contenido', () => {
    assert.equal(tieneContenido({ messageContextInfo: {}, protocolMessage: {} }), false);
  });

  test('messageContextInfo + un mensaje real sí es contenido', () => {
    assert.equal(
      tieneContenido({ messageContextInfo: {}, extendedTextMessage: { text: 'Hola' } }),
      true,
    );
  });

  test('senderKeyDistributionMessage (protocolo de grupo) no es contenido', () => {
    assert.equal(tieneContenido({ senderKeyDistributionMessage: {} }), false);
  });

  test('reactionMessage no es contenido (una reacción no es un mensaje del usuario)', () => {
    assert.equal(tieneContenido({ reactionMessage: {} }), false);
  });

  test('pollUpdateMessage no es contenido (voto de encuesta)', () => {
    assert.equal(tieneContenido({ pollUpdateMessage: {} }), false);
  });

  test('video, audio y documento son contenido igual que la imagen', () => {
    assert.equal(tieneContenido({ videoMessage: {} }), true);
    assert.equal(tieneContenido({ audioMessage: {} }), true);
    assert.equal(tieneContenido({ documentMessage: {} }), true);
  });

  test('un objeto vacío (sin ninguna key) no es contenido', () => {
    assert.equal(tieneContenido({}), false);
  });
});
