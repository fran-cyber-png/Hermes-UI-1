import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarRespuestaVenta, cuerpoDeVenta, motivoParaNoRegistrar, type OrdenVenta } from './venta.js';

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

/**
 * ── EL CUERPO QUE SE POSTEA ──
 *
 * Estos tests existen por una medición: `gestiones` tiene **0 filas en `cierre`**
 * en toda la base de producción. Nunca se registró una venta desde este
 * formulario, y el motivo estaba en dos campos que viajaban vacíos —`local` y
 * `cuotas_json`— dentro de una función que sale a internet, o sea donde ningún
 * test podía mirar. Ahora el cuerpo se arma aparte y se puede interrogar.
 */

function orden(over: Partial<OrdenVenta> = {}): OrdenVenta {
  return {
    clienteId: 4821,
    monedaId: '1',
    paisId: '1',
    localId: '3',
    preventa: true,
    medio: 'pagado',
    origen: 'whatsapp',
    montoTotal: 199,
    productos: [{ productoId: '904', cantidad: 1, precioRegular: 249, precioVenta: 199 }],
    cuotas: [{ fechaVencimiento: '2026-08-11' }],
    saveMode: 'venta',
    clave: 'conv:whatsapp:51984429504:51986394450',
    ...over,
  };
}

const cuerpo = (o: OrdenVenta) => cuerpoDeVenta({ csrf: 'tok', vendedoraId: 'luz', orden: o });

test('el local VIAJA — el campo que mataba también a la Cotización', () => {
  // `sales/forms.py:132` lo volvió `required` el 22-jul-2026 y Hermes seguía
  // mandando `''`: desde esa fecha las DOS salidas del modal daban 400.
  assert.equal(cuerpo(orden()).get('local'), '3');
});

test('`cuotas_json` sale con la forma que `crear_venta` parsea: solo la fecha', () => {
  const c = cuerpo(orden({ cuotas: [{ fechaVencimiento: '2026-08-11' }, { fechaVencimiento: '2026-09-11' }] }));
  assert.deepEqual(JSON.parse(c.get('cuotas_json') ?? 'null'), [
    { fecha_vencimiento: '2026-08-11' },
    { fecha_vencimiento: '2026-09-11' },
  ]);
});

test('NO se manda el monto de cada cuota: lo recalcula Cerberus', () => {
  // `_distribuir_monto_en_cuotas(venta.monto_total, len(cuotas))` — mandar un
  // monto sería mandar un dato que el otro lado ignora, y un dato ignorado se
  // lee como un dato respetado. Lo mismo con `numero_cuota`, que Cerberus fuerza
  // por índice «para evitar manipulación del correlativo desde cliente».
  const cuotas = JSON.parse(cuerpo(orden()).get('cuotas_json') ?? 'null') as Record<string, unknown>[];
  assert.deepEqual(Object.keys(cuotas[0]), ['fecha_vencimiento']);
});

test('una cotización sin cuotas sigue siendo válida, y viaja con la lista vacía', () => {
  // Una cotización es un presupuesto y no entra a tesorería: `views.py:947` le
  // perdona el cronograma. Si esto se endurece, se rompe la única salida del
  // modal que la vendedora podría usar mientras negocia.
  const o = orden({ saveMode: 'cotizacion', cuotas: [] });
  assert.equal(motivoParaNoRegistrar(o), null);
  assert.equal(cuerpo(o).get('cuotas_json'), '[]');
});

test('una VENTA sin cuotas se frena acá, con el motivo en castellano', () => {
  // El 400 de Django dice «Debe agregar al menos una cuota» y llega envuelto en
  // «Formulario inválido» cuando además falla el form: la vendedora no tenía qué
  // corregir. Se frena antes de gastar el viaje.
  assert.equal(motivoParaNoRegistrar(orden({ cuotas: [] })), 'Una venta necesita al menos una cuota.');
  assert.match(
    motivoParaNoRegistrar(orden({ cuotas: [{ fechaVencimiento: '' }] })) ?? '',
    /fecha de vencimiento/,
  );
});

test('sin local no se manda nada, ni venta ni cotización', () => {
  for (const saveMode of ['venta', 'cotizacion'] as const) {
    assert.match(motivoParaNoRegistrar(orden({ saveMode, localId: '' })) ?? '', /local/);
  }
});

test('el precio pactado por línea es el que viaja, y el regular queda al lado', () => {
  // Sin los dos, un descuento no se puede ni ver ni medir: `precio_regular` es
  // el del catálogo y `precio_venta` lo que la vendedora acordó.
  const c = cuerpo(orden({
    montoTotal: 320,
    productos: [{ productoId: '904', cantidad: 2, precioRegular: 249, precioVenta: 160 }],
  }));
  assert.deepEqual(JSON.parse(c.get('productos_json') ?? 'null'), [
    { producto_id: '904', cantidad: 2, precio_regular: 249, precio_venta: 160, precio_total: 320 },
  ]);
  assert.equal(c.get('monto_total'), '320');
});

test('la orden completa sigue pasando el filtro, y las viejas fallas siguen fallando', () => {
  assert.equal(motivoParaNoRegistrar(orden()), null);
  assert.match(motivoParaNoRegistrar(orden({ productos: [] })) ?? '', /productos/);
  assert.match(motivoParaNoRegistrar(orden({ monedaId: '' })) ?? '', /moneda/);
});
