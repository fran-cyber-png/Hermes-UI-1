import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { proyectarMensaje } from './proyectar.js';
import type { MensajeWhatsapp } from './transporte.js';

/**
 * El proyector es la traducción de "lo que dijo WhatsApp" a "lo que Hermes guarda".
 * Es puro a propósito: sin DB, sin red, sin reloj propio. Un mensaje entra, un par
 * {evento, interacción} sale — o un descarte con motivo. Testearlo es barato y
 * atrapa las decisiones que después son caras de deshacer en la base.
 */

function mensaje(over: Partial<MensajeWhatsapp> = {}): MensajeWhatsapp {
  return {
    idExterno: 'ABC123',
    numeroPropio: '51987654321',
    telefono: '51961506674',
    esMio: false,
    esGrupo: false,
    ocurridoEn: new Date('2026-07-21T15:00:00Z'),
    nombreVisible: 'Andre',
    texto: 'hola, info del diplomado?',
    clase: 'texto',
    ...over,
  };
}

describe('proyectarMensaje', () => {
  test('T1 — un entrante produce la interacción canónica de whatsapp', () => {
    const r = proyectarMensaje(mensaje());
    assert.ok('interaccion' in r, 'debería proyectar, no descartar');

    assert.equal(r.interaccion.canal, 'whatsapp');
    assert.equal(r.interaccion.tipo, 'mensaje');
    assert.equal(r.interaccion.direccion, 'entrante');
    assert.equal(r.interaccion.autor, 'persona');
    assert.equal(r.interaccion.personaId, '51961506674');
    assert.equal(r.interaccion.personaNombre, 'Andre');
    assert.equal(r.interaccion.texto, 'hola, info del diplomado?');
    assert.deepEqual(r.interaccion.occurredAt, new Date('2026-07-21T15:00:00Z'));

    // El evento crudo espeja lo mismo, con la clave de idempotencia prefijada.
    assert.equal(r.evento.source, 'whatsapp');
    assert.equal(r.evento.externalId, 'wa:ABC123');
    assert.equal(r.interaccion.externalId, 'wa:ABC123');
  });

  test('T2 — un saliente (esMio) es dirección saliente y autor pagina', () => {
    const r = proyectarMensaje(mensaje({ esMio: true }));
    assert.ok('interaccion' in r);
    assert.equal(r.interaccion.direccion, 'saliente');
    // El bug histórico de descartar los salientes no se repite: se guardan las
    // dos mitades de la conversación.
    assert.equal(r.interaccion.autor, 'pagina');
  });

  test('T3 — un mensaje de grupo se descarta con motivo, no produce fila', () => {
    const r = proyectarMensaje(mensaje({ esGrupo: true }));
    assert.ok('descarte' in r, 'un grupo no es un contacto que registrar');
    assert.match(r.descarte, /grupo/i);
  });

  test('T4 — multimedia: texto null, pero la clase cruda no se pierde', () => {
    const r = proyectarMensaje(mensaje({ clase: 'multimedia', texto: null }));
    assert.ok('interaccion' in r);
    assert.equal(r.interaccion.texto, null);
    // La información de que era multimedia queda en el payload del evento: el día
    // que Hermes sepa mostrar audios, se reproyecta desde acá sin perder nada.
    assert.equal(r.evento.payload.clase, 'multimedia');
    assert.equal(r.evento.payload.numeroPropio, '51987654321');
  });

  test('T5 — idempotencia determinista: el mismo mensaje da la misma clave', () => {
    const m = mensaje();
    const a = proyectarMensaje(m);
    const b = proyectarMensaje(m);
    assert.ok('evento' in a && 'evento' in b);
    assert.equal(a.evento.externalId, b.evento.externalId);
    assert.equal(a.evento.source, b.evento.source);
  });

  test('sin teléfono derivable, se descarta — nunca se inventa un contacto', () => {
    const r = proyectarMensaje(mensaje({ telefono: '' }));
    assert.ok('descarte' in r);
  });

  test('un mensaje al propio número se descarta (ruido de protocolo)', () => {
    const r = proyectarMensaje(mensaje({ telefono: '51987654321', numeroPropio: '51987654321' }));
    assert.ok('descarte' in r);
    assert.match(r.descarte, /propio|protocolo/i);
  });
});
