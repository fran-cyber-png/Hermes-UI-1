import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  esSoloReaccion,
  externalIdDeWa,
  leerReaccion,
  reaccionDeCloudApi,
  reaccionDeWhatsmeow,
} from './dominio.js';

describe('leerReaccion', () => {
  test('un emoji se pone', () => {
    assert.deepEqual(leerReaccion('👍'), { tipo: 'poner', emoji: '👍' });
  });

  test('🔴 vacío es QUITAR, no «reaccionar con nada»', () => {
    // Es la forma que usa WhatsApp para desreaccionar y llega por el mismo
    // camino. Tratarla como `poner('')` dejaría una píldora vacía colgando de
    // la burbuja para siempre.
    assert.deepEqual(leerReaccion(''), { tipo: 'quitar' });
    assert.deepEqual(leerReaccion('   '), { tipo: 'quitar' });
    assert.deepEqual(leerReaccion(null), { tipo: 'quitar' });
    assert.deepEqual(leerReaccion(undefined), { tipo: 'quitar' });
  });

  test('los espacios de alrededor no cambian el emoji', () => {
    assert.deepEqual(leerReaccion(' ❤️ '), { tipo: 'poner', emoji: '❤️' });
  });
});

describe('reaccionDeCloudApi', () => {
  const base = {
    type: 'reaction',
    from: '51987654321',
    timestamp: '1754400000',
    reaction: { message_id: 'wamid.ABC', emoji: '👍' },
  };

  test('traduce una reacción entrante', () => {
    const r = reaccionDeCloudApi(base);
    assert.equal(r?.mensajeExternalId, 'wa:wamid.ABC');
    assert.equal(r?.dePersona, '51987654321');
    assert.equal(r?.emoji, '👍');
    assert.equal(r?.cuando.getTime(), 1754400000 * 1000);
  });

  test('un mensaje que NO es reacción no se confunde con una', () => {
    assert.equal(reaccionDeCloudApi({ ...base, type: 'text' }), null);
    assert.equal(reaccionDeCloudApi({ type: 'image', from: '519' }), null);
  });

  test('🔴 sin `message_id` se descarta: una reacción a nada no sirve', () => {
    assert.equal(reaccionDeCloudApi({ ...base, reaction: { emoji: '👍' } }), null);
  });

  test('sin remitente tampoco', () => {
    assert.equal(reaccionDeCloudApi({ ...base, from: undefined }), null);
  });

  test('quitar la reacción viaja como emoji vacío y se traduce igual', () => {
    const r = reaccionDeCloudApi({ ...base, reaction: { message_id: 'wamid.ABC', emoji: '' } });
    assert.equal(r?.emoji, '');
    assert.deepEqual(leerReaccion(r?.emoji), { tipo: 'quitar' });
  });

  test('el teléfono queda solo en dígitos, como el resto de Hermes', () => {
    const r = reaccionDeCloudApi({ ...base, from: '+51 987 654 321' });
    assert.equal(r?.dePersona, '51987654321');
  });
});

describe('reaccionDeWhatsmeow', () => {
  const ctx = { dePersona: '51987654321', cuando: new Date('2026-08-05T20:00:00Z') };

  test('traduce el proto', () => {
    const r = reaccionDeWhatsmeow(
      { reactionMessage: { key: { id: '3EB0' }, text: '❤️', senderTimestampMs: 1754400000000 } },
      ctx,
    );
    assert.equal(r?.mensajeExternalId, 'wa:3EB0');
    assert.equal(r?.emoji, '❤️');
    assert.equal(r?.cuando.getTime(), 1754400000000);
  });

  test('🔴 el sello PROPIO de la reacción le gana al del sobre', () => {
    // El del sobre es cuándo LLEGÓ: con el server caído un rato, todas las
    // reacciones se agruparían en el mismo instante — justo cuando el orden
    // importa.
    const r = reaccionDeWhatsmeow(
      { reactionMessage: { key: { id: '3EB0' }, text: '👍', senderTimestampMs: 1754000000000 } },
      ctx,
    );
    assert.equal(r?.cuando.getTime(), 1754000000000);
    assert.notEqual(r?.cuando.getTime(), ctx.cuando.getTime());
  });

  test('sin sello propio cae al del sobre, no a un cero', () => {
    const r = reaccionDeWhatsmeow({ reactionMessage: { key: { id: '3EB0' }, text: '👍' } }, ctx);
    assert.equal(r?.cuando.getTime(), ctx.cuando.getTime());
  });

  test('un proto sin reacción devuelve null', () => {
    assert.equal(reaccionDeWhatsmeow({ conversation: 'hola' }, ctx), null);
  });

  test('sin id del mensaje no se guarda', () => {
    assert.equal(reaccionDeWhatsmeow({ reactionMessage: { text: '👍' } }, ctx), null);
  });
});

describe('esSoloReaccion', () => {
  test('reconoce el proto que hoy se descarta', () => {
    assert.equal(esSoloReaccion({ reactionMessage: { key: { id: 'x' }, text: '👍' } }), true);
  });

  test('`messageContextInfo` acompaña y no cuenta', () => {
    assert.equal(esSoloReaccion({ reactionMessage: {}, messageContextInfo: {} }), true);
  });

  test('🔴 un mensaje CON contenido no se trata como reacción', () => {
    // Si esto diera `true`, un texto normal se rutearía a la tabla de
    // reacciones y desaparecería del hilo.
    assert.equal(esSoloReaccion({ conversation: 'hola', reactionMessage: {} }), false);
    assert.equal(esSoloReaccion({ conversation: 'hola' }), false);
  });

  test('un proto vacío no es una reacción', () => {
    assert.equal(esSoloReaccion({}), false);
    assert.equal(esSoloReaccion({ messageContextInfo: {} }), false);
  });
});

describe('externalIdDeWa', () => {
  test('usa el mismo prefijo con el que se guardan los mensajes', () => {
    // Sin esto el JOIN con `interactions` da cero filas EN SILENCIO — que se
    // lee como «ese mensaje no tuvo reacciones».
    assert.equal(externalIdDeWa('wamid.ABC'), 'wa:wamid.ABC');
  });
});
