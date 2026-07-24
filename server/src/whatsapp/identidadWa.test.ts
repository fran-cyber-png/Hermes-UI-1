import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { normalizarTelefono, sufijoTelefono, telefonoDeContacto, jidDeTelefono, esJidDeGrupo } from './identidadWa.js';

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
