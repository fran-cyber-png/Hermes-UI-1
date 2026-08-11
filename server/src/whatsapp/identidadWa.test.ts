import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  normalizarTelefono,
  sufijoTelefono,
  telefonoDeContacto,
  jidDeTelefono,
  esJidDeGrupo,
  identidadDeLid,
  esIdentidadDeLid,
  identidadDeParametro,
  PREFIJO_LID,
} from './identidadWa.js';

/**
 * Esta es la línea donde muere el vocabulario JID de WhatsApp. Si un JID se
 * escapara hacia arriba sin convertir, la ficha no cruzaría con Cerberus y la
 * respuesta podría salir a un destinatario mal armado. Estos tests fijan que la
 * conversión sea correcta y que lo que no es un teléfono se descarte, no se invente.
 */

describe('identidad WhatsApp ↔ teléfono', () => {
  test('normaliza un móvil peruano de 9 dígitos con prefijo 51', () => {
    assert.equal(normalizarTelefono('987654321'), '51987654321');
    assert.equal(normalizarTelefono('+51 987 654 321'), '51987654321');
    // Guiones, paréntesis y espacios se descartan igual que el '+'.
    assert.equal(normalizarTelefono('(51) 987-654-321'), '51987654321');
    assert.equal(normalizarTelefono('51987654321'), '51987654321');
  });

  test('el sufijo de match son los últimos 9 dígitos, venga como venga el número', () => {
    // Con código, sin código, o con separadores: la clave de match es la misma.
    assert.equal(sufijoTelefono('51987654321'), '987654321');
    assert.equal(sufijoTelefono('987654321'), '987654321');
    assert.equal(sufijoTelefono('+51 987 654 321'), '987654321');
    // Lo que no es un teléfono no genera clave (no se inventa un match).
    assert.equal(sufijoTelefono('123'), null);
    assert.equal(sufijoTelefono(''), null);
  });

  test('deriva el teléfono de un JID de contacto, con y sin sufijo de dispositivo', () => {
    assert.equal(telefonoDeContacto('51987654321@s.whatsapp.net'), '51987654321');
    // El sufijo :41 es el id de dispositivo del multi-device, no parte del número.
    assert.equal(telefonoDeContacto('51987654321:41@s.whatsapp.net'), '51987654321');
  });

  test('un JID de grupo o @lid NO es un teléfono', () => {
    assert.equal(telefonoDeContacto('123456789-987654321@g.us'), null);
    assert.equal(esJidDeGrupo('123456789-987654321@g.us'), true);
    // Los @lid modernos no traen teléfono derivable: se descartan, no se inventan.
    assert.equal(telefonoDeContacto('184700000000000@lid'), null);
  });

  test('teléfono → JID para mandar', () => {
    assert.equal(jidDeTelefono('51987654321'), '51987654321@s.whatsapp.net');
    assert.equal(jidDeTelefono('987654321'), '51987654321@s.whatsapp.net');
  });

  test('un teléfono basura para armar JID lanza, no arma un JID inválido', () => {
    assert.throws(() => jidDeTelefono('123'), /inválido/i);
  });
});

/**
 * LA IDENTIDAD `lid-` — para el contacto cuyo teléfono WhatsApp NO entrega.
 *
 * Un lead que escribe por primera vez y no está agendado llega como
 * `<id>@lid` y su teléfono no existe en ningún lado (medido: ni en
 * `whatsmeow_lid_map`, ni en `whatsmeow_contacts`, ni en la IPC del wrapper).
 * Antes se descartaba el mensaje entero. Estos tests fijan las tres propiedades
 * que hacen que eso sea seguro.
 */
describe('identidad de LID', () => {
  test('deriva la identidad del JID, con y sin sufijo de dispositivo', () => {
    assert.equal(identidadDeLid('195997208682673@lid'), 'lid-195997208682673');
    assert.equal(identidadDeLid('195997208682673:42@lid'), 'lid-195997208682673');
    assert.equal(identidadDeLid('51987654321@s.whatsapp.net'), null);
    assert.equal(identidadDeLid('12036@g.us'), null);
  });

  test('🔴 NO se puede confundir con un teléfono: normalizar y sufijo dan null', () => {
    // Sin esta guarda, `replace(/\D/g,'')` dejaría pasar el id como un número de
    // 15 dígitos y su sufijo de 9 cruzaría con el padrón de clientes: la ficha
    // de OTRA persona pegada a este chat.
    assert.equal(normalizarTelefono('lid-195997208682673'), null);
    assert.equal(sufijoTelefono('lid-195997208682673'), null);
  });

  test('🔴 la identidad NO lleva `:` — la clave de conversación se parsea por posición', () => {
    // `conv:<canal>:<persona>:<numeroPropio>` se corta con split(':'). Un `:`
    // acá correría los campos sin que nada falle.
    assert.ok(!PREFIJO_LID.includes(':'));
    const clave = `conv:whatsapp:${identidadDeLid('195997208682673@lid')}:51963139984`;
    assert.equal(clave.split(':').length, 4);
  });

  test('se puede RESPONDER: la identidad vuelve a su JID de LID', () => {
    assert.equal(jidDeTelefono('lid-195997208682673'), '195997208682673@lid');
    assert.ok(esIdentidadDeLid('lid-195997208682673'));
    assert.ok(!esIdentidadDeLid('51987654321'));
  });

  test('sobrevive al saneo de la URL, y un teléfono se sigue saneando igual', () => {
    assert.equal(identidadDeParametro('lid-195997208682673'), 'lid-195997208682673');
    assert.equal(identidadDeParametro('+51 987 654 321'), '51987654321');
    assert.equal(identidadDeParametro('lid-'), '');
  });
});
