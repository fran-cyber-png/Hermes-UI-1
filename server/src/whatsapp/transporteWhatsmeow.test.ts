import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransporteWhatsmeow } from './transporteWhatsmeow.js';
import { FotoNoDisponibleError } from './transporte.js';

/**
 * REGRESIÓN de #70, encontrada por la revisión adversaria del PR #74: los 11
 * tests de `contenido.test.ts` prueban `tieneContenido` en aislamiento, pero
 * ninguno prueba que `aMensaje` — el método real que usa `cablearEventos` —
 * de verdad LLAME a ese guard. Si alguien borra la línea
 * `if (!tieneContenido(message)) return null` del cableado, esos 11 tests
 * siguen verdes y el «(no es texto)» vuelve sin que CI lo note.
 *
 * Estos tests pasan por `aMensajeParaTests` (una costura agregada solo para
 * esto — ver su comentario en transporteWhatsmeow.ts), que llama al mismo
 * `aMensaje` privado. No hace falta una sesión de whatsmeow real: el
 * constructor de `TransporteWhatsmeow` no levanta ningún proceso.
 */

const dir = mkdtempSync(join(tmpdir(), 'transporte-whatsmeow-'));

const INFO_BASE = {
  id: 'wa-1',
  chat: '51961506674@s.whatsapp.net',
  sender: '51961506674@s.whatsapp.net',
  isFromMe: false,
  isGroup: false,
  timestamp: 1753300000,
  pushName: 'Andre',
};

describe('TransporteWhatsmeow — aMensaje descarta protocolMessage (regresión #70)', () => {
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('un evento con solo protocolMessage + messageContextInfo NO produce mensaje', async () => {
    const t = new TransporteWhatsmeow('51987654321', dir);
    const m = await t.aMensajeParaTests(INFO_BASE, {
      messageContextInfo: {},
      protocolMessage: {},
    });
    assert.equal(m, null);
  });

  test('control: el mismo teléfono con un texto real SÍ produce mensaje', async () => {
    // Mismo chat/teléfono resoluble que el caso de arriba — la única variable
    // es el contenido del proto. Si esto también diera null, el test de
    // arriba no probaría nada (podría estar fallando por el teléfono, no por
    // el guard).
    const t = new TransporteWhatsmeow('51987654321', dir);
    const m = await t.aMensajeParaTests(
      { ...INFO_BASE, id: 'wa-2' },
      { extendedTextMessage: { text: 'x' } },
    );
    assert.ok(m, 'un extendedTextMessage con teléfono resoluble debe producir mensaje');
    assert.equal(m?.texto, 'x');
    assert.equal(m?.clase, 'texto');
    assert.equal(m?.telefono, '51961506674');
  });
});

/**
 * Regresión del hallazgo de la revisión del PR #75: el constructor de
 * `TransporteWhatsmeow` deja la sesión en `'conectando'` (ver la inicialización
 * del campo `sesion`) — es exactamente el estado en el que queda el transporte
 * justo después de un restart del server, antes de que whatsmeow reconecte. En
 * ese hueco, `fotoDePerfil` NO debe devolver `null` (eso terminaba cacheado 7
 * días como "no tiene foto" por la ruta) sino señalizar que no se pudo preguntar.
 * Como el chequeo de estado corre ANTES de tocar `this.client`, este test no
 * necesita levantar ningún proceso real (mismo principio que `aMensajeParaTests`).
 */
describe('TransporteWhatsmeow — fotoDePerfil no cachea el hueco post-restart (regresión PR #75)', () => {
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('recién construido (estado "conectando"), fotoDePerfil señala "no disponible", no null', async () => {
    const t = new TransporteWhatsmeow('51987654321', dir);
    assert.equal(t.estado().estado, 'conectando', 'precondición: el transporte arranca sin conectar');
    await assert.rejects(() => t.fotoDePerfil('51961506674'), FotoNoDisponibleError);
  });
});
