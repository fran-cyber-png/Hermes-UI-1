import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';
import { decidir, type ConversacionCandidata } from './decidir.js';

/**
 * LA ELEGIBILIDAD, con el reloj inyectado. Cada test fija UNA condición del
 * contrato (issues #125 y #166) y su borde: el minuto 29 contra el 30, las 8:59
 * contra las 9:00, la segunda del día, el que dijo que no.
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

/**
 * LOS TRES DEFECTOS DE #166, sobre los datos que los descubrieron.
 *
 * El 27-jul a las 01:03 se prendió en supervisada y se prepararon 40 borradores.
 * Ninguno salió, y al revisarlos con el dueño se vio que 25 eran de gente que
 * había escrito EN horario, que las esperas iban de 57 a 72 horas, y que uno era
 * para una conversación que la persona ya había cerrado. Cada test de acá abajo
 * es uno de esos borradores, con su hora y su texto.
 */
describe('los borradores del 27-jul que no tenían que existir (#166)', () => {
  /** 01:03 de Lima: el minuto exacto en que se prendió y se prepararon las 40. */
  const CUANDO_SE_PRENDIO = new Date('2026-07-27T06:03:00Z');

  test('escribió a las 10:47 de la mañana: no le corresponde un acuse de fuera de horario', () => {
    const d = decidir(
      // 26-jul 10:47 de Lima. Con la franja evaluada sobre el reloj, a la 1 AM
      // esta conversación calificaba: 25 de las 40 eran así.
      candidata({ ultimoEntranteEn: new Date('2026-07-26T15:47:00Z') }),
      cfg,
      CUANDO_SE_PRENDIO,
    );
    assert.equal(d.elegible === false && d.motivo, 'escribio_en_horario');
    assert.ok(d.elegible === false && d.detalle.includes('10:47'), d.elegible === false ? d.detalle : '');
  });

  test('el borde de la franja, del lado del MENSAJE: 08:59 sí, 09:00 no', () => {
    // Reloj a las 20:30 de Lima: ya cerró (la franja termina 20:00) y las dos
    // esperas caben abajo del techo de 12 h, así que lo único que las separa es
    // el minuto en que escribió cada una.
    const alas2030 = new Date('2026-07-26T01:30:00Z');

    const aLas0859 = decidir(candidata({ ultimoEntranteEn: new Date('2026-07-25T13:59:00Z') }), cfg, alas2030);
    assert.equal(aLas0859.elegible, true, 'escribió un minuto antes de que abriéramos');

    const aLas0900 = decidir(candidata({ ultimoEntranteEn: new Date('2026-07-25T14:00:00Z') }), cfg, alas2030);
    assert.equal(aLas0900.elegible === false && aLas0900.motivo, 'escribio_en_horario');
  });

  test('esperó 70 horas: un «gracias por escribirnos» a los tres días es peor que el silencio', () => {
    const d = decidir(
      // 24-jul 03:00 de Lima — madrugada, o sea que la franja la deja pasar.
      candidata({ ultimoEntranteEn: new Date('2026-07-24T08:00:00Z') }),
      cfg,
      CUANDO_SE_PRENDIO,
    );
    assert.equal(d.elegible === false && d.motivo, 'espera_excesiva');
    assert.ok(d.elegible === false && d.detalle.includes('70 h'), d.elegible === false ? d.detalle : '');
  });

  test('el techo se mueve con la config: lo mismo entra o no según AUTO_RESPUESTA_MAX_ESPERA_H', () => {
    const escribio = new Date('2026-07-27T06:00:00Z'); // 01:00 de Lima
    const alas21 = new Date('2026-07-28T02:00:00Z'); // 21:00 de Lima: 20 h esperando

    const conTechoAmplio = decidir(candidata({ ultimoEntranteEn: escribio }), { ...cfg, maxEsperaHoras: 24 }, alas21);
    assert.equal(conTechoAmplio.elegible, true, 'con el techo en 24 h, 20 h de espera todavía entra');

    const conTechoDefault = decidir(candidata({ ultimoEntranteEn: escribio }), cfg, alas21);
    assert.equal(conTechoDefault.elegible === false && conTechoDefault.motivo, 'espera_excesiva');
  });

  /**
   * El caso de la abogada (Morita, 22/36 en el issue). El hilo textual:
   *   10:01 nosotros → seguimiento del Foro de Estado
   *   10:45 ella     → «Hola, ya revise toda la información»
   *   10:46 ella     → «Soy abogada, y no me es de mucha utilidad»
   *   10:47 nosotros → «Entiendo»
   *   10:47 ella     → «Agradezco mucho la atención prestada»
   * El sistema le preparó «gracias por escribirnos, tu consulta quedó
   * registrada». Los textos llegan del más reciente al más viejo (`candidatos.ts`).
   */
  test('la que ya se despidió no tiene una consulta esperando respuesta', () => {
    const d = decidir(
      candidata({
        salientes: 2,
        ultimoEntranteEn: new Date('2026-07-27T04:00:00Z'), // 23:00 Lima
        textosDelCliente: [
          'Agradezco mucho la atención prestada',
          'Soy abogada, y no me es de mucha utilidad',
          'Hola, ya revise toda la información',
        ],
      }),
      cfg,
      CUANDO_SE_PRENDIO,
    );
    assert.equal(d.elegible === false && d.motivo, 'conversacion_cerrada');
  });

  test('el no con motivo frena aunque no haya despedida', () => {
    const d = decidir(
      candidata({
        salientes: 2,
        ultimoEntranteEn: new Date('2026-07-27T04:00:00Z'),
        textosDelCliente: ['Soy abogada, y no me es de mucha utilidad', 'Hola, ya revise toda la información'],
      }),
      cfg,
      CUANDO_SE_PRENDIO,
    );
    assert.equal(d.elegible === false && d.motivo, 'rechazo');
  });

  test('un «gracias» suelto no cierra nada: esa persona sigue esperando', () => {
    const d = decidir(
      candidata({
        salientes: 2,
        ultimoEntranteEn: new Date('2026-07-27T04:00:00Z'),
        textosDelCliente: ['gracias', 'me pasas el temario?'],
      }),
      cfg,
      CUANDO_SE_PRENDIO,
    );
    assert.equal(d.elegible, true);
  });

  test('sin un solo saliente no hubo atención que cerrar', () => {
    // Nadie le escribió nunca: no se le puede agradecer una atención que no
    // hubo, así que la despedida no aplica y el acuse sí.
    const d = decidir(
      candidata({
        salientes: 0,
        ultimoEntranteEn: new Date('2026-07-27T04:00:00Z'),
        textosDelCliente: ['gracias por todo'],
      }),
      cfg,
      CUANDO_SE_PRENDIO,
    );
    assert.equal(d.elegible, true);
  });
});
