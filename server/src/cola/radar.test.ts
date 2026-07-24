import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ordenarRadar, type FilaRadar } from './radar.js';

/**
 * El orden del radar del Dashboard. Antes vivía en el front, dos veces y en
 * direcciones opuestas: la lista ordenaba del más nuevo al más viejo y el botón
 * «Atender a {nombre}» elegía al más VIEJO, así que la pantalla recomendaba a
 * alguien y lo escondía al fondo. Acá se decide una sola vez.
 */

const AHORA = new Date('2026-07-22T18:00:00Z');
const hDe = (n: number) => new Date(AHORA.getTime() - n * 60 * 60 * 1000).toISOString();
const dDe = (n: number) => new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const fila = (clave: string, over: Partial<FilaRadar> = {}): FilaRadar & { clave: string } => ({
  clave,
  tipo: 'mensaje',
  respondida: false,
  ventana_abierta: false,
  referencia: hDe(2),
  ...over,
});

describe('el orden del radar', () => {
  test('una conversación ya respondida se hunde debajo de las que esperan', () => {
    // El bug que este ticket arregla: el radar no sabía si la vendedora ya había
    // contestado, así que mezclaba gente atendida con gente esperando.
    const esperando = fila('espera', { referencia: dDe(3) });
    const yaAtendida = fila('atendida', { referencia: hDe(1), respondida: true });

    const orden = ordenarRadar([yaAtendida, esperando], AHORA).map((f) => f.clave);
    assert.deepEqual(orden, ['espera', 'atendida']);
  });

  test('cada fila sale con su nivel, para que el front no tenga que recalcularlo', () => {
    const vivo = fila('vivo', { referencia: hDe(1) });
    const silencio = fila('silencio', { referencia: hDe(1), respondida: true });

    const [primera, segunda] = ordenarRadar([silencio, vivo], AHORA);
    assert.equal(primera?.nivel, 0);
    assert.equal(segunda?.nivel, 4);
  });

  test('la primera fila es la que el titular tiene que recomendar', () => {
    // La contradicción vieja: dos criterios de orden en la misma pantalla. Ahora
    // hay uno solo, así que «lo primero de la lista» y «a quién atender» son por
    // definición la misma fila.
    const filas = [
      fila('comentario-viejo', { tipo: 'comentario', ventana_abierta: true, referencia: dDe(6) }),
      fila('espera-vieja', { referencia: dDe(4) }),
      fila('escribiendo-ahora', { referencia: hDe(0.2) }),
      fila('archivo', { tipo: 'comentario', referencia: hDe(3), respondida: true }),
    ];

    const orden = ordenarRadar(filas, AHORA).map((f) => f.clave);
    assert.deepEqual(orden, ['escribiendo-ahora', 'comentario-viejo', 'espera-vieja', 'archivo']);
  });

  test('las fechas llegan como texto ISO desde Postgres y se ordenan igual', () => {
    // Postgres devuelve timestamps como string. Compararlos sin convertir a Date
    // ordena alfabéticamente, que para ISO funciona de casualidad — hasta que
    // cambia el offset. Esto fija la conversión.
    const viejo = fila('viejo', { referencia: dDe(9) });
    const nuevo = fila('nuevo', { referencia: hDe(1) });

    const orden = ordenarRadar([viejo, nuevo], AHORA).map((f) => f.clave);
    assert.deepEqual(orden, ['nuevo', 'viejo']); // los dos son VIVO/ESPERA: gana el vivo
  });

  test('dos listas ordenadas por separado se mezclan bien con (nivel, orden)', () => {
    // El radar muestra conversaciones y leads de formulario en una sola pantalla.
    // Si el front tuviera que desempatar por su cuenta volvería el bug de los dos
    // criterios en paralelo; con la clave completa alcanza con ordenar por ella.
    const conversaciones = ordenarRadar(
      [fila('conv-vieja', { referencia: dDe(3) }), fila('conv-viva', { referencia: hDe(0.5) })],
      AHORA,
    );
    const formularios = ordenarRadar(
      [fila('lead-vivo', { referencia: hDe(1) }), fila('lead-viejo', { referencia: dDe(5) })],
      AHORA,
    );

    const mezclado = [...conversaciones, ...formularios]
      .sort((a, b) => a.nivel - b.nivel || a.orden - b.orden)
      .map((f) => f.clave);

    // Los dos vivos primero (el más reciente arriba), después las dos esperas
    // (la más vieja arriba).
    assert.deepEqual(mezclado, ['conv-viva', 'lead-vivo', 'lead-viejo', 'conv-vieja']);
  });

  test('no muta el arreglo que recibe', () => {
    const filas = [fila('b', { referencia: dDe(3) }), fila('a', { referencia: hDe(1) })];
    const copia = [...filas];
    ordenarRadar(filas, AHORA);
    assert.deepEqual(filas, copia);
  });
});

describe('el seguimiento agendado llega al ordenador (#38)', () => {
  test('una fila con seguimiento vencido sube a VENCIDO: debajo de lo vivo, arriba de lo demás', () => {
    // El bug de #38: el constructor de items no pasaba seguimiento_en, así que
    // VENCIDO no se disparaba nunca aunque la función pura lo supiera calcular.
    const vivo = fila('vivo', { referencia: hDe(1) });
    const vencida = fila('vencida', { referencia: dDe(4), seguimiento_en: dDe(1) });
    const expira = fila('expira', { tipo: 'comentario', ventana_abierta: true, referencia: dDe(5) });

    const orden = ordenarRadar([expira, vencida, vivo], AHORA);
    assert.deepEqual(orden.map((f) => f.clave), ['vivo', 'vencida', 'expira']);
    assert.equal(orden[1]?.nivel, 1);
  });

  test('el seguimiento llega como texto ISO desde Postgres, igual que referencia', () => {
    const conTexto = fila('iso', { referencia: dDe(4), seguimiento_en: hDe(2) });
    assert.equal(ordenarRadar([conTexto], AHORA)[0]?.nivel, 1);
  });

  test('sin seguimiento (null o ausente) nada cambia: la fila sigue su curso', () => {
    const sinCampo = fila('sin-campo', { referencia: dDe(3) });
    const conNull = fila('con-null', { referencia: dDe(3), seguimiento_en: null });
    assert.equal(ordenarRadar([sinCampo], AHORA)[0]?.nivel, 3);
    assert.equal(ordenarRadar([conNull], AHORA)[0]?.nivel, 3);
  });
});
