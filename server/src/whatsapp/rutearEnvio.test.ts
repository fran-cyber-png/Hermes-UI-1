import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { GestorWhatsapp, puertaDe, type WhatsappArmado } from './gestor.js';
import type { EnvioControlado } from './envioControlado.js';

/**
 * POR QUÉ LÍNEA SALE UN ENVÍO — la decisión que estuvo mal desde que hubo dos.
 *
 * `enviarYProyectar` llamaba a `whatsapp().envio`, o sea **la primera línea,
 * siempre**. La guarda #0 de `EnvioControlado` hacía lo suyo y rechazaba con
 * «envío enrutado a la línea equivocada», así que no salió ni un mensaje por el
 * número de otra persona — pero el efecto en producción fue peor de lo que
 * suena: **la vendedora nueva veía su cola entera y no podía mandar una letra.**
 *
 * Se testea acá, con el gestor inyectado, porque es una decisión de ruteo y no
 * hace falta levantar transportes ni base para interrogarla.
 */

/** Una línea de mentira: solo necesita su número y algo que haga de puerta. */
function lineaDe(numero: string): WhatsappArmado {
  return {
    numero,
    transporte: { numeroPropio: numero } as WhatsappArmado['transporte'],
    envio: { marca: numero } as unknown as EnvioControlado,
    falso: null,
  };
}

function gestorCon(...numeros: string[]): GestorWhatsapp {
  const g = new GestorWhatsapp();
  for (const n of numeros) g.agregar(lineaDe(n));
  return g;
}

const LUZ = '51986394450';
const WALTER = '51941654039';

describe('puertaDe — el envío sale por la línea de la ORDEN', () => {
  test('cada línea manda por la suya, no por la primera', () => {
    const g = gestorCon(LUZ, WALTER);

    const deWalter = puertaDe(WALTER, g);
    assert.equal(deWalter.ok, true);
    assert.deepEqual(deWalter.ok && deWalter.envio, { marca: WALTER });

    const deLuz = puertaDe(LUZ, g);
    assert.deepEqual(deLuz.ok && deLuz.envio, { marca: LUZ });
  });

  test('🔴 la SEGUNDA línea puede mandar — el bug que dejó a Walter en solo lectura', () => {
    // Con `whatsapp().envio` esto devolvía la puerta de LUZ, la guarda #0 la
    // rechazaba, y Walter veía «envío enrutado a la línea equivocada» en cada
    // intento de responder.
    const g = gestorCon(LUZ, WALTER);
    const r = puertaDe(WALTER, g);
    assert.equal(r.ok, true);
    assert.notDeepEqual(r.ok && r.envio, { marca: LUZ }, 'no puede ser la puerta de la primera línea');
  });

  test('una línea que NO corre falla con motivo — nunca cae al primero', () => {
    // Caer al primero sería mandarle a un lead de Walter desde el número de Luz:
    // el lead vería a un desconocido escribiéndole, y la atribución mentiría.
    const g = gestorCon(LUZ, WALTER);
    const r = puertaDe('51944531711', g);

    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.motivo : '', /no está conectada/);
    assert.match(r.ok === false ? r.motivo : '', /51944531711/);
  });

  test('el motivo LISTA las líneas vivas: sin eso no se sabe qué hacer con el error', () => {
    const g = gestorCon(LUZ, WALTER);
    const r = puertaDe('51900000000', g);
    assert.match(r.ok === false ? r.motivo : '', new RegExp(`${LUZ}.*${WALTER}`));
  });

  test('sin ninguna línea viva el motivo lo dice, en vez de una lista vacía muda', () => {
    const r = puertaDe(WALTER, gestorCon());
    assert.match(r.ok === false ? r.motivo : '', /ninguna/);
  });

  test('el formato del número no decide nada: `+51 941…` es la misma línea', () => {
    const g = gestorCon(LUZ, WALTER);
    const r = puertaDe('+51 941 654 039', g);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.envio, { marca: WALTER });
  });
});
