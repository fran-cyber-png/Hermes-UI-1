import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIG_POR_DEFECTO, ventanasEfectivas, type ConfigAutoRespuesta } from './config.js';
import { dentroDe } from './franja.js';
import { programar, type Candidato } from './programar.js';

/**
 * EL RITMO. Estos tests son la red de seguridad de la parte que puede hacer
 * daño: acá se fija que lo de la madrugada no salga de madrugada, que no haya
 * ráfaga, que el espaciado esté en el rango y que los techos se respeten.
 *
 * Referencias (Lima = UTC-5): 08:00Z = 03:00 Lima · 12:30Z = 07:30 Lima ·
 * 13:00Z = 08:00 Lima · 14:00Z = 09:00 Lima (abre la vendedora).
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

const MADRUGADA = new Date('2026-07-25T08:00:00Z'); // 03:00 de Lima

/** Azar fijo: `0` = el mínimo del rango, `1` = el máximo. Determinista. */
const azarFijo = (v: number) => () => v;

const candidato = (n: number, minutosAntes: number, numeroPropio = '51986394450'): Candidato => ({
  clave: `conv:whatsapp:5196150000${n}:${numeroPropio}`,
  telefono: `5196150000${n}`,
  numeroPropio,
  personaNombre: `Lead ${n}`,
  plantillaId: 'fuera-de-horario-primer-contacto',
  texto: 'Hola, gracias por escribirnos…',
  desde: new Date(MADRUGADA.getTime() - minutosAntes * 60_000),
});

describe('la madrugada se acumula y sale de mañana', () => {
  test('nadie recibe un mensaje a las 3 a. m.: todo se programa a partir de las 07:30', () => {
    const candidatos = [candidato(1, 120), candidato(2, 90), candidato(3, 45)];
    const plan = programar(candidatos, cfg, MADRUGADA, azarFijo(0.5));

    assert.equal(plan.ranuras.length, 3);
    for (const r of plan.ranuras) {
      assert.ok(
        r.programadoPara.getTime() >= new Date('2026-07-25T12:30:00Z').getTime(),
        `programado a las ${r.programadoPara.toISOString()}, antes de las 07:30 de Lima`,
      );
    }
  });

  test('el que más esperó, primero', () => {
    const plan = programar([candidato(3, 45), candidato(1, 300), candidato(2, 120)], cfg, MADRUGADA, azarFijo(0));
    assert.deepEqual(
      plan.ranuras.map((r) => r.candidato.telefono),
      ['51961500001', '51961500002', '51961500003'],
    );
  });

  test('ningún envío cae dentro del horario de la vendedora', () => {
    const candidatos = Array.from({ length: 30 }, (_, i) => candidato(i, 300 - i));
    const plan = programar(candidatos, cfg, MADRUGADA, azarFijo(0));
    for (const r of plan.ranuras) {
      assert.equal(
        dentroDe(r.programadoPara, cfg.franja, cfg.zona),
        false,
        `${r.programadoPara.toISOString()} cae en horario de atención`,
      );
    }
  });
});

describe('el espaciado: nada de vaciar la cola de golpe', () => {
  test('con el azar en el mínimo, los envíos quedan a 60 s exactos', () => {
    const plan = programar([candidato(1, 300), candidato(2, 200), candidato(3, 100)], cfg, MADRUGADA, azarFijo(0));
    const t = plan.ranuras.map((r) => r.programadoPara.toISOString());
    assert.deepEqual(t, ['2026-07-25T12:30:00.000Z', '2026-07-25T12:31:00.000Z', '2026-07-25T12:32:00.000Z']);
  });

  test('con el azar en el máximo, quedan a 240 s', () => {
    const plan = programar([candidato(1, 300), candidato(2, 200)], cfg, MADRUGADA, azarFijo(1));
    const [a, b] = plan.ranuras.map((r) => r.programadoPara.getTime());
    assert.equal((b - a) / 1000, 240);
  });

  test('con azar real, TODA distancia entre envíos consecutivos cae en el rango configurado', () => {
    const candidatos = Array.from({ length: 12 }, (_, i) => candidato(i, 300 - i * 5));
    const plan = programar(candidatos, cfg, MADRUGADA);
    const tiempos = plan.ranuras.map((r) => r.programadoPara.getTime()).sort((x, y) => x - y);
    const [min, max] = cfg.espaciadoSegundos;

    for (let i = 1; i < tiempos.length; i++) {
      const distancia = (tiempos[i] - tiempos[i - 1]) / 1000;
      assert.ok(
        distancia >= min && distancia <= max,
        `dos envíos a ${distancia} s: fuera del rango ${min}–${max}`,
      );
    }
  });

  test('dos números propios son dos canales: cada uno con su propio ritmo', () => {
    const plan = programar(
      [candidato(1, 300, '51986394450'), candidato(2, 290, '51999888777')],
      cfg,
      MADRUGADA,
      azarFijo(0),
    );
    // Ninguno espera al otro: los dos arrancan al abrir la ventana.
    assert.deepEqual(
      plan.ranuras.map((r) => r.programadoPara.toISOString()),
      ['2026-07-25T12:30:00.000Z', '2026-07-25T12:30:00.000Z'],
    );
  });
});

