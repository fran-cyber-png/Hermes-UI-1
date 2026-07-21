import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ordenarPorUrgencia, claveUrgencia, type ItemUrgencia } from './urgencia.js';

/**
 * La urgencia decide qué ve primero la vendedora. Equivocarse acá no es cosmético:
 * entierra al lead que está comprando AHORA debajo del que puede esperar. Estos
 * tests fijan los cuatro niveles y su orden interno.
 */

const AHORA = new Date('2026-07-21T18:00:00Z');
const hDe = (n: number) => new Date(AHORA.getTime() - n * 60 * 60 * 1000);
const dDe = (n: number) => new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000);

const msg = (over: Partial<ItemUrgencia>): ItemUrgencia => ({
  tipo: 'mensaje', ventanaAbierta: false, respondida: false, referencia: hDe(2), ...over,
});
const com = (over: Partial<ItemUrgencia>): ItemUrgencia => ({
  tipo: 'comentario', ventanaAbierta: true, respondida: false, referencia: hDe(2), ...over,
});

describe('urgencia de la cola', () => {
  test('un chat VIVO (mensaje sin responder, reciente) va arriba de un comentario que expira', () => {
    // Alguien está escribiendo por WhatsApp hace 2h. Un comentario de Meta con la
    // ventana abierta hace 5 días. Goberna vende por WhatsApp: el vivo primero.
    const vivo = msg({ referencia: hDe(2) });
    const expira = com({ referencia: dDe(5) });

    assert.equal(claveUrgencia(vivo, AHORA).nivel, 0);
    assert.equal(claveUrgencia(expira, AHORA).nivel, 1);
    assert.deepEqual(ordenarPorUrgencia([expira, vivo], AHORA), [vivo, expira]);
  });

  test('T7 — comentarios que expiran: el más VIEJO va primero', () => {
    const viejo = com({ referencia: dDe(6) });
    const nuevo = com({ referencia: hDe(1) });
    assert.deepEqual(ordenarPorUrgencia([nuevo, viejo], AHORA), [viejo, nuevo]);
  });

  test('T8 — los cuatro niveles en orden: vivo, expira, espera, resto', () => {
    const vivo = msg({ referencia: hDe(3) }); //           nivel 0
    const expira = com({ referencia: hDe(10) }); //         nivel 1
    const espera = msg({ referencia: dDe(3) }); //          nivel 2 (mensaje viejo sin responder)
    const hecho = msg({ referencia: hDe(1), respondida: true }); // nivel 3

    assert.deepEqual(ordenarPorUrgencia([hecho, espera, expira, vivo], AHORA), [vivo, expira, espera, hecho]);
  });

  test('un mensaje sin responder de más de 24h deja de ser "vivo" y cae a ESPERA', () => {
    const recien = msg({ referencia: hDe(2) });
    const viejo = msg({ referencia: hDe(30) });
    assert.equal(claveUrgencia(recien, AHORA).nivel, 0);
    assert.equal(claveUrgencia(viejo, AHORA).nivel, 2);
  });

  test('un comentario respondido cae al resto aunque tenga ventana abierta', () => {
    const pendiente = com({ referencia: hDe(5) });
    const respondido = com({ referencia: hDe(1), respondida: true });
    assert.deepEqual(ordenarPorUrgencia([respondido, pendiente], AHORA), [pendiente, respondido]);
  });

  test('dentro del resto, lo más reciente va primero', () => {
    const viejo = msg({ referencia: dDe(3), respondida: true });
    const reciente = msg({ referencia: hDe(1), respondida: true });
    assert.deepEqual(ordenarPorUrgencia([viejo, reciente], AHORA), [reciente, viejo]);
  });
});
