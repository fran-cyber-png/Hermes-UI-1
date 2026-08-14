import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResultadoAuth, SesionCerberus } from '../cerberus/auth.js';
import { CODIGO_ERROR_CREDENCIALES, type ResultadoCredenciales } from '../centurion/credenciales.js';
import { resolverLogin, type DepsLogin, type ResultadoLogin } from './loginCascada.js';
import { MENSAJE_SIN_LINEA, type ResultadoCanje } from './sesionCenturion.js';

/**
 * LA CASCADA. Lo que se fija acá no es que ande el camino feliz: es el ORDEN, y
 * sobre todo **cuándo NO se le pregunta a Centurión**. Un test que solo mirara el
 * resultado dejaría pasar el defecto que importa —que la clave de una vendedora
 * de la Escuela salga hacia otro sistema porque Cerberus se cayó— porque en ese
 * caso el resultado es el mismo 503 con la consulta hecha o sin hacer.
 */

const USUARIO = 'luz';
const CLAVE = 'la-clave-que-nunca-se-loguea';
const MOTIVO_CERBERUS = 'usuario o contraseña incorrectos';

const SESION_CERBERUS: SesionCerberus = { sessionid: 'sid', csrftoken: 'csrf' };

/** Lo que hizo cada pata: existe para poder afirmar sobre lo que NO se llamó. */
interface Registro {
  centurionConsultado: string[];
  canjes: string[];
  sesionesGuardadas: string[];
}

interface Escenario {
  cerberus: ResultadoAuth;
  credenciales?: ResultadoCredenciales;
  canje?: ResultadoCanje;
  configurado?: boolean;
}

function armar(escenario: Escenario): { deps: DepsLogin; registro: Registro } {
  const registro: Registro = { centurionConsultado: [], canjes: [], sesionesGuardadas: [] };
  const deps: DepsLogin = {
    autenticar: async () => escenario.cerberus,
    guardarSesion: async (vendedoraId) => {
      registro.sesionesGuardadas.push(vendedoraId);
    },
    firmar: (vendedoraId) => `sesion-de-${vendedoraId}`,
    centurionConfigurado: () => escenario.configurado ?? true,
    pedirCredenciales: async (usuario) => {
      registro.centurionConsultado.push(usuario);
      return escenario.credenciales ?? { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.CREDENCIALES_INVALIDAS };
    },
    canjear: async (token) => {
      registro.canjes.push(token);
      return escenario.canje ?? { ok: false, motivo: 'token_invalido' };
    },
  };
  return { deps, registro };
}

const CERBERUS_OK: ResultadoAuth = {
  ok: true,
  vendedora: { id: USUARIO, nombre: USUARIO },
  sesion: SESION_CERBERUS,
};
const CERBERUS_RECHAZA: ResultadoAuth = { ok: false, motivo: MOTIVO_CERBERUS };
const CERBERUS_CAIDO: ResultadoAuth = { ok: false, motivo: 'Cerberus no responde en este momento.', caido: true };

/** Corre algo con la consola capturada: la cascada loguea, y el log también se audita. */
async function conConsolaCapturada<T>(fn: () => Promise<T>): Promise<{ valor: T; consola: string }> {
  const originales = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  const escrito: string[] = [];
  const anotar = (...args: unknown[]) => {
    for (const a of args) escrito.push(typeof a === 'string' ? a : String(a));
  };
  console.error = anotar;
  console.warn = anotar;
  console.log = anotar;
  console.info = anotar;
  try {
    const valor = await fn();
    return { valor, consola: escrito.join(' | ') };
  } finally {
    Object.assign(console, originales);
  }
}

// ── 1. Cerberus valida ──────────────────────────────────────────────────────

test('Cerberus valida: entra como siempre, guarda su sesión y NO se consulta a Centurión', async () => {
  const { deps, registro } = armar({ cerberus: CERBERUS_OK });
  const r = await resolverLogin(USUARIO, CLAVE, deps);

  assert.deepEqual(r, {
    ok: true,
    token: `sesion-de-${USUARIO}`,
    vendedora: { id: USUARIO, nombre: USUARIO },
  });
  assert.deepEqual(registro.sesionesGuardadas, [USUARIO], 'sin la cookie de Cerberus no puede registrar ventas');
  assert.deepEqual(registro.centurionConsultado, []);
  assert.deepEqual(registro.canjes, []);
});

// ── 2. Cerberus caído ───────────────────────────────────────────────────────

