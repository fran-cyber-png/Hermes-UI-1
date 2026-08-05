import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  claseDeMime,
  limitesDe,
  motivoPorTamano,
  pesoLegible,
  LIMITES_CLOUD_API,
  LIMITES_PROPIOS,
  TOPE_HTTP_BYTES,
} from './limitesMedia.js';

const MB = 1024 * 1024;

describe('límites por transporte', () => {
  test('la Cloud API impone los topes de Meta, por clase', () => {
    // Verificados el 5-ago-2026 contra la doc oficial de Meta.
    assert.equal(LIMITES_CLOUD_API.imagen, 5 * MB);
    assert.equal(LIMITES_CLOUD_API.video, 16 * MB);
    assert.equal(LIMITES_CLOUD_API.audio, 16 * MB);
  });

  test('🔴 whatsmeow NO hereda los topes de Meta', () => {
    // Los 5 MB de imagen son de la Cloud API, no de WhatsApp. Las líneas de las
    // vendedoras mandan imágenes más pesadas hoy: aplicarles el tope de Meta
    // rechazaría envíos que funcionan.
    assert.equal(limitesDe('whatsmeow').imagen, TOPE_HTTP_BYTES);
    assert.equal(limitesDe('falso').video, TOPE_HTTP_BYTES);
    assert.deepEqual(limitesDe('whatsmeow'), LIMITES_PROPIOS);
  });

  test('cloud-api es el único que recorta', () => {
    assert.deepEqual(limitesDe('cloud-api'), LIMITES_CLOUD_API);
  });

  test('🔴 ningún límite promete más de lo que el cuerpo HTTP deja pasar', () => {
    // Meta acepta 100 MB de documento, pero `express.raw` corta en 64: prometer
    // 100 daría un 413 sin mensaje nuestro, que es el defecto de origen.
    for (const limites of [LIMITES_CLOUD_API, LIMITES_PROPIOS]) {
      for (const [clase, tope] of Object.entries(limites)) {
        assert.ok(tope <= TOPE_HTTP_BYTES, `${clase} promete ${tope} y el cuerpo corta en ${TOPE_HTTP_BYTES}`);
      }
    }
  });

  test('🔴 el tope propio es EL MISMO que el `limit` de `express.raw`', () => {
    // Si alguien sube el limit de la ruta y no esto, el mensaje amable deja de
    // aparecer y vuelve el 413 pelado. Se lee el archivo, no se confía.
    const ruta = readFileSync(new URL('../routes/whatsapp.ts', import.meta.url), 'utf8');
    const m = /express\.raw\(\{[^}]*limit:\s*'(\d+)mb'/.exec(ruta);
    assert.ok(m, 'no encontré el `limit` de express.raw en la ruta');
    assert.equal(Number(m[1]) * MB, TOPE_HTTP_BYTES);
  });
});

describe('motivoPorTamano', () => {
  test('lo que entra no da motivo', () => {
    assert.equal(motivoPorTamano('video', 15 * MB, LIMITES_CLOUD_API), null);
    assert.equal(motivoPorTamano('video', 16 * MB, LIMITES_CLOUD_API), null);
  });

  test('🔴 el caso real: 17,9 MB de video por la línea del bot', () => {
    const motivo = motivoPorTamano('video', Math.round(17.9 * MB), LIMITES_CLOUD_API);
    // Las DOS cifras: con una sola no se puede decidir qué hacer.
    assert.match(motivo ?? '', /17,9 MB/);
    assert.match(motivo ?? '', /16 MB/);
    assert.match(motivo ?? '', /^El video/);
  });

  test('cada clase se nombra por lo que es', () => {
    assert.match(motivoPorTamano('imagen', 9 * MB, LIMITES_CLOUD_API) ?? '', /^La imagen/);
    assert.match(motivoPorTamano('audio', 20 * MB, LIMITES_CLOUD_API) ?? '', /^El audio/);
    assert.match(motivoPorTamano('documento', 70 * MB, LIMITES_CLOUD_API) ?? '', /^El archivo/);
  });

  test('el mismo video por una línea whatsmeow SÍ entra', () => {
    assert.equal(motivoPorTamano('video', Math.round(17.9 * MB), LIMITES_PROPIOS), null);
  });

  test('el motivo nunca menciona a Meta ni un código: lo lee una vendedora', () => {
    const motivo = motivoPorTamano('video', 30 * MB, LIMITES_CLOUD_API) ?? '';
    for (const feo of ['fbtrace', 'OAuth', '#100', 'Cloud API', 'error', 'parameter']) {
      assert.ok(!motivo.includes(feo), `el motivo dice «${feo}»: ${motivo}`);
    }
  });
});

describe('claseDeMime', () => {
  test('las cuatro clases salen del mime', () => {
    assert.equal(claseDeMime('image/png'), 'imagen');
    assert.equal(claseDeMime('video/mp4'), 'video');
    assert.equal(claseDeMime('audio/ogg'), 'audio');
    assert.equal(claseDeMime('application/pdf'), 'documento');
  });

  test('lo desconocido cae en documento, que es lo que la Cloud API deja más grande', () => {
    assert.equal(claseDeMime('application/octet-stream'), 'documento');
    assert.equal(claseDeMime(''), 'documento');
  });
});

describe('pesoLegible', () => {
  test('la cifra se lee como la diría una persona', () => {
    assert.equal(pesoLegible(Math.round(17.9 * MB)), '17,9 MB');
    assert.equal(pesoLegible(16 * MB), '16 MB');
    assert.equal(pesoLegible(5 * MB), '5 MB');
    assert.equal(pesoLegible(312 * 1024), '312 KB');
  });

  test('un entero no arrastra «,0»', () => {
    // «16,0 MB» al lado de «17,9 MB» se lee como precisión que no existe.
    assert.equal(pesoLegible(1024 * 1024), '1 MB');
  });
});
