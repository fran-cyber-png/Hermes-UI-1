import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { detectarOrigen } from './origen.js';

/**
 * Detectar de dónde vino el lead es la captura del embudo. Estos tests fijan que
 * un mensaje de click-to-WhatsApp entregue el ad_id, y que una landing entregue su
 * código — y que un mensaje común no invente un origen.
 */

describe('detectarOrigen', () => {
  test('un mensaje de anuncio (externalAdReply) entrega el ad_id y el ctwaClid', () => {
    // La forma que trae WhatsApp cuando la persona vino de un Click-to-WhatsApp.
    const message = {
      extendedTextMessage: {
        text: 'Hola, me interesa el diplomado',
        contextInfo: {
          externalAdReply: {
            title: 'Diplomado en Operaciones Clandestinas',
            sourceType: 'ad',
            sourceId: '120210000000000123',
            sourceUrl: 'https://fb.me/xyz',
            ctwaClid: 'ARBc123ctwa',
          },
        },
      },
    };
    const o = detectarOrigen(message, 'Hola, me interesa el diplomado');
    assert.ok(o && o.fuente === 'anuncio');
    assert.equal(o.adId, '120210000000000123');
    assert.equal(o.ctwaClid, 'ARBc123ctwa');
    assert.equal(o.titulo, 'Diplomado en Operaciones Clandestinas');
  });

  test('una landing se detecta por el código entre corchetes del texto', () => {
    const o = detectarOrigen({ conversation: 'Hola, quiero info [clandestinas]' }, 'Hola, quiero info [clandestinas]');
    assert.ok(o && o.fuente === 'landing');
    assert.equal(o.ref, 'clandestinas');
  });

  test('el anuncio gana sobre un corchete en el texto (la señal fuerte manda)', () => {
    const message = {
      extendedTextMessage: {
        contextInfo: { externalAdReply: { sourceId: '999', ctwaClid: 'clid' } },
      },
    };
    const o = detectarOrigen(message, 'hola [landingx]');
    assert.equal(o?.fuente, 'anuncio');
  });

  test('un mensaje común no tiene origen — no se inventa', () => {
    assert.equal(detectarOrigen({ conversation: 'hola, cuánto sale?' }, 'hola, cuánto sale?'), null);
    assert.equal(detectarOrigen({}, null), null);
  });

  test('un externalAdReply sin sourceId no cuenta como anuncio', () => {
    const message = { extendedTextMessage: { contextInfo: { externalAdReply: { title: 'algo' } } } };
    assert.equal(detectarOrigen(message, 'hola'), null);
  });
});
