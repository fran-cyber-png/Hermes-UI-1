import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';
import { decidir, type ConversacionCandidata } from './decidir.js';

/**
 * LA ELEGIBILIDAD, con el reloj inyectado. Cada test fija UNA de las cinco
 * condiciones del contrato (issue #125) y su borde: el minuto 29 contra el 30,
 * las 8:59 contra las 9:00, la segunda del día, el que dijo que no.
 *
 * Referencias horarias (Lima = UTC-5):
 *   02:00Z → 21:00 Lima (fuera de horario)
 *   08:00Z → 03:00 Lima (madrugada)
 *   14:00Z → 09:00 Lima (abre la vendedora)
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

const MADRUGADA = new Date('2026-07-25T08:00:00Z'); // 03:00 de Lima

const candidata = (over: Partial<ConversacionCandidata> = {}): ConversacionCandidata => ({
  clave: 'conv:whatsapp:51961506674:51986394450',
  telefono: '51961506674',
  numeroPropio: '51986394450',
  personaNombre: 'Ana',
  // Escribió a las 02:00 de Lima: una hora esperando.
  ultimoEntranteEn: new Date('2026-07-25T07:00:00Z'),
  ultimoSalienteEn: null,
  textosDelCliente: ['hola, quiero información del diplomado'],
  autoRespuestasHoy: 0,
  salientes: 0,
  curso: null,
  ...over,
});

describe('la auto-respuesta corresponde', () => {
  test('fuera de horario, con una hora esperando y sin respuesta: elegible', () => {
    const d = decidir(candidata(), cfg, MADRUGADA);
    assert.equal(d.elegible, true);
    assert.ok(d.elegible && !/autom[áa]tic/i.test(d.texto), 'el texto NO se delata como máquina (#166)');
    assert.ok(d.elegible && d.texto.startsWith('Hola Ana'), 'saluda por su nombre');
    assert.equal(d.elegible && d.plantillaId, 'fuera-de-horario-primer-contacto');
  });

  test('si reconozco la campaña, se responde LO DE ESA campaña (ADR 0016)', () => {
    const d = decidir(candidata({ curso: 'Diplomado en Gestión Pública' }), cfg, MADRUGADA);
    assert.equal(d.elegible, true);
    assert.equal(d.elegible && d.plantillaId, 'fuera-de-horario-campana');
    assert.ok(d.elegible && d.texto.includes('Diplomado en Gestión Pública'), 'la nombra como está escrita');
    assert.ok(d.elegible && d.texto.includes('temario de gestión pública'), 'y promete lo de esa familia');
    assert.equal(d.elegible && d.campana?.familia?.id, 'gestion-publica');
  });

  test('si vino de «[JUL] INTELIGENCIA», responde lo de Inteligencia', () => {
    const d = decidir(candidata({ curso: null, cursoAnuncio: '[JUL] INTELIGENCIA' }), cfg, MADRUGADA);
    assert.equal(d.elegible && d.plantillaId, 'fuera-de-horario-campana');
    assert.ok(d.elegible && d.texto.includes('Inteligencia y Contrainteligencia'), 'y no le grita «[JUL] INTELIGENCIA»');
    assert.equal(d.elegible && d.campana?.fuente, 'anuncio');
  });

  test('un curso que NO reconozco cae en la genérica, que igual lo nombra', () => {
    const d = decidir(candidata({ curso: 'Taller de oratoria' }), cfg, MADRUGADA);
    assert.equal(d.elegible && d.plantillaId, 'fuera-de-horario-interes');
    assert.ok(d.elegible && d.texto.includes('Taller de oratoria'));
    assert.equal(d.elegible && d.campana?.familia, null, 'no se inventa una familia');
  });

  test('el interés asentado le gana al anuncio: es lo que dijo, no de dónde vino', () => {
    const d = decidir(
      candidata({ curso: 'OSINT & SOCMINT', cursoAnuncio: '[JUL] INTELIGENCIA' }),
      cfg,
      MADRUGADA,
    );
    assert.equal(d.elegible && d.campana?.familia?.id, 'osint');
  });

  test('si ya veníamos hablando, la plantilla es la de seguimiento', () => {
    const d = decidir(candidata({ salientes: 3 }), cfg, MADRUGADA);
    assert.equal(d.elegible && d.plantillaId, 'fuera-de-horario-seguimiento');
  });

  test('sin nombre usable (WhatsApp devuelve el teléfono), saluda sin nombre', () => {
    const d = decidir(candidata({ personaNombre: '51961506674' }), cfg, MADRUGADA);
    assert.ok(d.elegible && d.texto.startsWith('Hola, gracias'), d.elegible ? d.texto : '');
  });
});

describe('la auto-respuesta NO corresponde', () => {
  test('apagada: no hay decisión que tomar', () => {
    const d = decidir(candidata(), { ...cfg, habilitada: false }, MADRUGADA);
    assert.equal(d.elegible, false);
    assert.equal(d.elegible === false && d.motivo, 'apagada');
  });

  test('dentro del horario de la vendedora, jamás — ella responde en 10 minutos', () => {
    const nueveDeLaManiana = new Date('2026-07-25T14:00:00Z');
    const d = decidir(candidata({ ultimoEntranteEn: new Date('2026-07-25T13:00:00Z') }), cfg, nueveDeLaManiana);
    assert.equal(d.elegible === false && d.motivo, 'en_horario');
  });

  test('a las 08:59 de Lima todavía es fuera de horario: sí corresponde', () => {
    const casiNueve = new Date('2026-07-25T13:59:00Z');
    const d = decidir(candidata({ ultimoEntranteEn: new Date('2026-07-25T12:00:00Z') }), cfg, casiNueve);
    assert.equal(d.elegible, true);
  });

  test('si la vendedora ya respondió después del último mensaje, no', () => {
    const d = decidir(
      candidata({ ultimoSalienteEn: new Date('2026-07-25T07:30:00Z') }),
      cfg,
      MADRUGADA,
    );
    assert.equal(d.elegible === false && d.motivo, 'ya_respondida');
  });

  test('a los 29 minutos todavía no; a los 30, sí', () => {
    const entrante = new Date('2026-07-25T08:00:00Z');
    const a29 = new Date('2026-07-25T08:29:00Z');
    const a30 = new Date('2026-07-25T08:30:00Z');

    const antes = decidir(candidata({ ultimoEntranteEn: entrante }), cfg, a29);
    assert.equal(antes.elegible === false && antes.motivo, 'espera_insuficiente');

    const despues = decidir(candidata({ ultimoEntranteEn: entrante }), cfg, a30);
    assert.equal(despues.elegible, true);
  });

  test('una por conversación por día: la segunda no sale', () => {
    const d = decidir(candidata({ autoRespuestasHoy: 1 }), cfg, MADRUGADA);
    assert.equal(d.elegible === false && d.motivo, 'ya_recibio_hoy');
  });

  test('a quien dijo «no me interesa» no se le escribe nunca más', () => {
    const d = decidir(
      candidata({ textosDelCliente: ['cuánto cuesta?', 'no me interesa, gracias'] }),
      cfg,
      MADRUGADA,
    );
    assert.equal(d.elegible === false && d.motivo, 'rechazo');
  });

  test('sin plantilla aplicable no se inventa texto: no sale nada', () => {
    const d = decidir(candidata(), cfg, MADRUGADA, []);
    assert.equal(d.elegible === false && d.motivo, 'sin_plantilla');
  });

  test('una plantilla con un marcador sin valor no manda un mensaje a medias', () => {
    const rota = [
      {
        id: 'rota',
        titulo: 'pide un curso que no hay',
        cuerpo: '{{saludo}}, sobre {{curso}}…',
        aplica: () => true,
      },
    ];
    const d = decidir(candidata({ curso: null }), cfg, MADRUGADA, rota);
    assert.equal(d.elegible === false && d.motivo, 'sin_plantilla');
  });
});
