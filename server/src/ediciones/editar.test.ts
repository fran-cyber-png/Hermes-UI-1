import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { motivoParaNoEditar, editarMensaje } from './editar.js';
import { TransporteFalso } from '../whatsapp/transporteFalso.js';

/**
 * LAS GUARDAS DE `editarMensaje` — todas las que se pueden probar SIN tocar la
 * base, porque devuelven antes de llegar a `guardarEdicion` (esa mitad, con
 * base real, vive en `editar.test.db.ts`).
 */

describe('motivoParaNoEditar — pura', () => {
  test('un texto vacío (o solo espacios) no se puede mandar', () => {
    assert.equal(motivoParaNoEditar(''), 'el mensaje no puede quedar vacío');
    assert.equal(motivoParaNoEditar('   '), 'el mensaje no puede quedar vacío');
  });

  test('con texto, no hay motivo', () => {
    assert.equal(motivoParaNoEditar('perdón, era 350'), null);
  });
});

describe('editarMensaje — las guardas de línea y sesión', () => {
  const ORDEN_BASE = { numeroPropio: '51987654321', telefono: '51900000000', mensajeId: 'ABC', textoNuevo: 'ok' };
  // No se toca ninguna base en estos casos: todas cortan antes.
  const baseInerte = {} as never;

  test('falta el mensaje a editar', async () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    const r = await editarMensaje(baseInerte, t, { ...ORDEN_BASE, mensajeId: '' });
    assert.deepEqual(r, { ok: false, motivo: 'falta el mensaje a editar' });
  });

  test('texto vacío: el motivo es el de `motivoParaNoEditar`', async () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    const r = await editarMensaje(baseInerte, t, { ...ORDEN_BASE, textoNuevo: '  ' });
    assert.deepEqual(r, { ok: false, motivo: 'el mensaje no puede quedar vacío' });
  });

  test('🔴 la edición es para OTRA línea: nunca sale por la de este transporte', async () => {
    const t = new TransporteFalso({ telefono: '51900000001' }); // otra línea
    const r = await editarMensaje(baseInerte, t, ORDEN_BASE);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /la edición es para 51987654321 y este transporte es 51900000001/);
  });

  test('con la sesión baneada, no se edita', async () => {
    const t = new TransporteFalso({ telefono: '51987654321' });
    t.simularBan('191', 'en 24 horas');
    const r = await editarMensaje(baseInerte, t, ORDEN_BASE);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /WhatsApp suspendió el número/);
  });

  test('con la sesión caída (no conectada), no se edita', async () => {
    // `numeroPropio` cae a `opciones.telefono` en cualquier estado no
    // conectado (ver el getter de `TransporteFalso`), así que esto SÍ pasa la
    // guarda de línea y llega a la de sesión — que es la que se quiere probar.
    const t = new TransporteFalso({ telefono: '51987654321' });
    t.simularEstado({ estado: 'desconectado', motivo: 'se cortó la conexión' });
    const r = await editarMensaje(baseInerte, t, ORDEN_BASE);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /la sesión está "desconectado"/);
  });

  test('🔴 una línea sin `editarTexto` (la Cloud API) lo dice, no lo intenta', async () => {
    // Un transporte que cumple el contrato sin la capacidad opcional — el caso
    // real de `TransporteCloudApi`, que no la implementa.
    const t = {
      numeroPropio: '51987654321',
      estado: () => ({ estado: 'conectado' as const, telefono: '51987654321' }),
      // sin `editarTexto`
    };
    const r = await editarMensaje(baseInerte, t, ORDEN_BASE);
    assert.deepEqual(r, { ok: false, motivo: 'esta línea no puede editar mensajes' });
  });
});
