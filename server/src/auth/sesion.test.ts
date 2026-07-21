import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { firmarSesion, verificarSesion } from './sesion.js';

/**
 * El token es lo único que separa "la vendedora Ana" de "cualquiera que invente
 * un header". Si la firma se pudiera falsificar, alguien atribuiría envíos y
 * ventas a otra persona. Es la puerta, y tiene que cerrar bien.
 */

describe('sesión firmada', () => {
  test('un token válido devuelve el vendedoraId', () => {
    const token = firmarSesion('Usuario1');
    assert.equal(verificarSesion(token), 'Usuario1');
  });

  test('un token con la firma alterada se rechaza', () => {
    const token = firmarSesion('Usuario1');
    const [cuerpo] = token.split('.');
    const falsificado = `${cuerpo}.firmafalsa`;
    assert.equal(verificarSesion(falsificado), null);
  });

  test('un token con el cuerpo alterado (otro usuario) se rechaza', () => {
    // Alguien intenta cambiar el usuario del payload sin re-firmar.
    const token = firmarSesion('Usuario1');
    const [, firma] = token.split('.');
    const otroCuerpo = Buffer.from(`admin|${Date.now() + 100000}`).toString('base64url');
    assert.equal(verificarSesion(`${otroCuerpo}.${firma}`), null);
  });

  test('basura no es un token', () => {
    assert.equal(verificarSesion('cualquier-cosa'), null);
    assert.equal(verificarSesion(''), null);
    assert.equal(verificarSesion('a.b.c'), null);
  });
});
