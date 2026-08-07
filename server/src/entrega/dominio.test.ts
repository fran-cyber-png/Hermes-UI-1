import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { avanzarEstado, estadoDeCloudApi, estadoDeWhatsmeow } from './dominio.js';

describe('avanzarEstado — la escala es MONÓTONA', () => {
  test('avanza cuando corresponde', () => {
    assert.equal(avanzarEstado(null, 'enviado'), 'enviado');
    assert.equal(avanzarEstado('enviado', 'entregado'), 'entregado');
    assert.equal(avanzarEstado('entregado', 'leido'), 'leido');
  });

  test('🔴 NUNCA retrocede: los recibos llegan desordenados', () => {
    // Un `delivered` de un segundo dispositivo puede llegar DESPUÉS del `read`.
    // Con «gana el último», un mensaje leído volvería a verse como solo
    // entregado — y la vendedora leería que el lead no lo vio.
    assert.equal(avanzarEstado('leido', 'entregado'), 'leido');
    assert.equal(avanzarEstado('leido', 'enviado'), 'leido');
    assert.equal(avanzarEstado('entregado', 'enviado'), 'entregado');
  });

  test('repetir el mismo estado no lo mueve (los webhooks reintentan)', () => {
    assert.equal(avanzarEstado('leido', 'leido'), 'leido');
    assert.equal(avanzarEstado('entregado', 'entregado'), 'entregado');
  });

  test('🔴 `fallido` gana siempre, y no se resucita', () => {
    // Meta lo rechazó: no llegó, por más recibos que hayan pasado antes. Y un
    // recibo viejo que aparece después no lo devuelve a la vida.
    assert.equal(avanzarEstado('leido', 'fallido'), 'fallido');
    assert.equal(avanzarEstado('fallido', 'leido'), 'fallido');
    assert.equal(avanzarEstado('fallido', 'entregado'), 'fallido');
  });
});

describe('estadoDeCloudApi', () => {
  test('los cuatro que Meta manda', () => {
    assert.equal(estadoDeCloudApi('sent'), 'enviado');
    assert.equal(estadoDeCloudApi('delivered'), 'entregado');
    assert.equal(estadoDeCloudApi('read'), 'leido');
    assert.equal(estadoDeCloudApi('failed'), 'fallido');
  });

  test('un estado que Meta agregue mañana se IGNORA, no rompe el webhook', () => {
    assert.equal(estadoDeCloudApi('deleted'), null);
    assert.equal(estadoDeCloudApi(undefined), null);
    assert.equal(estadoDeCloudApi(null), null);
  });
});

describe('estadoDeWhatsmeow', () => {
  test('🔴 la CADENA VACÍA es «entregado», no «desconocido»', () => {
    // `ReceiptTypeDelivered = ""` en whatsmeow (verificado contra
    // go.mau.fi/whatsmeow/types). Tratarla como desconocida perdería TODOS los
    // entregados — el ✓✓ gris, que es el estado más frecuente de todos.
    assert.equal(estadoDeWhatsmeow(''), 'entregado');
    assert.equal(estadoDeWhatsmeow(undefined), 'entregado');
    assert.equal(estadoDeWhatsmeow(null), 'entregado');
  });

  test('leído y escuchado', () => {
    assert.equal(estadoDeWhatsmeow('read'), 'leido');
    // Un audio escuchado implica que lo abrió.
    assert.equal(estadoDeWhatsmeow('played'), 'leido');
  });

  test('🔴 `read-self` NO es del destinatario: es OTRO dispositivo tuyo', () => {
    // Contarlo como «lo leyó» pintaría el ✓✓ azul porque la vendedora abrió su
    // propio WhatsApp en el celular.
    assert.equal(estadoDeWhatsmeow('read-self'), null);
    assert.equal(estadoDeWhatsmeow('played-self'), null);
  });

  test('los de protocolo no dicen nada sobre la entrega', () => {
    for (const t of ['sender', 'retry', 'inactive', 'peer_msg', 'hist_sync']) {
      assert.equal(estadoDeWhatsmeow(t), null, `${t} no debería mover el estado`);
    }
  });

  test('un error del server sí es un fallo', () => {
    assert.equal(estadoDeWhatsmeow('server-error'), 'fallido');
  });
});

describe('los dos canales, la misma escala', () => {
  test('lo que uno llama `delivered` y el otro `\'\'` terminan igual', () => {
    assert.equal(estadoDeCloudApi('delivered'), estadoDeWhatsmeow(''));
    assert.equal(estadoDeCloudApi('read'), estadoDeWhatsmeow('read'));
    assert.equal(estadoDeCloudApi('failed'), estadoDeWhatsmeow('server-error'));
  });

  test('una secuencia desordenada converge al mismo lugar por los dos', () => {
    // La propiedad que importa: el estado final no depende del ORDEN de llegada.
    const porNube = ['read', 'delivered', 'sent']
      .map(estadoDeCloudApi)
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .reduce<ReturnType<typeof avanzarEstado> | null>((acc, e) => avanzarEstado(acc, e), null);
    const porMeow = ['read', '', 'sender']
      .map(estadoDeWhatsmeow)
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .reduce<ReturnType<typeof avanzarEstado> | null>((acc, e) => avanzarEstado(acc, e), null);
    assert.equal(porNube, 'leido');
    assert.equal(porMeow, 'leido');
  });
});
