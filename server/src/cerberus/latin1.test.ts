import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aLatin1, cuerpoParaCerberus } from './latin1.js';

/**
 * LA REGLA DURA #4 (#108) — lo que sale hacia Cerberus entra en su MySQL latin1.
 *
 * Los dos lados de la regla, que es lo que más se malinterpreta: **los acentos
 * pasan** (á é í ó ú ñ ü ¿ ¡ son latin1) y **los emojis no** (revientan el
 * INSERT de una venta, con el cliente esperando).
 *
 * El espejo de este archivo es `notas/notas.test.ts`, donde el mismo emoji SÍ se
 * acepta: una nota personal nunca viaja a Cerberus.
 */

test('los acentos, la eñe y los signos españoles pasan intactos — son latin1', () => {
  assert.equal(aLatin1('José Muñoz'), 'José Muñoz');
  assert.equal(aLatin1('¿Cuánto sale la Maestría?'), '¿Cuánto sale la Maestría?');
  assert.equal(aLatin1('Über, año, ñandú, ¡ojo!'), 'Über, año, ñandú, ¡ojo!');
});

test('la eñe descompuesta (NFD) sobrevive como eñe, no como ene pelada', () => {
  // «Muñoz» tecleado en un iPhone puede llegar como n + tilde combinante
  // (U+0303). Esa tilde suelta NO es latin1: sin normalizar a NFC primero, la
  // borraríamos y el apellido saldría «Munoz» — justo el daño que la regla evita.
  // Escrito con el escape a proposito: como glifo es indistinguible de la ene
  // normal, y cualquier formateador que normalizara el archivo dejaria un test
  // que ya no prueba lo que dice probar.
  const descompuesto = 'Mun\u0303oz';
  assert.notEqual(descompuesto, 'Muñoz'); // de verdad viene descompuesto
  assert.equal(aLatin1(descompuesto), 'Muñoz');
});

test('el emoji se va y no deja el espacio colgando', () => {
  // Nombres reales de la cola de hoy: la gente se pone emojis en el pushName de
  // WhatsApp, y ese nombre es candidato natural a viajar a Cerberus.
  assert.equal(aLatin1('Geraldine😊'), 'Geraldine');
  assert.equal(aLatin1('Jhonatan 🍭'), 'Jhonatan');
  assert.equal(aLatin1('Ana 🎉 María'), 'Ana María');
});

test('lo que se puede traducir se traduce, en vez de mutilar la frase', () => {
  // Word y los teclados de celular meten estos solos. Borrarlos dejaría
  // «Pagó  falta cuota»: se entiende peor que con el guion y los tres puntos.
  assert.equal(aLatin1('Pagó — falta cuota…'), 'Pagó - falta cuota...');
  assert.equal(aLatin1('el curso “IA”'), 'el curso "IA"');
  assert.equal(aLatin1('d’Angelo'), "d'Angelo");
  assert.equal(aLatin1('€150'), 'EUR150');
});

test('«» y el espacio duro NO se tocan: ya son latin1', () => {
  // Traducir lo que el charset acepta sería perder información sin necesidad.
  assert.equal(aLatin1('el curso «IA»'), 'el curso «IA»');
  assert.equal(aLatin1('S/ 150'), 'S/ 150');
});

test('un texto que era solo emojis queda vacío — el helper no inventa nada', () => {
  // Devolver un placeholder sería inventar. Quien llama decide qué hacer con el
  // hueco; misma doctrina que `lazo/normalizar.ts`.
  assert.equal(aLatin1('😊😊😊'), '');
});

test('el mismo emoji que `notas.ts` SÍ acepta, acá se limpia', () => {
  // El contrapunto exacto de `notas/notas.test.ts`: allá el fixture entra tal
  // cual porque una nota nunca sale de Hermes; acá va a un INSERT de Cerberus.
  assert.equal(aLatin1('paga el viernes 📅💰'), 'paga el viernes');
});

test('cuerpoParaCerberus sanea TODOS los campos, no solo los que uno se acuerda', () => {
  // La razón de ser del helper: el campo que alguien agregue mañana nace cubierto.
  const cuerpo = cuerpoParaCerberus({
    cliente: '4821',
    observacion: 'pagó la 1ra 🎉',
    campo_que_alguien_agregue_manana: 'Muñoz 😊',
  });

  assert.equal(cuerpo.get('cliente'), '4821');
  assert.equal(cuerpo.get('observacion'), 'pagó la 1ra');
  assert.equal(cuerpo.get('campo_que_alguien_agregue_manana'), 'Muñoz');
});

test('venta_request_key sale limpio aunque el username traiga un emoji', () => {
  // Es el ÚNICO texto de origen humano que hoy entra al INSERT de Cerberus
  // (`venta.ts`: `hermes-${vendedoraId}-${Date.now()}`).
  const cuerpo = cuerpoParaCerberus({ venta_request_key: 'hermes-luz😊-1784992483775' });
  assert.equal(cuerpo.get('venta_request_key'), 'hermes-luz-1784992483775');
});
