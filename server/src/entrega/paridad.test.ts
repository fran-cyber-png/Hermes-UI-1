import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avanzarEstado, type EstadoEntrega } from './dominio.js';

/**
 * LA ESCALA ESTÁ ESCRITA DOS VECES — en TypeScript y en SQL.
 *
 * `avanzarEstado` decide en Node; el `WHERE` de `aplicarRecibo` decide en la
 * base, y **tiene que decidir igual**. Son dos porque el avance monótono no se
 * puede hacer leyendo-y-escribiendo desde Node: dos recibos simultáneos leerían
 * el mismo estado viejo y el segundo pisaría al primero. La base arbitra.
 *
 * Es el mismo patrón de `cola/urgencia.ts` + `urgenciaSql.ts` (ADR 0009), y la
 * misma lección de #37: dos implementaciones de una regla divergen, y acá
 * divergir significa mostrar «no leído» sobre algo que el lead ya vio.
 *
 * Lo que se fija es **la relación**, no una de las dos.
 */

const RANGOS: Record<EstadoEntrega, number> = {
  enviado: 1,
  entregado: 2,
  leido: 3,
  fallido: 9,
};

const TODOS: EstadoEntrega[] = ['enviado', 'entregado', 'leido', 'fallido'];

describe('paridad TS ↔ SQL de la escala de entrega', () => {
  const fuente = readFileSync(new URL('./repositorio.ts', import.meta.url), 'utf8');

  test('el SQL usa los mismos números que este test declara', () => {
    // Si alguien cambia un rango en el SQL y no acá, esto lo grita.
    for (const [estado, n] of Object.entries(RANGOS)) {
      assert.match(
        fuente,
        new RegExp(`WHEN '${estado}'\\s*THEN ${n}`),
        `el CASE del SQL no mapea ${estado} → ${n}`,
      );
    }
  });

  test('la tabla de rangos de TypeScript coincide con el CASE', () => {
    // `RANGO_TS` es una tabla y no un ternario encadenado justamente para que
    // los cuatro estados sean visibles acá: en el ternario, `enviado` quedaba
    // en el `else` y este test no podía verlo.
    for (const e of TODOS) {
      assert.match(fuente, new RegExp(`${e}: ${RANGOS[e]},`), `RANGO_TS no mapea ${e} → ${RANGOS[e]}`);
    }
  });

  test('🔴 el SQL solo avanza: lleva la comparación `<`', () => {
    // Sin esa condición el UPDATE pisaría siempre y volvería «entregado» un
    // mensaje ya leído, en cuanto llegara un recibo viejo.
    assert.match(fuente, /< \$\{rangoDe\(recibo\.estado\)\}/);
  });

  test('🔴 para TODO par, la decisión de los dos lados es la misma', () => {
    // La propiedad de verdad: el SQL actualiza ⟺ `avanzarEstado` devuelve algo
    // distinto de lo que ya había.
    for (const actual of [...TODOS, null] as (EstadoEntrega | null)[]) {
      for (const nuevo of TODOS) {
        const resultadoTs = avanzarEstado(actual, nuevo);
        const sqlActualiza = (actual === null ? 0 : RANGOS[actual]) < RANGOS[nuevo];
        const tsCambia = resultadoTs !== actual;
        assert.equal(
          sqlActualiza,
          tsCambia,
          `divergen para (${actual} → ${nuevo}): SQL ${sqlActualiza ? 'actualiza' : 'no'}, TS da ${resultadoTs}`,
        );
      }
    }
  });

  test('el rango de `fallido` está por encima de todo', () => {
    // Es lo que hace que un fallo gane siempre, en los dos lados.
    assert.ok(RANGOS.fallido > Math.max(RANGOS.enviado, RANGOS.entregado, RANGOS.leido));
  });
});
