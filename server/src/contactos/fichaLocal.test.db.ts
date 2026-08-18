import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDePrueba } from '../pruebas/base.js';
import { consultarFicha, fichaDuplicada, guardarFicha } from './fichaLocal.js';

/**
 * LA FICHA RÁPIDA, CONTRA UNA POSTGRES DE VERDAD (ADR 0008).
 *
 * Lo que se fija acá es lo que ningún test puro puede ver: que registrar dos
 * veces la misma conversación ACTUALICE en vez de duplicar, que el teléfono se
 * guarde ya normalizado (si no, la detección de duplicados no puede funcionar
 * nunca) y que el duplicado se DETECTE mirando otra conversación, no la propia.
 */

const CLAVE = 'conv:whatsapp:51900000000:51955950559';
const OTRA = 'int:99123';

test('registrar dos veces la misma conversación actualiza, no duplica', async (t) => {
  const db = await baseDePrueba(t);

  await guardarFicha(db, {
    clave: CLAVE,
    telefono: '51955950559',
    nombre: 'Jorge',
    apellido: 'Martin',
    empresa: null,
    email: null,
    prioridad: null,
    vendedoraId: 'luz',
  });
  const segunda = await guardarFicha(db, {
    clave: CLAVE,
    telefono: '51955950559',
    nombre: 'Jorge',
    apellido: 'Martin',
    empresa: 'JM Rush Automotriz',
    email: 'jorge@jmrush.pe',
    prioridad: 'alta',
    // Quien COMPLETA no es necesariamente quien registró.
    vendedoraId: 'sindy',
  });

  assert.equal(segunda.empresa, 'JM Rush Automotriz');
  assert.equal(segunda.prioridad, 'alta');
  assert.equal(
    segunda.vendedoraId,
    'luz',
    'vendedora_id dice quién la REGISTRÓ; actualizar un dato no cambia de dueña',
  );

  const leida = await consultarFicha(db, CLAVE);
  assert.equal(leida?.email, 'jorge@jmrush.pe');
});

test('el teléfono se guarda NORMALIZADO — si no, el duplicado no se puede detectar', async (t) => {
  const db = await baseDePrueba(t);

  // Código de país cargado dos veces: la grafía que `normalizarE164` arregla.
  const fila = await guardarFicha(db, {
    clave: CLAVE,
    telefono: '+51 51 955 950 559',
    nombre: 'Jorge',
    apellido: null,
    empresa: null,
    email: null,
    prioridad: null,
    vendedoraId: 'luz',
  });

  assert.equal(fila.telefono, '51955950559');
});

test('el duplicado mira las OTRAS conversaciones, nunca la propia', async (t) => {
  const db = await baseDePrueba(t);

  await guardarFicha(db, {
    clave: CLAVE,
    telefono: '51955950559',
    nombre: 'Jorge',
    apellido: null,
    empresa: null,
    email: 'JORGE@jmrush.pe',
    prioridad: null,
    vendedoraId: 'luz',
  });

  assert.equal(
    await fichaDuplicada(db, { clave: CLAVE, telefono: '51955950559', email: null }),
    null,
    'actualizar la ficha propia no puede leerse como duplicado, o no se podría editar nunca',
  );

  const porTelefono = await fichaDuplicada(db, { clave: OTRA, telefono: '+51 955 950 559', email: null });
  assert.equal(porTelefono?.clave, CLAVE, 'el mismo número escrito distinto sigue siendo la misma persona');

  const porCorreo = await fichaDuplicada(db, { clave: OTRA, telefono: null, email: 'jorge@JMRUSH.pe' });
  assert.equal(porCorreo?.clave, CLAVE, 'el correo no distingue mayúsculas');

  assert.equal(
    await fichaDuplicada(db, { clave: OTRA, telefono: null, email: null }),
    null,
    'sin teléfono ni correo no hay con qué comparar: eso no es «no hay duplicado», es «no se preguntó»',
  );
});
