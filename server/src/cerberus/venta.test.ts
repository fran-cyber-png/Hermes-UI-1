import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarRespuestaVenta } from './venta.js';

/**
 * EL PRIMER TEST DE `venta.ts` — y es del veredicto, porque el veredicto decide
 * si se escribe una conversión y se cierra el pipeline. La historia que fija:
 *
 * 1. Un 302 al login se contaba como «registrada» (venta fantasma en el CRM).
 * 2. El primer arreglo trató TODO >=300 como «sesión expiró» + borrado — y un
 *    500 del latin1 (regla dura #4) o un 502 de nginx deslogueaban de Cerberus
 *    a las tres vendedoras por un hipo. La revisión adversaria lo atrapó.
 *
 * La regla fina: SOLO el 3xx cuyo Location apunta a /ingresar es sesión muerta
 * (el mismo idioma que `auth.ts`). Todo lo demás es un rechazo de ESTA venta.
 */

test('el JSON manda: success es ok (con folio de cualquiera de los dos nombres), message es rechazo', () => {
  assert.deepEqual(clasificarRespuestaVenta(200, null, { success: true, folio_venta: 'F-9' }), {
    tipo: 'ok',
    folio: 'F-9',
    mensaje: undefined,
  });
  assert.deepEqual(clasificarRespuestaVenta(200, null, { message: 'stock insuficiente' }), {
    tipo: 'rechazo',
    motivo: 'stock insuficiente',
  });
});

test('SOLO el 3xx con Location al login es sesión muerta', () => {
  assert.deepEqual(clasificarRespuestaVenta(302, '/ingresar/?next=/ventas/crearVenta/', {}), {
    tipo: 'sesion_muerta',
  });
  // Un redirect a cualquier otro lado NO borra la sesión de nadie.
  assert.equal(clasificarRespuestaVenta(302, '/ventas/', {}).tipo, 'rechazo');
  // Sin Location tampoco: no hay evidencia de login.
  assert.equal(clasificarRespuestaVenta(302, null, {}).tipo, 'rechazo');
});

test('un hipo de Cerberus es un rechazo de ESTA venta, jamás «tu sesión expiró»', () => {
  // El 500 del emoji contra el MySQL latin1 (regla dura #4):
  assert.deepEqual(clasificarRespuestaVenta(500, null, {}), {
    tipo: 'rechazo',
    motivo: 'Cerberus rechazó la venta (HTTP 500)',
  });
  // El 403 de CSRF y los 502/504 de nginx, lo mismo:
  for (const status of [403, 502, 504]) {
    assert.equal(clasificarRespuestaVenta(status, null, {}).tipo, 'rechazo');
  }
});

test('el residuo documentado: un 200 sin JSON sigue contando como registrada', () => {
  // Cerrarlo exige saber si Cerberus puede responder éxito sin JSON — se mide,
  // no se supone. Si este test te molesta, el issue de seguimiento es el lugar.
  assert.deepEqual(clasificarRespuestaVenta(200, null, {}), { tipo: 'ok', mensaje: 'registrada' });
});

test('un status fuera de todo rango conocido es rechazo, no éxito', () => {
  assert.equal(clasificarRespuestaVenta(199, null, {}).tipo, 'rechazo');
});
