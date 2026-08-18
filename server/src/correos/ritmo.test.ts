import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { frenoDeRitmo, TECHO_HORA, TECHO_DIA } from './ritmo.js';
import { CONFIG_POR_DEFECTO } from '../autorespuesta/config.js';

/**
 * El techo que convierte «nada masivo» de una frase de la pantalla en una
 * propiedad del código. Puro: no hace falta base ni reloj — los conteos llegan
 * resueltos por quien los cuenta.
 */

describe('el freno de ritmo de correos', () => {
  test('abajo de los dos techos no frena', () => {
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 19, ultimoDia: 50 }), { frena: false });
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 0, ultimoDia: 0 }), { frena: false });
  });

  test('con 20 en la hora frena, y dice el techo y lo usado', () => {
    // ⚠️ `>=`, no `>`: con `>` el techo real sería 21 — el error clásico de un
    // contador que empieza en cero. Y las dos cifras van juntas porque un
    // «alcanzaste el límite» pelado no se puede verificar: lo primero que hace
    // quien lo lee es volver a intentar.
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 20, ultimoDia: 50 }), {
      frena: true,
      motivo: 'techo_hora',
      techo: 20,
      usado: 20,
    });
  });

  test('con 60 en el día frena, aunque la hora esté tranquila', () => {
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 5, ultimoDia: 60 }), {
      frena: true,
      motivo: 'techo_dia',
      techo: 60,
      usado: 60,
    });
  });

  test('🔴 con los DOS pasados gana el techo de la HORA, que es el más chico', () => {
    // 25 en la hora y 70 en el día: los dos son ciertos. Si contestara
    // `techo_dia`, la vendedora leería «60 por día» y se iría a esperar hasta
    // mañana — cuando lo que la destraba es el próximo cambio de hora. El motivo
    // que se devuelve tiene que ser el que dice CUÁNDO se destraba.
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 25, ultimoDia: 70 }), {
      frena: true,
      motivo: 'techo_hora',
      techo: 20,
      usado: 25,
    });
  });

  test('un conteo por encima del techo frena igual, no se lee como «ya pasó»', () => {
    // Puede pasar de verdad: dos pedidos en vuelo a la vez, o un techo que bajó.
    // Un `=== TECHO` en vez de `>=` dejaría pasar todo lo que está por arriba.
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 999, ultimoDia: 999 }), {
      frena: true,
      motivo: 'techo_hora',
      techo: 20,
      usado: 999,
    });
    assert.deepEqual(frenoDeRitmo({ ultimaHora: 0, ultimoDia: 999 }), {
      frena: true,
      motivo: 'techo_dia',
      techo: 60,
      usado: 999,
    });
  });
});

describe('paridad con el ritmo de WhatsApp (#37)', () => {
  test('los dos techos son los MISMOS números que los de la auto-respuesta', () => {
    // Dos ritmos distintos en la misma app es #37 con otra ropa: la vendedora
    // aprendería un límite por canal, y el día que se toque uno el otro queda
    // viejo sin que nada se ponga rojo. Este test se pone rojo ahí.
    //
    // ⚠️ Lo que fija son los NÚMEROS, no la configuración viva: el ritmo de
    // WhatsApp se puede mover por entorno (`AUTO_RESPUESTA_TECHO_HORA`) y el de
    // correos no, a propósito — acá el techo es política, no un parámetro.
    // ⚠️ Y el SUJETO no es el mismo: allá es por LÍNEA, acá por VENDEDORA (el
    // `From` es compartido, así que contar por remitente no acotaría a nadie).
    assert.equal(TECHO_HORA, CONFIG_POR_DEFECTO.techoPorHora);
    assert.equal(TECHO_DIA, CONFIG_POR_DEFECTO.techoPorDia);
  });
});
