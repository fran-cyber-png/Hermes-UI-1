import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { verificarSesion } from './sesion.js';
import { canjearTokenDeCenturion, MENSAJE_SIN_LINEA } from './sesionCenturion.js';

/**
 * EL CANJE COMPARTIDO. Vale para las dos puertas (`/login` y `/centurion`), así
 * que lo que se fija acá vale para las dos por construcción — que es justamente
 * el motivo de que exista este módulo.
 */

const SECRETO = 'secreto-de-prueba';

function firmarTokenCenturion(payload: Record<string, unknown>, secreto = SECRETO): string {
  const encabezado = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = createHmac('sha256', secreto).update(`${encabezado}.${cuerpo}`).digest('base64url');
  return `${encabezado}.${cuerpo}.${firma}`;
}

function tokenDe(usuario: string, extra: Record<string, unknown> = {}, secreto = SECRETO): string {
  return firmarTokenCenturion(
    { sub: usuario, aud: 'hermes', exp: Math.floor(Date.now() / 1000) + 60, ...extra },
    secreto,
  );
}

/** Recuerda a quién se le preguntó por líneas: sirve para afirmar que NO se preguntó. */
function conLineas(lineas: string[]) {
  const consultas: string[] = [];
  return {
    consultas,
    buscar: async (vendedoraId: string) => {
      consultas.push(vendedoraId);
      return lineas;
    },
  };
}

test('token válido y con línea asignada: emite sesión de Hermes con el id namespaced', async () => {
  process.env.CENTURION_SSO_SECRET = SECRETO;
  const lineas = conLineas(['51984429504']);

  const r = await canjearTokenDeCenturion(tokenDe('betto.romero', { nombre: 'Betto Romero' }), lineas.buscar);

  assert.equal(r.ok, true);
  assert.equal(r.ok && r.vendedora.id, 'centurion:betto.romero');
  assert.equal(r.ok && r.vendedora.nombre, 'Betto Romero');
  assert.deepEqual(lineas.consultas, ['centurion:betto.romero'], 'la línea se busca por el id namespaced, no por el crudo');
  // La sesión emitida es una sesión de Hermes de verdad, no una cadena cualquiera.
  assert.equal(r.ok && verificarSesion(r.token), 'centurion:betto.romero');
});

test('sin nombre en el token, se saluda con el usuario', async () => {
  process.env.CENTURION_SSO_SECRET = SECRETO;
  const lineas = conLineas(['51984429504']);
  const r = await canjearTokenDeCenturion(tokenDe('betto.romero'), lineas.buscar);
  assert.equal(r.ok && r.vendedora.nombre, 'betto.romero');
});

test('🔴 verificó pero no tiene línea asignada: se rechaza, no se emite sesión', async () => {
  process.env.CENTURION_SSO_SECRET = SECRETO;
  const lineas = conLineas([]);

  const r = await canjearTokenDeCenturion(tokenDe('ajeno.total'), lineas.buscar);

  assert.deepEqual(r, { ok: false, motivo: 'sin_linea_asignada' });
  assert.match(MENSAJE_SIN_LINEA, /línea de WhatsApp/);
});

test('🔴 un token que no verifica no llega a mirar la base', async () => {
  process.env.CENTURION_SSO_SECRET = SECRETO;
  const lineas = conLineas(['51984429504']);

  const otroSecreto = await canjearTokenDeCenturion(tokenDe('betto.romero', {}, 'secreto-equivocado'), lineas.buscar);
  const vencido = await canjearTokenDeCenturion(
    tokenDe('betto.romero', { exp: Math.floor(Date.now() / 1000) - 1 }),
    lineas.buscar,
  );
  const otraAudiencia = await canjearTokenDeCenturion(tokenDe('betto.romero', { aud: 'otra-cosa' }), lineas.buscar);
  const basura = await canjearTokenDeCenturion('no-es-un-jwt', lineas.buscar);

  for (const r of [otroSecreto, vencido, otraAudiencia, basura]) {
    assert.deepEqual(r, { ok: false, motivo: 'token_invalido' });
  }
  assert.deepEqual(lineas.consultas, [], 'ni una consulta: la firma se juzga antes que nada');
});

test('sin CENTURION_SSO_SECRET no se canjea nada, ni con un token bien formado', async () => {
  const antes = process.env.CENTURION_SSO_SECRET;
  const token = tokenDe('betto.romero');
  delete process.env.CENTURION_SSO_SECRET;
  try {
    const lineas = conLineas(['51984429504']);
    const r = await canjearTokenDeCenturion(token, lineas.buscar);
    assert.deepEqual(r, { ok: false, motivo: 'token_invalido' });
    assert.deepEqual(lineas.consultas, []);
  } finally {
    if (antes === undefined) delete process.env.CENTURION_SSO_SECRET;
    else process.env.CENTURION_SSO_SECRET = antes;
  }
});
