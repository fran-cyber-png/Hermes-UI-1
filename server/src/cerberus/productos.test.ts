import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapearProducto } from './productos.js';

/**
 * EL MAPEO DEL CATÁLOGO (#43) — de la fila cruda de Cerberus al producto que ve
 * el front, ahora CON moneda. La regla: la moneda nunca se inventa — si el
 * payload no la trae, va `''` y el consumidor decide (un hueco antes que una
 * moneda equivocada).
 */

/**
 * Fila REAL del payload vivo de `/productos/api/public/productos-cursos/?estado=1`
 * (verificado 2026-07-23): hoy NO trae ninguna key de moneda — ni `moneda`, ni
 * `simbolo_moneda`, ni `codigo_moneda`, tampoco anidada. Si Cerberus la agrega,
 * el mapeo la toma solo (casos de abajo); mientras tanto, `''`.
 */
const FILA_VIVA = {
  codigo_producto: 1733,
  sku_producto: 'EPCOORP004',
  nombre_producto: 'Curso de Especialización Oratoria para Políticos 4',
  precio_normal: 150.0,
  precio_promocion: 80.0,
  categoria: { codigo_categoria: 5, nombre_categoria: 'Curso Online' },
  negocio: { codigo_negocio: 2, nombre_negocio: 'Escuela' },
  division: { codigo_division: 1, nombre_division: 'Estrategia Politica' },
  estado: { codigo_estado: 1, nombre_estado: 'Disponible' },
};

test('mapea la fila real del payload vivo — y la moneda ausente es «», jamás inventada', () => {
  assert.deepEqual(mapearProducto(FILA_VIVA), {
    id: '1733',
    sku: 'EPCOORP004',
    nombre: 'Curso de Especialización Oratoria para Políticos 4',
    precioNormal: 150,
    precioPromocion: 80,
    moneda: '',
  });
});

test('si Cerberus agrega la key `moneda`, el mapeo la toma', () => {
  assert.equal(mapearProducto({ ...FILA_VIVA, moneda: 'S/' }).moneda, 'S/');
});

test('si solo viene `simbolo_moneda`, se usa esa', () => {
  assert.equal(mapearProducto({ ...FILA_VIVA, simbolo_moneda: 'USD' }).moneda, 'USD');
});

test('si solo viene `codigo_moneda`, se usa esa', () => {
  assert.equal(mapearProducto({ ...FILA_VIVA, codigo_moneda: 'PEN' }).moneda, 'PEN');
});

test('prioridad: `moneda` gana a `simbolo_moneda`, y esa a `codigo_moneda`', () => {
  assert.equal(
    mapearProducto({ ...FILA_VIVA, moneda: 'S/', simbolo_moneda: 'USD', codigo_moneda: 'PEN' }).moneda,
    'S/',
  );
  assert.equal(
    mapearProducto({ ...FILA_VIVA, simbolo_moneda: 'USD', codigo_moneda: 'PEN' }).moneda,
    'USD',
  );
});

test('moneda null o vacía también cae a «» — nunca "null" como texto', () => {
  assert.equal(mapearProducto({ ...FILA_VIVA, moneda: null }).moneda, '');
  assert.equal(mapearProducto({ ...FILA_VIVA, moneda: '' }).moneda, '');
});

test('sin precio_promocion, el precio de promoción cae al normal (comportamiento de siempre)', () => {
  const { precio_promocion: _fuera, ...sinPromo } = FILA_VIVA;
  const p = mapearProducto(sinPromo);
  assert.equal(p.precioNormal, 150);
  assert.equal(p.precioPromocion, 150);
});
