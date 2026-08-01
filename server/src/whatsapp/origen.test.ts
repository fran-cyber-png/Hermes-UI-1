import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { detectarOrigen, detectarOrigenReferral } from './origen.js';

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

  // Los dos que faltaban: el referral llega en formas que las rutas fijas no
  // cubrían, y por eso «no detectábamos de qué anuncio vino» en unos leads sí y
  // en otros no (mismo anuncio, resultado distinto).
  test('detecta el anuncio aunque cuelgue de un tipo de mensaje no previsto', () => {
    const message = { videoMessage: { contextInfo: { externalAdReply: { sourceId: '555', title: 'Diploma Inteligencia' } } } };
    const o = detectarOrigen(message, null);
    assert.ok(o && o.fuente === 'anuncio');
    assert.equal(o.adId, '555');
    assert.equal(o.titulo, 'Diploma Inteligencia');
  });

  test('detecta el anuncio anidado dentro de un wrapper (viewOnce / mensaje-en-mensaje)', () => {
    const message = { viewOnceMessageV2: { message: { imageMessage: { contextInfo: { externalAdReply: { sourceId: '777' } } } } } };
    const o = detectarOrigen(message, null);
    assert.ok(o && o.fuente === 'anuncio');
    assert.equal(o.adId, '777');
  });
});

describe('detectarOrigenReferral — la Cloud API de Meta', () => {
  test('un referral de click-to-WhatsApp entrega el ad_id (source_id), headline y ctwa_clid', () => {
    const o = detectarOrigenReferral({
      source_id: '123456789',
      source_type: 'REEL',
      source_url: 'https://fb.me/xyz',
      headline: 'Reel spot antiguo',
      ctwa_clid: 'clid-abc',
    });
    assert.ok(o && o.fuente === 'anuncio');
    assert.equal(o.adId, '123456789');
    assert.equal(o.titulo, 'Reel spot antiguo');
    assert.equal(o.ctwaClid, 'clid-abc');
    assert.equal(o.url, 'https://fb.me/xyz');
  });

  test('sin source_id no hay anuncio atribuible', () => {
    assert.equal(detectarOrigenReferral({ headline: 'Reel spot antiguo' }), null);
    assert.equal(detectarOrigenReferral(null), null);
    assert.equal(detectarOrigenReferral('no soy un objeto'), null);
  });

  test('un referral sin headline ni clid degrada, no se cae', () => {
    const o = detectarOrigenReferral({ source_id: '42' });
    assert.ok(o && o.fuente === 'anuncio');
    assert.equal(o.adId, '42');
    assert.equal(o.titulo, null);
    assert.equal(o.ctwaClid, null);
  });
});
