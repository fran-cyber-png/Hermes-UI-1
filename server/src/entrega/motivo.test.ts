import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { motivoDeCloudApi } from './motivo.js';

/**
 * El payload REAL de Meta para el caso que motivó el frente: la ventana de 24 h
 * cerrada. Copiado de la doc de errores de la Cloud API, con la forma exacta con
 * la que viaja dentro de `value.statuses[]`.
 *
 * Vive como fixture y no inline porque es el contrato con un sistema de afuera:
 * el día que Meta le cambie la forma, lo que tiene que ponerse rojo es ESTO.
 */
const VENTANA_CERRADA = [
  {
    code: 131047,
    title: 'Re-engagement message',
    message: 'Re-engagement message',
    error_data: {
      details:
        'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
    },
    href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/',
  },
];

describe('motivoDeCloudApi — lo que Meta dijo, y hasta hoy se tiraba', () => {
  test('el caso que motivó el frente: la ventana de 24 h', () => {
    const m = motivoDeCloudApi(VENTANA_CERRADA);
    assert.equal(m?.codigo, '131047');
    assert.match(m?.detalle ?? '', /more than 24 hours/);
  });

  test('🔴 el código se guarda como TEXTO aunque Meta lo mande como número', () => {
    // La columna es `text` y el front compara contra `'131047'`. Un número
    // colándose acá haría que la comparación del diccionario falle sin un solo
    // error: el motivo existiría en la base y la burbuja diría «no se pudo saber».
    const m = motivoDeCloudApi([{ code: 131026, title: 'Receiver incapable' }]);
    assert.equal(m?.codigo, '131026');
    assert.equal(typeof m?.codigo, 'string');
  });

  test('🔴 el detalle prefiere `error_data.details`, que es el que dice algo', () => {
    // `title` es una etiqueta corta y ambigua («Re-engagement message») y no
    // alcanza para entender un código que todavía no está en el diccionario.
    // Si gana el título, la auditoría queda igual de muda que antes del frente.
    assert.equal(motivoDeCloudApi(VENTANA_CERRADA)?.detalle?.startsWith('Message failed'), true);
  });

  test('cae a `message` y después a `title` cuando no hay `details`', () => {
    assert.equal(motivoDeCloudApi([{ code: 1, message: 'algo' }])?.detalle, 'algo');
    assert.equal(motivoDeCloudApi([{ code: 1, title: 'otra cosa' }])?.detalle, 'otra cosa');
  });

  test('sin errores no hay motivo — y eso NO es un motivo vacío', () => {
    // Un objeto con los dos campos en `null` se vería en la base como «Meta
    // explicó algo», que es falso. Los recibos de whatsmeow entran por acá.
    for (const vacio of [undefined, null, [], {}, 'no soy un arreglo', [null], [{}]]) {
      assert.equal(motivoDeCloudApi(vacio), null);
    }
  });

  test('un código sin detalle (y al revés) igual se guarda', () => {
    assert.deepEqual(motivoDeCloudApi([{ code: 470 }]), { codigo: '470', detalle: null });
    assert.deepEqual(motivoDeCloudApi([{ message: 'sin código' }]), {
      codigo: null,
      detalle: 'sin código',
    });
  });

  test('el detalle se recorta: es prosa de un sistema ajeno, sin techo propio', () => {
    const largo = motivoDeCloudApi([{ code: 1, message: 'x'.repeat(5000) }]);
    assert.equal(largo?.detalle?.length, 300);
  });

  test('un detalle en blanco no cuenta como detalle', () => {
    assert.deepEqual(motivoDeCloudApi([{ code: 1, message: '   ' }]), {
      codigo: '1',
      detalle: null,
    });
  });
});
