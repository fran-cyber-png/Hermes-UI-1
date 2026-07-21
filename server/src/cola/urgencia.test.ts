import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ordenarPorUrgencia, claveUrgencia, type ItemUrgencia } from './urgencia.js';

/**
 * La urgencia decide qué ve primero la vendedora. Equivocarse acá no es un bug
 * cosmético: entierra al lead que se pierde para siempre debajo del que puede
 * esperar. Estos tests fijan los dos niveles y su orden interno.
 */

const dias = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const horas = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);

describe('urgencia de la cola', () => {
  test('T7 — comentario Meta con ventana abierta: el más VIEJO va primero', () => {
    // Los dos tienen la ventana abierta; el de 6 días está por vencerse, el de 1h
    // recién llegó. El que se está por perder va arriba, aunque sea más viejo.
    const viejo: ItemUrgencia = { tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: dias(6) };
    const nuevo: ItemUrgencia = { tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: horas(1) };

    const orden = ordenarPorUrgencia([nuevo, viejo]);
    assert.deepEqual(orden, [viejo, nuevo]);
  });

  test('T8 — dos niveles: lo que EXPIRA antes que lo que ESPERA antes que lo respondido', () => {
    // Lo que expira: comentario FB, ventana abierta, hace 10h.
    const expira: ItemUrgencia = { tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: horas(10) };
    // Lo que espera: WhatsApp sin responder, hace 20h (más viejo, pero no expira).
    const espera: ItemUrgencia = { tipo: 'mensaje', ventanaAbierta: false, respondida: false, referencia: horas(20) };
    // El resto: WhatsApp ya respondido.
    const hecho: ItemUrgencia = { tipo: 'mensaje', ventanaAbierta: false, respondida: true, referencia: horas(2) };

    const orden = ordenarPorUrgencia([hecho, espera, expira]);
    assert.deepEqual(
      orden,
      [expira, espera, hecho],
      'lo que se pierde para siempre va arriba, aunque el que espera sea más viejo',
    );
  });

  test('un comentario respondido cae al nivel del resto aunque tenga ventana abierta', () => {
    const pendiente: ItemUrgencia = { tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: horas(5) };
    const respondido: ItemUrgencia = { tipo: 'comentario', ventanaAbierta: true, respondida: true, referencia: horas(1) };

    const orden = ordenarPorUrgencia([respondido, pendiente]);
    assert.deepEqual(orden, [pendiente, respondido], 'lo pendiente manda sobre lo ya hecho');
  });

  test('dentro del resto, lo más reciente va primero', () => {
    const viejo: ItemUrgencia = { tipo: 'mensaje', ventanaAbierta: false, respondida: true, referencia: dias(3) };
    const reciente: ItemUrgencia = { tipo: 'mensaje', ventanaAbierta: false, respondida: true, referencia: horas(1) };

    assert.deepEqual(ordenarPorUrgencia([viejo, reciente]), [reciente, viejo]);
  });

  test('los niveles son estables: 0 expira, 1 espera, 2 resto', () => {
    assert.equal(claveUrgencia({ tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: new Date() }).nivel, 0);
    assert.equal(claveUrgencia({ tipo: 'mensaje', ventanaAbierta: false, respondida: false, referencia: new Date() }).nivel, 1);
    assert.equal(claveUrgencia({ tipo: 'mensaje', ventanaAbierta: false, respondida: true, referencia: new Date() }).nivel, 2);
  });
});
