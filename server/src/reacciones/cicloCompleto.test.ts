import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  esSoloReaccion,
  leerReaccion,
  reaccionDeCloudApi,
  reaccionDeWhatsmeow,
} from './dominio.js';
import { tieneContenido } from '../whatsapp/contenido.js';

/**
 * EL CICLO DE UNA REACCIÓN, DE PUNTA A PUNTA — sin base y sin red.
 *
 * Lo que se fija acá no es una función sino **el acuerdo entre dos módulos que
 * podrían divergir**: `contenido.ts` sigue diciendo que una reacción NO es
 * contenido (y tiene que seguir diciéndolo, o vuelve el fantasma de #70), y
 * `dominio.ts` la rescata igual antes de que ese descarte la mate.
 *
 * Si alguien "arregla" `contenido.ts` sacando `reactionMessage` de la lista, el
 * fantasma vuelve y este archivo lo grita.
 */

describe('el acuerdo con `contenido.ts`', () => {
  const proto = { reactionMessage: { key: { id: '3EB0' }, text: '👍' } };

  test('🔴 una reacción NO es contenido, y eso no puede cambiar', () => {
    // Si esto diera `true`, la reacción entraría a `interactions` y se dibujaría
    // como una burbuja vacía que dice «(no es texto)» — el bug #70 exacto, que
    // es por lo que estuvieron descartadas durante meses.
    assert.equal(tieneContenido(proto), false);
  });

  test('…y aun así se reconoce y se rescata', () => {
    assert.equal(esSoloReaccion(proto), true);
    const r = reaccionDeWhatsmeow(proto, { dePersona: '51987654321', cuando: new Date() });
    assert.equal(r?.mensajeExternalId, 'wa:3EB0');
  });

  test('🔴 el rescate NO se traga un mensaje con contenido', () => {
    // Un texto que además trae `reactionMessage` en el proto tiene que seguir
    // su camino normal: rutearlo a la tabla de reacciones lo borraría del hilo.
    const conTexto = { conversation: 'hola', reactionMessage: {} };
    assert.equal(esSoloReaccion(conTexto), false);
    assert.equal(tieneContenido(conTexto), true);
  });
});

describe('poner, cambiar y quitar — el ciclo que WhatsApp usa de verdad', () => {
  const de = { dePersona: '51987654321', cuando: new Date('2026-08-05T20:00:00Z') };
  const conEmoji = (text: string) =>
    reaccionDeWhatsmeow({ reactionMessage: { key: { id: '3EB0' }, text } }, de);

  test('poner → cambiar → quitar viaja todo por el mismo canal', () => {
    // Las tres llegan como «una reacción». Lo único que las distingue es el
    // emoji, y por eso la decisión vive en `leerReaccion` y no en tres caminos.
    assert.deepEqual(leerReaccion(conEmoji('👍')?.emoji), { tipo: 'poner', emoji: '👍' });
    assert.deepEqual(leerReaccion(conEmoji('❤️')?.emoji), { tipo: 'poner', emoji: '❤️' });
    assert.deepEqual(leerReaccion(conEmoji('')?.emoji), { tipo: 'quitar' });
  });

  test('las tres apuntan al MISMO mensaje: es un estado, no un historial', () => {
    // Por eso la PK de la tabla es (mensaje, persona) y no un id propio. Con
    // historial, un mensaje mostraría 👍❤️ de la misma persona — que en el
    // teléfono se ve como uno solo.
    const ids = ['👍', '❤️', ''].map((e) => conEmoji(e)?.mensajeExternalId);
    assert.deepEqual(new Set(ids), new Set(['wa:3EB0']));
  });
});

describe('los dos canales producen la MISMA forma', () => {
  test('Cloud API y whatsmeow coinciden en mensaje, emoji y persona', () => {
    // Si divergieran, el repositorio guardaría dos formas distintas y el JOIN
    // con `interactions` daría cero filas para una de las dos, en silencio.
    const nube = reaccionDeCloudApi({
      type: 'reaction',
      from: '51987654321',
      timestamp: '1754400000',
      reaction: { message_id: 'ABC', emoji: '👍' },
    });
    const meow = reaccionDeWhatsmeow(
      { reactionMessage: { key: { id: 'ABC' }, text: '👍', senderTimestampMs: 1754400000000 } },
      { dePersona: '51987654321', cuando: new Date(0) },
    );
    assert.equal(nube?.mensajeExternalId, meow?.mensajeExternalId);
    assert.equal(nube?.emoji, meow?.emoji);
    assert.equal(nube?.dePersona, meow?.dePersona);
    assert.equal(nube?.cuando.getTime(), meow?.cuando.getTime());
  });
});

describe('paridad con el front', () => {
  test('🔴 el prefijo `wa:` es el mismo con el que se guardan los mensajes', () => {
    // El JOIN entero cuelga de esto. Se lee del archivo que proyecta los
    // mensajes en vez de confiar en que alguien no lo cambió.
    const proyectar = readFileSync(new URL('../whatsapp/proyectar.ts', import.meta.url), 'utf8');
    assert.match(proyectar, /wa:\$\{/, 'la proyección ya no usa el prefijo `wa:`: el JOIN daría cero filas');
  });
});
