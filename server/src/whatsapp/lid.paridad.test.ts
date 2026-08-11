import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREFIJO_LID, esIdentidadDeLid } from './identidadWa.js';

/**
 * EL PREFIJO DE UNA IDENTIDAD SIN TELÉFONO SE ESCRIBE DOS VECES.
 *
 * El server lo ESTAMPA (`identidadWa.ts`: cuando WhatsApp no entrega el teléfono
 * de quien escribe, la fila entra como `lid-<id>`) y el front lo LEE
 * (`canales/canal.ts`: `personaEsTelefono` devuelve false para no buscar la
 * ficha de Cerberus con algo que no es un número).
 *
 * Si divergen no hay error ni log: el front vería `lid-123…` como un teléfono,
 * le sacaría el sufijo de 9 y cruzaría con el padrón — **la ficha de OTRA
 * persona pegada a este chat**. Es el mismo modo de fallar contra el que
 * `canal.ts` ya se defiende para los PSID de Meta, y el mismo que hizo falta
 * poner una guarda de país en `clienteSql.ts` (#133).
 *
 * Se fija la RELACIÓN, no la implementación: lo único que tiene que ser cierto
 * es que las dos mitades hablen del mismo prefijo.
 */

const CANAL_FRONT = new URL('../../../src/features/canales/canal.ts', import.meta.url);

describe('paridad del prefijo de identidad sin teléfono', () => {
  const fuente = readFileSync(CANAL_FRONT, 'utf8');

  test('el front declara el MISMO prefijo que estampa el server', () => {
    const m = /PREFIJO_LID = '([^']+)'/.exec(fuente);
    assert.ok(m, 'no encontré PREFIJO_LID en src/features/canales/canal.ts');
    assert.equal(m[1], PREFIJO_LID);
  });

  test('el front lo USA para negar que la persona sea un teléfono', () => {
    // No alcanza con declararlo: si nadie lo consulta, la guarda no existe.
    assert.match(fuente, /startsWith\(PREFIJO_LID\)/);
  });

  test('🔴 el prefijo no puede llevar `:` — la clave de conversación se parsea por posición', () => {
    // `conv:<canal>:<persona>:<numeroPropio>` se corta con split(':')
    // (`identidad/clave.ts`). Un `:` acá corre los campos en silencio.
    assert.ok(!PREFIJO_LID.includes(':'));
  });

  test('y lo que estampa el server es reconocible por esa misma regla', () => {
    assert.ok(esIdentidadDeLid(`${PREFIJO_LID}195997208682673`));
  });
});
