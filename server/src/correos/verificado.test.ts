import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dominiosVerificados, puedeSerRemitente, ENV_DOMINIOS } from './verificado.js';

/**
 * Qué dirección puede ser `From`, interrogada sobre los casos que terminan en un
 * 554 de SES con un lead esperando.
 *
 * ⚠️ Ningún test de acá toca `process.env`: el entorno entra como ARGUMENTO. En
 * `node:test` los archivos corren en paralelo sobre el MISMO `process.env`, así
 * que un test que lo pisa le cambia el mundo a otro archivo y el rojo aparece
 * donde nadie tocó nada.
 */

const con = (valor?: string) => (valor === undefined ? {} : { [ENV_DOMINIOS]: valor });

describe('los dominios verificados que se leen del entorno', () => {
  test('sin la variable, el default es el único dominio MEDIDO como verificado en SES', () => {
    // No es un default de comodidad: el 17-ago-2026 se verificó que existe el TXT
    // `_amazonses.goberna.us`, o sea que SES tiene el DOMINIO entero verificado.
    assert.deepEqual(dominiosVerificados(con()), ['goberna.us']);
  });

  test('una variable vacía o con puras comas cae al default, no a la lista vacía', () => {
    // Vacía nadie podría dar de alta un remitente y la pantalla de altas quedaría
    // muerta el día que alguien borre la variable — sin un solo error que lo diga.
    assert.deepEqual(dominiosVerificados(con('')), ['goberna.us']);
    assert.deepEqual(dominiosVerificados(con('   ')), ['goberna.us']);
    assert.deepEqual(dominiosVerificados(con(',, ,')), ['goberna.us']);
  });

  test('varios dominios, separados por coma y con espacios de más', () => {
    assert.deepEqual(dominiosVerificados(con(' goberna.us , otra.com ')), ['goberna.us', 'otra.com']);
  });

  test('se conserva la grafía configurada, no se reescribe', () => {
    // Lo configurado es lo que la pantalla le muestra al operador cuando le
    // rechaza un alta. Un mensaje que reescribe lo que escribieron no ayuda a
    // encontrar el error.
    assert.deepEqual(dominiosVerificados(con('Goberna.US')), ['Goberna.US']);
  });
});

describe('quién puede ir en el From', () => {
  const verificados = dominiosVerificados(con());

  test('una dirección de goberna.us entra con el default', () => {
    assert.equal(puedeSerRemitente('escuela@goberna.us', verificados), true);
    assert.equal(puedeSerRemitente('ventas@goberna.us', verificados), true);
  });

  test('🔴 grupogoberna.com NO entra: no está verificado en SES (medido el 17-ago-2026)', () => {
    // Y no es un detalle de config: los `vendedora_id` del equipo SON de ese
    // dominio (`ventas10@`, `ventas11@`, `ventas12@grupogoberna.com`). Si esto
    // devolviera true, el alta se vería bien y SES contestaría 554 en el primer
    // envío. Como Reply-To sí sirven —SES no verifica el Reply-To—, que es
    // exactamente lo que hace D2 en `remitente.ts`.
    assert.equal(puedeSerRemitente('ventas10@grupogoberna.com', verificados), false);
    assert.equal(puedeSerRemitente('x@grupogoberna.com', verificados), false);
  });

  test('🔴 la grafía no decide: `ESCUELA@Goberna.US` es el mismo buzón que `escuela@goberna.us`', () => {
    // Mismo motivo por el que el índice UNIQUE va sobre `lower(direccion)`. Un
    // alta rechazada por una mayúscula se lee como «no me deja» y el operador
    // prueba con otra dirección en vez de mirar la variable.
    assert.equal(puedeSerRemitente('ESCUELA@Goberna.US', verificados), true);
    assert.equal(puedeSerRemitente('  Escuela@GOBERNA.us  ', verificados), true);
    assert.equal(puedeSerRemitente('escuela@goberna.us', dominiosVerificados(con('GOBERNA.US'))), true);
  });

  test('sin arroba no es una dirección', () => {
    assert.equal(puedeSerRemitente('sin-arroba', verificados), false);
    assert.equal(puedeSerRemitente('goberna.us', verificados), false);
  });

  test('🔴 con DOS arrobas tampoco, aunque el final diga goberna.us', () => {
    // `'a@b@goberna.us'.split('@').pop()` da `goberna.us`: leído con la receta
    // perezosa pasaría, siendo una cabecera que SES rechaza. El patrón es el de
    // siempre — dos parsers que leen distinto la misma cadena.
    assert.equal(puedeSerRemitente('a@b@goberna.us', verificados), false);
    assert.equal(puedeSerRemitente('escuela@goberna.us@evil.com', verificados), false);
  });

  test('las mitades vacías y los espacios internos se rechazan', () => {
    assert.equal(puedeSerRemitente('@goberna.us', verificados), false);
    assert.equal(puedeSerRemitente('escuela@', verificados), false);
    assert.equal(puedeSerRemitente('', verificados), false);
    assert.equal(puedeSerRemitente('   ', verificados), false);
    // Un espacio adentro de lo que va a una cabecera es la puerta a que empiece a
    // leerse como otra cosa (ver `sinSaltos` en `remitente.ts`).
    assert.equal(puedeSerRemitente('escuela @goberna.us', verificados), false);
    assert.equal(puedeSerRemitente('escuela@goberna.us otra@goberna.us', verificados), false);
  });

  test('con varios dominios configurados entran los dos', () => {
    const dos = dominiosVerificados(con('goberna.us, otra.com'));
    assert.equal(puedeSerRemitente('escuela@goberna.us', dos), true);
    assert.equal(puedeSerRemitente('hola@otra.com', dos), true);
    assert.equal(puedeSerRemitente('hola@tercera.com', dos), false);
  });

  test('con la lista vacía no entra nadie: fail-closed', () => {
    // Hoy `dominiosVerificados` no puede devolver vacío, pero el que llama puede
    // filtrarla: una lista vacía tiene que cerrar, nunca abrir.
    assert.equal(puedeSerRemitente('escuela@goberna.us', []), false);
  });
});
