import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { repartirAprobadas, type ParaAprobar } from './aprobar.js';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';

/**
 * APROBAR EN LOTE SIN QUE SALGA UN LOTE (#125 · ADR 0016).
 *
 * Es la parte que hace que la bandeja sea segura: la vendedora hace UN click
 * sobre 40 mensajes y esos 40 NO salen juntos. Se reparten con el mismo ritmo de
 * siempre —uno por vez, 60–240 s de aire, techos de 20/h y 60/día por número—,
 * calculado por la MISMA función que usa el encolado automático
 * (`programar.ts`). Si acá hubiera un segundo repartidor, el lote aprobado
 * tendría una firma de tráfico distinta a la del modo automático, que es
 * exactamente lo que no se puede permitir.
 *
 * Referencias (Lima = UTC-5):
 *   13:00Z → 08:00 Lima (la vendedora llega y abre la bandeja)
 *   14:05Z → 09:05 Lima (ya empezó su turno)
 *   03:00Z → 22:00 Lima (cerrada la ventana de despacho)
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

/** Azar fijo: el espaciado siempre en el medio del rango (150 s) — el plan es reproducible. */
const azarMedio = () => 0.5;

const LAS_OCHO = new Date('2026-07-25T13:00:00Z');

function lote(n: number, over: Partial<ParaAprobar> = {}): ParaAprobar[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    clave: `conv:whatsapp:5196150${String(i).padStart(4, '0')}:51986394450`,
    telefono: `5196150${String(i).padStart(4, '0')}`,
    numeroPropio: '51986394450',
    personaNombre: `Persona ${i}`,
    plantillaId: 'fuera-de-horario-primer-contacto',
    texto: 'Hola, gracias por escribirnos.',
    // Escribieron escalonados durante la noche; el primero es el que más esperó.
    disparadaPor: new Date(Date.parse('2026-07-25T05:00:00Z') + i * 60_000),
    ...over,
  }));
}

describe('el lote se reparte, no se dispara', () => {
  test('cinco aprobadas salen espaciadas, no todas a la vez', () => {
    const r = repartirAprobadas(lote(5), cfg, LAS_OCHO, azarMedio);
    assert.equal(r.aprobadas.length, 5);
    assert.equal(r.noEntran.length, 0);

    const horas = r.aprobadas.map((a) => a.programadoPara.getTime()).sort((a, b) => a - b);
    assert.equal(horas[0], LAS_OCHO.getTime(), 'la primera sale ya');
    for (let i = 1; i < horas.length; i++) {
      const aire = (horas[i] - horas[i - 1]) / 1000;
      assert.ok(aire >= cfg.espaciadoSegundos[0], `entre la ${i} y la ${i + 1} hay ${aire}s, menos que el mínimo`);
      assert.ok(aire <= cfg.espaciadoSegundos[1], `entre la ${i} y la ${i + 1} hay ${aire}s, más que el máximo`);
    }
  });

  test('el que más esperó, primero', () => {
    const revuelto = [...lote(3)].reverse();
    const r = repartirAprobadas(revuelto, cfg, LAS_OCHO, azarMedio);
    const enOrden = [...r.aprobadas].sort((a, b) => a.programadoPara.getTime() - b.programadoPara.getTime());
    assert.deepEqual(
      enOrden.map((a) => a.id),
      [1, 2, 3],
    );
  });

  test('el techo por hora corta el lote: lo que no entra se dice, no se aprieta', () => {
    const r = repartirAprobadas(lote(25), cfg, LAS_OCHO, azarMedio);
    const enLaHoraOcho = r.aprobadas.filter((a) => a.programadoPara.getTime() < Date.parse('2026-07-25T14:00:00Z'));
    assert.equal(enLaHoraOcho.length, cfg.techoPorHora, 'no entra ninguna de más en la hora');
    assert.equal(r.aprobadas.length, 25, 'las otras cinco pasan a la hora siguiente');
  });

  test('lo que ya está reservado cuenta contra el techo', () => {
    const ocupadas = Array.from({ length: cfg.techoPorHora }, () => ({
      numeroPropio: '51986394450',
      cuando: new Date('2026-07-25T13:30:00Z'),
    }));
    const r = repartirAprobadas(lote(1), cfg, LAS_OCHO, azarMedio, ocupadas);
    assert.equal(r.aprobadas.length, 1);
    assert.ok(
      r.aprobadas[0].programadoPara.getTime() >= Date.parse('2026-07-25T14:00:00Z'),
      'la hora de las 8 ya estaba llena: la empuja a las 9',
    );
  });

  test('pasado el techo diario, no se aprueba: se explica por qué', () => {
    const lleno = Array.from({ length: cfg.techoPorDia }, () => ({
      numeroPropio: '51986394450',
      cuando: new Date('2026-07-25T13:30:00Z'),
    }));
    const r = repartirAprobadas(lote(1), cfg, LAS_OCHO, azarMedio, lleno);
    assert.equal(r.aprobadas.length, 0);
    assert.equal(r.noEntran.length, 1);
    assert.match(r.noEntran[0].motivo, /techo diario/);
  });
});

describe('dos preparadas de la misma conversación no se pisan', () => {
  test('cada fila recibe SU hora, aunque compartan clave', () => {
    // Pasa un instante real: la de anoche que el barrido todavía no caducó y la
    // de esta madrugada. Con un mapa por clave, una se aprobaría dos veces y la
    // otra quedaría colgada para siempre.
    const [a] = lote(1);
    const b: ParaAprobar = { ...a, id: 99, disparadaPor: new Date(a.disparadaPor.getTime() + 60_000) };
    const r = repartirAprobadas([a, b], cfg, LAS_OCHO, azarMedio);

    assert.deepEqual(
      r.aprobadas.map((x) => x.id).sort((x, y) => x - y),
      [1, 99],
    );
    assert.notEqual(
      r.aprobadas[0].programadoPara.getTime(),
      r.aprobadas[1].programadoPara.getTime(),
      'y las dos horas son distintas: el espaciado también vale acá',
    );
  });
});

describe('aprobar es una acción humana: el horario de la vendedora no la bloquea', () => {
  test('aprobar a las 9:05, ya en su turno, PROGRAMA igual', () => {
    // La ventana automática (07:30–09:00 y 20:00–21:00) existe para que la
    // máquina no hable cuando está la vendedora. Si la que decide es ella, esa
    // razón no aplica: lo que aprueba a las 9:05 sale a las 9:05.
    const r = repartirAprobadas(lote(3), cfg, new Date('2026-07-25T14:05:00Z'), azarMedio);
    assert.equal(r.aprobadas.length, 3);
    assert.equal(r.aprobadas[0].programadoPara.toISOString(), '2026-07-25T14:05:00.000Z');
  });

  test('pero a las 10 de la noche no: fuera de la hora creíble no sale nada', () => {
    const r = repartirAprobadas(lote(2), cfg, new Date('2026-07-26T03:00:00Z'), azarMedio);
    assert.equal(r.aprobadas.length, 0);
    assert.equal(r.noEntran.length, 2);
    assert.match(r.noEntran[0].motivo, /07:30–21:00|hora/);
  });
});
