import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDePrueba } from '../pruebas/base.js';
import { editarMensaje } from './editar.js';
import { edicionesPorMensaje } from './repositorio.js';
import { TransporteFalso } from '../whatsapp/transporteFalso.js';

/**
 * EL CAMINO FELIZ, CONTRA BASE REAL: `editarMensaje` no solo autoriza — deja
 * escrita la edición, y `edicionesPorMensaje` (lo que lee el hilo) la
 * encuentra. Las guardas que cortan ANTES de tocar la base están en
 * `editar.test.ts`, sin base.
 */

test('editar dos veces REEMPLAZA — es un estado, no un historial', async (t) => {
  const db = await baseDePrueba(t);
  const transporte = new TransporteFalso({ telefono: '51987654321' });

  const orden = { numeroPropio: '51987654321', telefono: '51900000000', mensajeId: 'ABC123', textoNuevo: 'perdón, era 350' };
  const r1 = await editarMensaje(db, transporte, orden);
  assert.deepEqual(r1, { ok: true });
  assert.deepEqual(transporte.editados, [{ telefono: '51900000000', mensajeId: 'ABC123', texto: 'perdón, era 350' }]);

  const r2 = await editarMensaje(db, transporte, { ...orden, textoNuevo: 'perdón, era 300' });
  assert.deepEqual(r2, { ok: true });

  const mapa = await edicionesPorMensaje(db, ['wa:ABC123']);
  assert.equal(mapa.size, 1, 'una sola fila — reemplaza, no acumula');
  assert.equal(mapa.get('wa:ABC123')?.texto, 'perdón, era 300');
});

test('sin ediciones, el mapa de `edicionesPorMensaje` viene vacío para ese mensaje', async (t) => {
  const db = await baseDePrueba(t);
  const mapa = await edicionesPorMensaje(db, ['wa:NUNCA-EDITADO']);
  assert.equal(mapa.has('wa:NUNCA-EDITADO'), false);
});