describe('los techos', () => {
  test('lleno el techo por hora, el siguiente espera a la hora que viene', () => {
    const acotada = { ...cfg, techoPorHora: 2 };
    const plan = programar(
      [candidato(1, 300), candidato(2, 200), candidato(3, 100)],
      acotada,
      MADRUGADA,
      azarFijo(0),
    );
    assert.deepEqual(
      plan.ranuras.map((r) => r.programadoPara.toISOString()),
      [
        '2026-07-25T12:30:00.000Z', // 07:30 Lima
        '2026-07-25T12:31:00.000Z', // 07:31 Lima — la hora 7 llegó a su techo
        '2026-07-25T13:00:00.000Z', // 08:00 Lima
      ],
    );
  });

  test('lo ya enviado esta hora también ocupa el techo', () => {
    const acotada = { ...cfg, techoPorHora: 2 };
    const plan = programar([candidato(1, 300), candidato(2, 200)], acotada, MADRUGADA, azarFijo(0), [
      { numeroPropio: '51986394450', cuando: new Date('2026-07-25T12:35:00Z') },
    ]);
    assert.deepEqual(
      plan.ranuras.map((r) => r.programadoPara.toISOString()),
      ['2026-07-25T12:30:00.000Z', '2026-07-25T13:00:00.000Z'],
    );
  });

  test('el techo diario posterga con motivo, no manda de más', () => {
    const acotada = { ...cfg, techoPorDia: 2 };
    const plan = programar(
      [candidato(1, 300), candidato(2, 200), candidato(3, 100)],
      acotada,
      MADRUGADA,
      azarFijo(0),
    );
    assert.equal(plan.ranuras.length, 2);
    assert.equal(plan.postergados.length, 1);
    assert.match(plan.postergados[0].motivo, /techo diario/);
  });

  test('lo que no entra en la ventana queda para la vendedora, con motivo', () => {
    // 60 candidatos con espaciado mínimo: la ventana 07:30–09:00 tiene 90 min,
    // pero los techos por hora (20) la cortan antes.
    const candidatos = Array.from({ length: 60 }, (_, i) => candidato(i, 600 - i));
    const plan = programar(candidatos, cfg, MADRUGADA, azarFijo(0));

    assert.equal(plan.ranuras.length, 40, '20 en la hora 7 + 20 en la hora 8');
    assert.equal(plan.postergados.length, 20);
    assert.match(plan.postergados[0].motivo, /ventana de despacho|vendedora/);
  });
});

describe('las ventanas efectivas', () => {
  test('con los defaults son dos: antes de abrir y después de cerrar', () => {
    assert.deepEqual(ventanasEfectivas(cfg), [
      { desde: 7 * 60 + 30, hasta: 9 * 60 },
      { desde: 20 * 60, hasta: 21 * 60 },
    ]);
  });

  test('si la franja laboral cubre toda la ventana de despacho, no hay dónde mandar', () => {
    const sinHueco = { ...cfg, franja: { desde: '07:00', hasta: '22:00' } };
    assert.deepEqual(ventanasEfectivas(sinHueco), []);
    const plan = programar([candidato(1, 300)], sinHueco, MADRUGADA, azarFijo(0));
    assert.equal(plan.ranuras.length, 0);
    assert.equal(plan.postergados.length, 1);
  });
});
