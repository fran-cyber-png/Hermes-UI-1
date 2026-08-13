import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { ssoDeCenturionConfigurado, vendedoraIdDeCenturion, verificarTokenCenturion } from './centurion.js';

/**
 * Firma un token IGUAL que lo haría Centurión (`service-token.ts` del otro
 * repo, pero para una persona en vez de una candidatura): HS256 a mano, sin
 * librería, para no atar el test a una dependencia que este server no trae.
 */
function firmar(payload: Record<string, unknown>, secreto: string, alg = 'HS256'): string {
  const encabezado = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = createHmac('sha256', secreto).update(`${encabezado}.${cuerpo}`).digest('base64url');
  return `${encabezado}.${cuerpo}.${firma}`;
}

const SECRETO = 'secreto-de-prueba-centurion';
const VENCE_EN_UN_MINUTO = Math.floor(Date.now() / 1000) + 60;

function tokenValido(extra: Record<string, unknown> = {}): string {
  return firmar({ sub: 'betto', nombre: 'Betto Barrionuevo', aud: 'hermes', exp: VENCE_EN_UN_MINUTO, ...extra }, SECRETO);
}

describe('SSO de Centurión', () => {
  beforeEach(() => {
    process.env.CENTURION_SSO_SECRET = SECRETO;
  });
  afterEach(() => {
    delete process.env.CENTURION_SSO_SECRET;
  });

  test('un token válido, bien firmado, devuelve la identidad', () => {
    const identidad = verificarTokenCenturion(tokenValido());
    assert.deepEqual(identidad, { usuario: 'betto', nombre: 'Betto Barrionuevo', candidatura: null });
  });

  test('sin CENTURION_SSO_SECRET configurada, NADA valida — ni por accidente', () => {
    delete process.env.CENTURION_SSO_SECRET;
    assert.equal(ssoDeCenturionConfigurado(), false);
    assert.equal(verificarTokenCenturion(tokenValido()), null);
  });

  test('firmado con otro secreto (no el de Hermes) se rechaza', () => {
    const token = firmar({ sub: 'betto', aud: 'hermes', exp: VENCE_EN_UN_MINUTO }, 'secreto-equivocado');
    assert.equal(verificarTokenCenturion(token), null);
  });

  test('🔴 el secreto del CORE de Centurión (JWT_SECRET) tampoco sirve acá', () => {
    // Es el escenario que el docblock de centurion.ts existe para evitar: si
    // alguien reutilizara el secreto del core, cualquier JWT de Centurión (de
    // OTRO propósito) colaría como login de Hermes.
    const token = firmar({ sub: 'betto', aud: 'hermes', exp: VENCE_EN_UN_MINUTO }, 'jwt-secret-del-core-de-centurion');
    assert.equal(verificarTokenCenturion(token), null);
  });

  test('un token vencido se rechaza', () => {
    const vencido = firmar({ sub: 'betto', aud: 'hermes', exp: Math.floor(Date.now() / 1000) - 10 }, SECRETO);
    assert.equal(verificarTokenCenturion(vencido), null);
  });

  test('la audiencia equivocada (un token de otro propósito) se rechaza', () => {
    const otraAudiencia = firmar({ sub: 'betto', aud: 'svc-mensajeria', exp: VENCE_EN_UN_MINUTO }, SECRETO);
    assert.equal(verificarTokenCenturion(otraAudiencia), null);
  });

  test('sin exp, o exp que no es número, se rechaza (nunca "no vence")', () => {
    assert.equal(verificarTokenCenturion(firmar({ sub: 'betto', aud: 'hermes' }, SECRETO)), null);
    assert.equal(verificarTokenCenturion(firmar({ sub: 'betto', aud: 'hermes', exp: 'nunca' }, SECRETO)), null);
  });

  test('sin sub (o vacío) se rechaza: no hay identidad que asumir', () => {
    assert.equal(verificarTokenCenturion(firmar({ aud: 'hermes', exp: VENCE_EN_UN_MINUTO }, SECRETO)), null);
    assert.equal(verificarTokenCenturion(firmar({ sub: '', aud: 'hermes', exp: VENCE_EN_UN_MINUTO }, SECRETO)), null);
  });

  test('un alg distinto de HS256 se rechaza', () => {
    const token = firmar({ sub: 'betto', aud: 'hermes', exp: VENCE_EN_UN_MINUTO }, SECRETO, 'none');
    assert.equal(verificarTokenCenturion(token), null);
  });

  test('el cuerpo alterado sin re-firmar se rechaza (mismo ataque que sesion.test.ts)', () => {
    const token = tokenValido();
    const [encabezado, , firma] = token.split('.');
    const otroCuerpo = Buffer.from(JSON.stringify({ sub: 'admin', aud: 'hermes', exp: VENCE_EN_UN_MINUTO })).toString(
      'base64url',
    );
    assert.equal(verificarTokenCenturion(`${encabezado}.${otroCuerpo}.${firma}`), null);
  });

  test('basura no es un token', () => {
    assert.equal(verificarTokenCenturion('cualquier-cosa'), null);
    assert.equal(verificarTokenCenturion(''), null);
    assert.equal(verificarTokenCenturion('a.b.c'), null);
  });

  test('la identidad de Hermes va namespaced: nunca choca con un username de Cerberus', () => {
    assert.equal(vendedoraIdDeCenturion('betto'), 'centurion:betto');
  });
});
