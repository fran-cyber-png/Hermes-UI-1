import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORES_CATEGORIA, colorCategoria, esColorCategoria, normalizarNombre } from './paleta.js';

test('el enum de color acepta la paleta y rechaza oro y desconocidos', () => {
  assert.equal(colorCategoria.safeParse('azul').success, true);
  assert.equal(colorCategoria.safeParse('pizarra').success, true);
  // El oro por cualquiera de sus nombres, y cualquier basura, no pasan.
  for (const malo of ['gold', 'dorado', 'amarillo', 'oro', 'amber', '', 'AZUL', 'inexistente']) {
    assert.equal(colorCategoria.safeParse(malo).success, false, `«${malo}» no debería validar`);
  }
});

test('esColorCategoria es un type guard fiel a la paleta', () => {
  assert.equal(esColorCategoria('morado'), true);
  assert.equal(esColorCategoria('gold'), false);
  assert.equal(esColorCategoria(42), false);
  assert.equal(esColorCategoria(null), false);
});

test('la paleta no contiene ningún token de oro, ámbar ni amarillo', () => {
  const prohibidos = ['gold', 'oro', 'dorado', 'amarillo', 'ambar', 'ámbar', 'amber', 'yellow'];
  for (const c of COLORES_CATEGORIA) {
    assert.ok(!prohibidos.includes(c), `«${c}» huele a oro y el oro está prohibido en la paleta`);
  }
  assert.equal(COLORES_CATEGORIA.length, 8, 'ocho colores, ninguno oro');
});

test('normalizarNombre recorta, baja a minúsculas y capa a 30', () => {
  assert.equal(normalizarNombre('  Interesada  '), 'interesada');
  assert.equal(normalizarNombre('PRECIO'), 'precio');
  assert.equal(normalizarNombre('x'.repeat(40)).length, 30);
  assert.equal(normalizarNombre('   '), '');
});