test('🔴 Cerberus CAÍDO: 503 y la clave NO sale hacia Centurión', async () => {
  const { deps, registro } = armar({ cerberus: CERBERUS_CAIDO });
  const r = await resolverLogin(USUARIO, CLAVE, deps);

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.estado, 503);
  assert.equal(r.ok === false && r.type, 'cerberus_caido');
  assert.deepEqual(registro.centurionConsultado, [], 'una caída de Cerberus no puede exportar la clave de una vendedora');
  assert.deepEqual(registro.canjes, []);
});

test('🔴 Cerberus caído corta la cascada AUNQUE las credenciales fueran buenas en Centurión', async () => {
  // El escenario que hace la diferencia visible: si el orden estuviera mal
  // —preguntar siempre, decidir después— esta persona ENTRARÍA, y el candado del
  // paso 2 se habría perdido sin que ningún test lo notara.
  const { deps, registro } = armar({
    cerberus: CERBERUS_CAIDO,
    credenciales: { ok: true, token: 'token-bueno' },
    canje: { ok: true, token: 'sesion', vendedora: { id: 'centurion:betto.romero', nombre: 'Betto' } },
  });
  const r = await resolverLogin('betto.romero', CLAVE, deps);

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.estado, 503);
  assert.deepEqual(registro.centurionConsultado, []);
});

// ── 3. Cerberus rechaza y Centurión valida ──────────────────────────────────

test('Cerberus rechaza y Centurión valida: entra, y el token que decide es el que se CANJEA', async () => {
  const { deps, registro } = armar({
    cerberus: CERBERUS_RECHAZA,
    credenciales: { ok: true, token: 'token-corto-de-handoff' },
    canje: {
      ok: true,
      token: 'sesion-de-hermes',
      vendedora: { id: 'centurion:betto.romero', nombre: 'Betto Romero' },
    },
  });
  const r = await resolverLogin('betto.romero', CLAVE, deps);

  assert.deepEqual(r, {
    ok: true,
    token: 'sesion-de-hermes',
    vendedora: { id: 'centurion:betto.romero', nombre: 'Betto Romero' },
  });
  assert.deepEqual(registro.centurionConsultado, ['betto.romero']);
  assert.deepEqual(registro.canjes, ['token-corto-de-handoff'], 'el 200 de Centurión no alcanza: se verifica la firma');
  assert.deepEqual(registro.sesionesGuardadas, [], 'no tiene cuenta en Cerberus: no hay cookie que guardar');
});

test('Centurión valida pero la persona no tiene línea asignada: 403, no 401', async () => {
  const { deps } = armar({
    cerberus: CERBERUS_RECHAZA,
    credenciales: { ok: true, token: 'token-corto' },
    canje: { ok: false, motivo: 'sin_linea_asignada' },
  });
  const r = await resolverLogin('betto.romero', CLAVE, deps);

  assert.equal(r.ok === false && r.estado, 403);
  assert.equal(r.ok === false && r.type, 'sin_linea_asignada');
  assert.equal(r.ok === false && r.message, MENSAJE_SIN_LINEA);
});

test('el token que Centurión devuelve pero no verifica en Hermes es 401 genérico, y hace ruido', async () => {
  const { deps } = armar({
    cerberus: CERBERUS_RECHAZA,
    credenciales: { ok: true, token: 'token-firmado-con-otro-secreto' },
    canje: { ok: false, motivo: 'token_invalido' },
  });
  const { valor, consola } = await conConsolaCapturada(() => resolverLogin('betto.romero', CLAVE, deps));

  assert.equal(valor.ok === false && valor.estado, 401);
  assert.equal(valor.ok === false && valor.message, MOTIVO_CERBERUS);
  assert.match(consola, /CENTURION_SSO_SECRET/, 'el 401 que ve la persona no explica nada: el log tiene que hacerlo');
});

// ── 4. Los dos rechazan ─────────────────────────────────────────────────────

test('los dos rechazan: 401 con el MISMO mensaje de siempre', async () => {
  const { deps, registro } = armar({
    cerberus: CERBERUS_RECHAZA,
    credenciales: { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.CREDENCIALES_INVALIDAS },
  });
  const r = await resolverLogin(USUARIO, CLAVE, deps);

  assert.deepEqual(r, { ok: false, estado: 401, message: MOTIVO_CERBERUS });
  assert.deepEqual(registro.centurionConsultado, [USUARIO]);
  assert.deepEqual(registro.canjes, [], 'sin token no hay nada que canjear');
});

