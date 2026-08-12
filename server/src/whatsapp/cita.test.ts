import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { citaDeCloudApi, citaDeWhatsmeow, contextInfoDeCita } from './cita.js';

/**
 * LOS DOS DIALECTOS DE «ESTE MENSAJE RESPONDE A AQUEL».
 *
 * Lo que se fija acá son los casos que, mal leídos, guardan una fila razonable y
 * mienten en la pantalla — el mismo criterio con el que se probó la ingesta de
 * Meta (ADR 0042): un `contextInfo` que NO es una cita, una cita adentro de una
 * cita, y una cita colgada de un adjunto en vez de un texto.
 */

const ID = '3EB0C4A1F2';

describe('whatsmeow — el contextInfo del proto', () => {
  test('una respuesta de texto trae la cita', () => {
    const proto = {
      extendedTextMessage: { text: 'sí, ese', contextInfo: { stanzaID: ID, participant: '51987654321@s.whatsapp.net' } },
    };
    assert.deepEqual(citaDeWhatsmeow(proto), { mensajeExternalId: `wa:${ID}` });
  });

  test('🔴 se acepta también `stanzaId`, la grafía que declara el `.d.ts`', () => {
    // El binario Go serializa `stanzaID`; el tipo publicado dice `stanzaId`. Al
    // LEER se aceptan las dos: si el wrapper algún día se corrige, esto no se
    // entera. Al escribir manda una sola (ver más abajo).
    const proto = { extendedTextMessage: { text: 'sí', contextInfo: { stanzaId: ID } } };
    assert.deepEqual(citaDeWhatsmeow(proto), { mensajeExternalId: `wa:${ID}` });
  });

  test('una cita a un ADJUNTO cuelga del contextInfo de la imagen, no del texto', () => {
    // Mirar solo `extendedTextMessage` perdería este caso entero — y es el que la
    // vendedora usa para decir «este flyer» sobre una foto.
    const proto = { imageMessage: { caption: 'este', contextInfo: { stanzaID: ID } } };
    assert.deepEqual(citaDeWhatsmeow(proto), { mensajeExternalId: `wa:${ID}` });
  });

  test('llega adentro de un wrapper (viewOnce) y se encuentra igual', () => {
    const proto = { viewOnceMessage: { message: { extendedTextMessage: { text: 'x', contextInfo: { stanzaID: ID } } } } };
    assert.deepEqual(citaDeWhatsmeow(proto), { mensajeExternalId: `wa:${ID}` });
  });

  test('🔴 el contextInfo del ANUNCIO no es una cita', () => {
    // El `externalAdReply` del Click-to-WhatsApp viaja en un contextInfo y lo
    // trae el primer mensaje de medio mundo. Sin `stanzaID` no hay a qué
    // colgarse: tomarlo como cita pondría una tirita vacía en cada lead nuevo.
    const proto = {
      extendedTextMessage: {
        text: 'Hola quiero info',
        contextInfo: { externalAdReply: { sourceId: '120210', title: 'Diploma OSINT' } },
      },
    };
    assert.equal(citaDeWhatsmeow(proto), null);
  });

  test('un mensaje normal no inventa una cita', () => {
    assert.equal(citaDeWhatsmeow({ conversation: 'hola' }), null);
    assert.equal(citaDeWhatsmeow({}), null);
  });

  test('🔴 responder a una respuesta apunta UN escalón atrás, no dos', () => {
    // `quotedMessage` puede traer el mensaje citado ENTERO, con el contextInfo de
    // cuando ÉL citó a otro. El de afuera es el que vale; el de adentro es
    // historia. Sin el orden correcto, la tirita señalaría al abuelo.
    const proto = {
      extendedTextMessage: {
        text: 'sí',
        contextInfo: {
          stanzaID: 'EL_PADRE',
          quotedMessage: { extendedTextMessage: { text: 'y esto', contextInfo: { stanzaID: 'EL_ABUELO' } } },
        },
      },
    };
    assert.deepEqual(citaDeWhatsmeow(proto), { mensajeExternalId: 'wa:EL_PADRE' });
  });
});

describe('cloud api — el `context` del webhook', () => {
  test('una respuesta trae `context.id`', () => {
    assert.deepEqual(citaDeCloudApi({ context: { id: ID } }), { mensajeExternalId: `wa:${ID}` });
  });

  test('🔴 un `context` SIN id (reenvío, referral) no es una cita', () => {
    assert.equal(citaDeCloudApi({ context: {} as { id?: string } }), null);
    assert.equal(citaDeCloudApi({ context: null }), null);
    assert.equal(citaDeCloudApi({}), null);
    assert.equal(citaDeCloudApi(undefined), null);
  });
});

describe('el proto que SALE por whatsmeow', () => {
  const jids = { propio: '51984429504@s.whatsapp.net', contacto: '51987654321@s.whatsapp.net' };

  test('🔴 escribe `stanzaID` — la grafía que el binario Go lee de verdad', () => {
    const ctx = contextInfoDeCita({ mensajeId: ID, esNuestro: false, texto: 'el precio' }, jids);
    assert.equal(ctx.stanzaID, ID, 'sin `stanzaID` la cita se descarta sin un solo error');
    // La otra va de yapa: `encoding/json` ignora las claves que no conoce, así
    // que mandarla no cuesta nada y cubre el día que el wrapper se corrija.
    assert.equal(ctx.stanzaId, ID);
  });

  test('🔴 el `participant` es de quien dijo el mensaje CITADO, no de quien responde', () => {
    // Citando al lead, el participant es el lead. Citándonos a nosotros, somos
    // nosotros. Con el nuestro siempre puesto, la tirita queda atribuida mal.
    assert.equal(contextInfoDeCita({ mensajeId: ID, esNuestro: false }, jids).participant, jids.contacto);
    assert.equal(contextInfoDeCita({ mensajeId: ID, esNuestro: true }, jids).participant, jids.propio);
  });

  test('el texto del citado viaja en `quotedMessage`', () => {
    const ctx = contextInfoDeCita({ mensajeId: ID, esNuestro: true, texto: 'S/ 450' }, jids);
    assert.deepEqual(ctx.quotedMessage, { conversation: 'S/ 450' });
  });

  test('sin texto NO se manda un `quotedMessage` vacío', () => {
    // El link real lo hace el `stanzaID`; un `{ conversation: "" }` solo agrega
    // una tirita en blanco del lado del lead.
    assert.ok(!('quotedMessage' in contextInfoDeCita({ mensajeId: ID, esNuestro: false, texto: null }, jids)));
    assert.ok(!('quotedMessage' in contextInfoDeCita({ mensajeId: ID, esNuestro: false }, jids)));
  });
});
