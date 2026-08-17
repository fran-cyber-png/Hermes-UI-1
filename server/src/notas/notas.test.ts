import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITE_TEXTO, prepararEdicion, validarDiagrama, validarTexto } from './notas.js';

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

/**
 * DIAGRAMAS DE REACT FLOW (17-ago-2026) — validación mínima: un objeto con
 * `nodes`/`edges` como arrays. No se interpreta la forma de cada nodo, eso es
 * contrato del cliente.
 */

test('validarDiagrama rechaza lo que no sea un objeto', () => {
  assert.equal(validarDiagrama(null).ok, false);
  assert.equal(validarDiagrama(undefined).ok, false);
  assert.equal(validarDiagrama('un diagrama').ok, false);
  assert.equal(validarDiagrama([1, 2, 3]).ok, false);
});

test('validarDiagrama acepta {} — un diagrama recién abierto, sin tocar', () => {
  const r = validarDiagrama({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.diagrama, { nodes: [], edges: [] });
});

test('validarDiagrama rechaza nodes/edges que no sean arrays', () => {
  assert.equal(validarDiagrama({ nodes: 'x' }).ok, false);
  assert.equal(validarDiagrama({ edges: {} }).ok, false);
});

test('validarDiagrama conserva nodes/edges tal cual, sin interpretarlos', () => {
  const nodes = [{ id: '1', position: { x: 0, y: 0 }, data: { label: 'Inicio' } }];
  const edges = [{ id: 'e1-2', source: '1', target: '2' }];
  const r = validarDiagrama({ nodes, edges });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.diagrama, { nodes, edges });
});

test('prepararEdicion acepta SOLO diagrama — una página de diagrama nunca manda texto/doc', () => {
  const ahora = new Date('2026-08-17T10:00:00Z');
  const r = prepararEdicion({ diagrama: { nodes: [], edges: [] } }, ahora);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.cambios.texto, undefined);
  assert.deepEqual(r.ok && r.cambios.diagrama, { nodes: [], edges: [] });
  assert.equal(r.ok && r.cambios.editadoAt, ahora);
});

test('prepararEdicion propaga el rechazo de un diagrama con forma inválida', () => {
  const r = prepararEdicion({ diagrama: { nodes: 'no es un array' } }, new Date());
  assert.equal(r.ok, false);
});
