import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dentroDe, diaLocal, horaLocal, minutosLocales, proximoMomento } from './franja.js';

/**
 * El reloj de Lima contra el reloj del server (UTC). Todo lo que decide esta
 * feature cuelga de acá: si «las 9» se calculan mal, la auto-respuesta contesta
 * cuando la vendedora está trabajando o calla cuando no.
 */

const LIMA = 'America/Lima';

describe('el reloj local', () => {
  test('la hora de Lima son 5 horas menos que la del server (UTC)', () => {
    // 2026-07-26T02:30:00Z = 21:30 del 25 de julio en Lima.
    const fecha = new Date('2026-07-26T02:30:00Z');
    assert.equal(minutosLocales(fecha, LIMA), 21 * 60 + 30);
    assert.equal(horaLocal(fecha, LIMA), 21);
    assert.equal(diaLocal(fecha, LIMA), '2026-07-25');
    // El mismo instante en UTC ya es otro día: por eso el día se saca así y no con getUTCDate().
    assert.equal(diaLocal(fecha, 'UTC'), '2026-07-26');
  });

  test('dentro de la franja laboral 09:00–20:00, con el borde de arriba abierto', () => {
    const franja = { desde: '09:00', hasta: '20:00' };
    const enLima = (hhmmUtc: string) => new Date(`2026-07-25T${hhmmUtc}:00Z`);

    assert.equal(dentroDe(enLima('14:00'), franja, LIMA), true, '09:00 Lima entra');
    assert.equal(dentroDe(enLima('20:00'), franja, LIMA), true, '15:00 Lima entra');
    assert.equal(dentroDe(enLima('13:59'), franja, LIMA), false, '08:59 Lima queda afuera');
    assert.equal(dentroDe(enLima('01:00'), franja, LIMA), false, '20:00 Lima queda afuera');
    assert.equal(dentroDe(enLima('07:00'), franja, LIMA), false, '02:00 Lima: la madrugada');
  });

  test('el próximo 07:30 desde la madrugada es hoy mismo, y desde la tarde es mañana', () => {
    // 08:00Z = 03:00 de Lima → el próximo 07:30 de Lima es 12:30Z del mismo día.
    const madrugada = new Date('2026-07-25T08:00:00Z');
    assert.equal(proximoMomento(madrugada, '07:30', LIMA).toISOString(), '2026-07-25T12:30:00.000Z');

    // 23:00Z = 18:00 de Lima → el próximo 07:30 de Lima ya es el día siguiente.
    const tarde = new Date('2026-07-25T23:00:00Z');
    assert.equal(proximoMomento(tarde, '07:30', LIMA).toISOString(), '2026-07-26T12:30:00.000Z');
  });

  test('los segundos se descartan: el destino es el minuto exacto', () => {
    const conSegundos = new Date('2026-07-25T08:00:47.500Z');
    assert.equal(proximoMomento(conSegundos, '07:30', LIMA).toISOString(), '2026-07-25T12:30:00.000Z');
  });

  test('si ya es la hora exacta, el próximo momento es AHORA (no dentro de 24 h)', () => {
    const justo = new Date('2026-07-25T12:30:00Z'); // 07:30 de Lima
    assert.equal(proximoMomento(justo, '07:30', LIMA).getTime(), justo.getTime());
  });
});
