import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITE_TEXTO, prepararEdicion, validarTexto } from './notas.js';

/**
 * Puro, sin IO: la validación de texto (#47) y la regla `editado_at` — nace
 * null, cualquier PATCH la setea. El reloj entra por parámetro (como
 * `cola/urgencia.ts`) para no depender del reloj real.
 */

test('validarTexto rechaza vacío (y solo espacios)', () => {
  assert.equal(validarTexto('').ok, false);
  assert.equal(validarTexto('   ').ok, false);
  assert.equal(validarTexto(undefined).ok, false);
  assert.equal(validarTexto(null).ok, false);
});

test('validarTexto hace trim antes de aceptar', () => {
  const r = validarTexto('  le interesa el diplomado  ');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.texto, 'le interesa el diplomado');
});

test('validarTexto rechaza más de 2.000 caracteres tras el trim', () => {
  const largo = 'a'.repeat(LIMITE_TEXTO + 1);
  assert.equal(validarTexto(largo).ok, false);
  assert.equal(validarTexto(`  ${'a'.repeat(LIMITE_TEXTO)}  `).ok, true, 'exactos 2.000 tras el trim sí entra');
});

test('validarTexto SÍ acepta emojis — la regla latin1 de Cerberus no aplica acá', () => {
  const r = validarTexto('paga el viernes 📅💰');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.texto, 'paga el viernes 📅💰');
});

test('prepararEdicion setea editadoAt aunque solo cambie fijada', () => {
  const ahora = new Date('2026-07-23T10:00:00Z');
  const r = prepararEdicion({ fijada: true }, ahora);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.editadoAt, ahora);
  assert.equal(r.ok && r.cambios.fijada, true);
  assert.equal(r.ok && r.cambios.texto, undefined);
});

test('prepararEdicion valida el texto nuevo si viene', () => {
  const r = prepararEdicion({ texto: '   ' }, new Date());
  assert.equal(r.ok, false);
});

test('prepararEdicion rechaza un PATCH vacío (ni texto ni fijada)', () => {
  const r = prepararEdicion({}, new Date());
  assert.equal(r.ok, false);
});

test('prepararEdicion acepta texto y fijada juntos, con el mismo editadoAt', () => {
  const ahora = new Date('2026-07-23T11:30:00Z');
  const r = prepararEdicion({ texto: 'nuevo texto', fijada: false }, ahora);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.texto, 'nuevo texto');
  assert.equal(r.ok && r.cambios.fijada, false);
  assert.equal(r.ok && r.cambios.editadoAt, ahora);
});
