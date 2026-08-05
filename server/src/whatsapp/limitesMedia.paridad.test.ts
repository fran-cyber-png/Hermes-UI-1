import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  motivoPorTamano as motivoServer,
  pesoLegible as pesoServer,
  LIMITES_CLOUD_API,
  TOPE_HTTP_BYTES,
} from './limitesMedia.js';

/**
 * EL MENSAJE DE «NO ENTRA» SE ESCRIBE DOS VECES, Y TIENE QUE DECIR LO MISMO.
 *
 * El front frena antes de subir (`src/features/whatsapp/pegarAdjunto.ts`) y el
 * server frena igual (`limitesMedia.ts`), porque el front es conveniencia y el
 * server es la garantía. Las dos son necesarias — pero son dos, y dos cabezas
 * divergen (la lección de #37, otra vez).
 *
 * Lo que se fija acá es la RELACIÓN, no una implementación: quién frene primero
 * depende de si el server publicó sus límites, y la vendedora tiene que leer la
 * misma frase con las mismas cifras en los dos casos. Un «16 MB» de un lado y
 * un «16.0MB» del otro se leen como dos reglas distintas.
 */

const FRENTE = new URL('../../../src/features/whatsapp/pegarAdjunto.ts', import.meta.url);
const MB = 1024 * 1024;

describe('paridad del tope front ↔ server', () => {
  const fuente = readFileSync(FRENTE, 'utf8');

  test('el techo de 64 MB es el mismo número de los dos lados', () => {
    const m = /TOPE_ADJUNTO_BYTES = (\d+) \* 1024 \* 1024/.exec(fuente);
    assert.ok(m, 'no encontré TOPE_ADJUNTO_BYTES en el front');
    assert.equal(Number(m[1]) * MB, TOPE_HTTP_BYTES);
  });

  test('🔴 la redacción es la misma frase, no dos parecidas', () => {
    // El server la escribe; el front tiene que tener la misma plantilla. Si
    // alguien mejora una sola, esto falla y obliga a tocar las dos.
    const delServer = motivoServer('video', Math.round(17.9 * MB), LIMITES_CLOUD_API) ?? '';
    assert.equal(delServer, 'El video pesa 17,9 MB y por esta línea entran hasta 16 MB.');
    assert.ok(
      fuente.includes('pesa ${pesoLegible(archivo.size)} y por esta línea entran hasta ${pesoLegible(tope)}.'),
      'el front no arma la misma frase que el server',
    );
  });

  test('las cuatro clases se nombran igual', () => {
    for (const [clase, nombre] of [
      ['imagen', 'La imagen'],
      ['video', 'El video'],
      ['audio', 'El audio'],
      ['documento', 'El archivo'],
    ] as const) {
      assert.match(motivoServer(clase, TOPE_HTTP_BYTES + 1, LIMITES_CLOUD_API) ?? '', new RegExp(`^${nombre} `));
      assert.ok(fuente.includes(`${clase}: '${nombre}'`), `el front no nombra ${clase} como «${nombre}»`);
    }
  });

  test('🔴 `pesoLegible` da la misma cadena para las cifras que se ven juntas', () => {
    // Las dos cifras del mismo mensaje pueden venir una de cada lado según
    // quién frenó. «16 MB» vs «16,0 MB» en la misma frase se lee como un bug.
    const casos = [Math.round(17.9 * MB), 16 * MB, 5 * MB, MB, 312 * 1024, 900];
    const delFront = /return `\$\{mb < 100 \? mb\.toFixed\(1\)\.replace\(\/\[\.,\]0\$\/, ''\)\.replace\('\.', ','\) : Math\.round\(mb\)\} MB`/;
    assert.match(fuente, delFront, 'la fórmula de MB del front cambió: revisá que siga coincidiendo');
    assert.deepEqual(
      casos.map(pesoServer),
      ['17,9 MB', '16 MB', '5 MB', '1 MB', '312 KB', '900 B'],
    );
  });
});
