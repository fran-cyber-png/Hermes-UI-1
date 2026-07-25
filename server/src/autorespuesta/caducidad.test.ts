import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { caducoSinAprobar, cuandoCaduca } from './caducidad.js';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';

/**
 * LA CADUCIDAD DE LO PREPARADO — con el reloj inyectado, como todo lo que decide
 * esta feature.
 *
 * La regla del dueño en una línea: «un pendiente de anoche no se manda a las 3
 * de la tarde». Traducida: una preparada vive **la gracia** (3 h por defecto)
 * después de la hora que tenía reservada, y **nunca cruza el día**.
 *
 * Referencias (Lima = UTC-5):
 *   12:30Z → 07:30 Lima (abre la ventana de la mañana)
 *   14:00Z → 09:00 Lima (llega la vendedora)
 *   15:30Z → 10:30 Lima (la gracia de una de las 07:30)
 *   20:00Z → 15:00 Lima (la hora que el dueño nombró como «ya no»)
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

/** Una preparada que tenía su turno a las 07:30 de Lima. */
const RESERVADA_0730 = new Date('2026-07-25T12:30:00Z');

describe('cuánto vive una preparada', () => {
  test('a la hora reservada está viva', () => {
    assert.equal(caducoSinAprobar(RESERVADA_0730, cfg, RESERVADA_0730).caduco, false);
  });

  test('la llegada de la vendedora NO la mata: la bandeja es justamente para ella', () => {
    const nueve = new Date('2026-07-25T14:00:00Z');
    assert.equal(caducoSinAprobar(RESERVADA_0730, cfg, nueve).caduco, false);
  });

  test('pasada la gracia (3 h), caduca: el acuse ya no sirve', () => {
    const diezYMedia = new Date('2026-07-25T15:31:00Z'); // 10:31 de Lima
    const r = caducoSinAprobar(RESERVADA_0730, cfg, diezYMedia);
    assert.equal(r.caduco, true);
    assert.match(r.caduco ? r.motivo : '', /nadie la aprobó/i);
  });

  test('a las 3 de la tarde, la hora que el dueño nombró, ya no existe', () => {
    const tresDeLaTarde = new Date('2026-07-25T20:00:00Z');
    assert.equal(caducoSinAprobar(RESERVADA_0730, cfg, tresDeLaTarde).caduco, true);
  });

  test('nunca cruza el día, aunque la gracia todavía no se haya consumido', () => {
    // Reservada 22:30 de Lima; a las 00:10 del día siguiente quedaría 1:20 de
    // gracia, pero ya es otro día: el acuse de ayer no se manda hoy.
    const reservada2230 = new Date('2026-07-26T03:30:00Z');
    const pasadaMedianoche = new Date('2026-07-26T05:10:00Z'); // 00:10 Lima del 26
    const r = caducoSinAprobar(reservada2230, cfg, pasadaMedianoche);
    assert.equal(r.caduco, true);
    assert.match(r.caduco ? r.motivo : '', /otro día|de ayer/i);
  });

  test('la gracia es configurable, y con una más corta muere antes', () => {
    const corta: ConfigAutoRespuesta = { ...cfg, graciaAprobacionMinutos: 30 };
    const ochoYCuarto = new Date('2026-07-25T13:15:00Z'); // 08:15 Lima
    assert.equal(caducoSinAprobar(RESERVADA_0730, corta, ochoYCuarto).caduco, true);
    assert.equal(caducoSinAprobar(RESERVADA_0730, cfg, ochoYCuarto).caduco, false);
  });
});

describe('cuándo caduca, para poder mostrarlo antes de que pase', () => {
  test('la bandeja puede decir «vence 10:30» sin esperar a que venza', () => {
    const vence = cuandoCaduca(RESERVADA_0730, cfg);
    assert.equal(vence.toISOString(), '2026-07-25T15:30:00.000Z'); // 10:30 de Lima
  });

  test('si la medianoche llega antes que la gracia, manda la medianoche', () => {
    const reservada2300 = new Date('2026-07-26T04:00:00Z'); // 23:00 Lima del 25
    const vence = cuandoCaduca(reservada2300, cfg);
    assert.equal(vence.toISOString(), '2026-07-26T05:00:00.000Z'); // 00:00 Lima del 26
  });
});