test('🔴 los fallos de infraestructura de Centurión NO se distinguen del 401: no se enumera nada', async () => {
  const fallos = [
    CODIGO_ERROR_CREDENCIALES.TIMEOUT,
    CODIGO_ERROR_CREDENCIALES.RED,
    CODIGO_ERROR_CREDENCIALES.SERVICIO_NO_AUTORIZADO,
    CODIGO_ERROR_CREDENCIALES.SSO_NO_CONFIGURADO,
    CODIGO_ERROR_CREDENCIALES.RESPUESTA_INVALIDA,
    CODIGO_ERROR_CREDENCIALES.HTTP_INESPERADO,
    CODIGO_ERROR_CREDENCIALES.FALTA_CONFIG,
  ] as const;

  for (const codigo of fallos) {
    const { deps } = armar({ cerberus: CERBERUS_RECHAZA, credenciales: { ok: false, codigo } });
    const r = await resolverLogin(USUARIO, CLAVE, deps);
    assert.deepEqual(r, { ok: false, estado: 401, message: MOTIVO_CERBERUS }, `se filtró el motivo con ${codigo}`);
  }
});

// ── 5. Sin configuración ────────────────────────────────────────────────────

test('🔴 sin el login directo configurado, el rechazo de Cerberus NO consulta a Centurión', async () => {
  const { deps, registro } = armar({
    cerberus: CERBERUS_RECHAZA,
    configurado: false,
    credenciales: { ok: true, token: 'no-deberia-pedirse' },
  });
  const r = await resolverLogin(USUARIO, CLAVE, deps);

  assert.deepEqual(r, { ok: false, estado: 401, message: MOTIVO_CERBERUS });
  assert.deepEqual(registro.centurionConsultado, [], 'el Hermes de la Escuela se comporta igual que antes de este frente');
  assert.deepEqual(registro.canjes, []);
});

// ── El borde de entrada ─────────────────────────────────────────────────────

test('sin usuario o sin clave: 400 antes de tocar nada', async () => {
  const casos: [unknown, unknown][] = [
    ['', CLAVE],
    [USUARIO, ''],
    [undefined, undefined],
    [123, CLAVE],
    [USUARIO, { toString: () => CLAVE }],
  ];
  for (const [u, p] of casos) {
    const { deps, registro } = armar({ cerberus: CERBERUS_OK });
    const r = await resolverLogin(u, p, deps);
    assert.equal(r.ok === false && r.estado, 400, `no rechazó ${JSON.stringify(u)} / ${typeof p}`);
    assert.deepEqual(registro.centurionConsultado, []);
    assert.deepEqual(registro.sesionesGuardadas, []);
  }
});

// ── La contraseña ───────────────────────────────────────────────────────────

test('🔴 la contraseña no aparece en el log ni en la respuesta de NINGÚN desenlace', async () => {
  const escenarios: Escenario[] = [
    { cerberus: CERBERUS_OK },
    { cerberus: CERBERUS_CAIDO },
    { cerberus: CERBERUS_RECHAZA, configurado: false },
    { cerberus: CERBERUS_RECHAZA, credenciales: { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.CREDENCIALES_INVALIDAS } },
    { cerberus: CERBERUS_RECHAZA, credenciales: { ok: true, token: 't' }, canje: { ok: false, motivo: 'token_invalido' } },
    {
      cerberus: CERBERUS_RECHAZA,
      credenciales: { ok: true, token: 't' },
      canje: { ok: false, motivo: 'sin_linea_asignada' },
    },
    {
      cerberus: CERBERUS_RECHAZA,
      credenciales: { ok: true, token: 't' },
      canje: { ok: true, token: 's', vendedora: { id: 'centurion:betto.romero', nombre: 'Betto' } },
    },
  ];

  const respuestas: ResultadoLogin[] = [];
  for (const escenario of escenarios) {
    const { deps } = armar(escenario);
    const { valor, consola } = await conConsolaCapturada(() => resolverLogin(USUARIO, CLAVE, deps));
    respuestas.push(valor);
    assert.ok(!consola.includes(CLAVE), `la contraseña se filtró al log: ${consola}`);
  }
  assert.ok(!JSON.stringify(respuestas).includes(CLAVE), 'la contraseña se filtró a una respuesta');
  assert.equal(respuestas.length, escenarios.length);
});
