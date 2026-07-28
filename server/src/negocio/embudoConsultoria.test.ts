import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { esCaliente, estadoDeConsultoria, LECTURA_CONSULTORIA, ESTADOS_CONSULTORIA } from './embudoConsultoria.js';

/**
 * El caso que define este módulo es un chat real del 27-jul-2026: llega por el
 * anuncio el viernes 23:45, Walter contesta el sábado 10:20 con su guión, y a
 * las 14:26 la persona manda su nombre, su municipalidad y su partido. Ese
 * último paso es el que hay que poder ver desde la cola sin abrir el chat.
 */

describe('estadoDeConsultoria', () => {
  test('escribió y nadie le contestó: NUEVO', () => {
    assert.equal(estadoDeConsultoria({ leEscribimos: false, contestoDespues: false }), 'nuevo');
  });

  test('le mandamos el guión y todavía no contesta: ESPERANDO', () => {
    assert.equal(estadoDeConsultoria({ leEscribimos: true, contestoDespues: false }), 'esperando');
  });

  test('🔥 contestó el pedido de datos: CALIENTE', () => {
    assert.equal(estadoDeConsultoria({ leEscribimos: true, contestoDespues: true }), 'caliente');
    assert.equal(esCaliente({ leEscribimos: true, contestoDespues: true }), true);
  });

  test('🔴 sin haberle escrito NUNCA es caliente, aunque el flag venga en true', () => {
    // El entrante inicial lo manda TODO lead. Si contara como respuesta,
    // estarían todos calientes y la marca no distinguiría nada — que es
    // exactamente igual de inútil que no tenerla.
    assert.equal(estadoDeConsultoria({ leEscribimos: false, contestoDespues: true }), 'nuevo');
    assert.equal(esCaliente({ leEscribimos: false, contestoDespues: true }), false);
  });

  test('los tres estados tienen lectura, y ninguna promete una venta', () => {
    for (const e of ESTADOS_CONSULTORIA) {
      const l = LECTURA_CONSULTORIA[e];
      assert.ok(l.rotulo.length > 0, `${e} sin rótulo`);
      assert.ok(l.porque.length > 0, `${e} sin porqué`);
      // Mismo criterio que `resultados/medicion.ts`: los nombres describen lo
      // que pasó, no lo que va a pasar. «Caliente» ya es todo lo que se puede
      // afirmar; «va a comprar» sería inventar.
      assert.doesNotMatch(l.rotulo + l.porque, /va a comprar|seguro|garantiz/i);
    }
  });
});
