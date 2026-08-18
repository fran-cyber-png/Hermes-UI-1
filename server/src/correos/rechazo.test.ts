import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarRechazo } from './rechazo.js';

/**
 * QUÉ PROTEGEN ESTOS TESTS.
 *
 * Dos cosas que se rompen de formas distintas: que **el diálogo SMTP no salga
 * hacia el navegador** (la cicatriz de los 20 sitios que devolvían el SQL de la
 * consulta al cliente) y que **un problema NUESTRO no se lea como un problema del
 * destinatario** (la vendedora corrige la dirección que estaba bien, reintenta
 * dos veces más y termina en «Hermes no anda»).
 *
 * Los textos de los casos NO son inventados: salen de mandar de verdad contra el
 * SES de producción el 17-ago-2026.
 */

/** El 554 literal que devolvió SES al mandar desde un dominio sin verificar. */
const NO_VERIFICADO =
  'Message failed: 554 Message rejected: Email address is not verified. The following identities ' +
  'failed the check in region US-EAST-1: prueba@gmail.com';

describe('lo que NUNCA puede llegar al navegador', () => {
  it('🔴 una credencial inválida no vuelca el diálogo SMTP', () => {
    const r = clasificarRechazo('Invalid login: 535 Authentication Credentials Invalid');
    assert.equal(r.clase, 'configuracion');
    assert.ok(!r.mensaje.includes('535'), 'no puede filtrarse el código SMTP');
    assert.ok(!/Invalid login/i.test(r.mensaje), 'no puede filtrarse el comando SMTP');
  });

  it('🔴 tampoco cuando el error trae el usuario y el host adentro', () => {
    const r = clasificarRechazo(
      'Invalid login: 535 Authentication Credentials Invalid · user=AKIAEJEMPLO host=email-smtp.us-east-1.amazonaws.com',
    );
    assert.equal(r.clase, 'configuracion');
    assert.ok(!/AKIA/.test(r.mensaje), 'no puede filtrarse el usuario');
    assert.ok(!/amazonaws/.test(r.mensaje), 'no puede filtrarse el host');
  });

  it('🔴 el 554 «is not verified» es NUESTRO remitente, no la dirección del lead', () => {
    // Es el que más fácil se clasifica mal: en casi cualquier otro servidor un 554
    // es un rechazo de destinatario. Leerlo así manda a corregir la caja correcta.
    const r = clasificarRechazo(NO_VERIFICADO);
    assert.equal(r.clase, 'configuracion');
    assert.ok(!r.mensaje.includes('prueba@gmail.com'));
    assert.equal(r.reintentable, false, 'reintentar no cambia una credencial');
  });
});

describe('lo que SÍ se muestra, porque es lo único que sirve', () => {
  it('un destinatario que no existe se muestra entero', () => {
    const crudo = '550 5.1.1 Requested action not taken: mailbox unavailable';
    const r = clasificarRechazo(crudo);
    assert.equal(r.clase, 'mensaje');
    assert.ok(r.mensaje.includes(crudo), 'sin el detalle, el 502 no dice nada que se pueda usar');
  });

  it('⚠️ un error DESCONOCIDO cae en la rama que muestra, no en la que calla', () => {
    // La asimetría es deliberada: un error nuestro que se vea feo una vez es más
    // barato que uno de destinatario que se calle siempre.
    const r = clasificarRechazo('algo rarísimo que nadie previó');
    assert.equal(r.clase, 'mensaje');
    assert.ok(r.mensaje.includes('algo rarísimo'));
  });

  it('un error vacío lo dice, no finge una explicación', () => {
    const r = clasificarRechazo('   ');
    assert.equal(r.clase, 'mensaje');
    assert.ok(r.mensaje.length > 0);
    assert.ok(!r.mensaje.endsWith(': '), 'no puede quedar una frase colgada');
  });
});

describe('el único caso donde reintentar sirve', () => {
  for (const crudo of [
    'Error: connect ETIMEDOUT 54.240.27.1:587',
    'Error: getaddrinfo ENOTFOUND email-smtp.us-east-1.amazonaws.com',
    'Connection closed unexpectedly (ECONNECTION)',
    '421 Service not available, closing transmission channel',
  ]) {
    it(`«${crudo.slice(0, 44)}…» es del canal y SÍ es reintentable`, () => {
      const r = clasificarRechazo(crudo);
      assert.equal(r.clase, 'canal');
      assert.equal(r.reintentable, true);
    });
  }

  it('⚠️ y ningún otro dice que sí: reintentar un rechazo del lead le manda dos correos si algún día sale', () => {
    for (const crudo of [NO_VERIFICADO, '550 mailbox unavailable', 'lo que sea']) {
      assert.equal(clasificarRechazo(crudo).reintentable, false, crudo);
    }
  });
});
