import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { db } from '../db/client.js';
import { crearSesionStore, detalleSeguro, sesionVigente, VIGENCIA_SESION_MS } from './sesionStore.js';

/**
 * Los tests PUROS del store: la vigencia, la higiene del log y la carrera
 * lectura-lenta vs. re-login. Los que necesitan una Postgres de verdad (el
 * reinicio, el TTL contra filas reales, la degradación sin tabla) viven en
 * `sesionStore.test.db.ts`.
 */

test('sesionVigente: el borde exacto de los 14 días', () => {
  const t0 = 1_000;
  assert.equal(sesionVigente(t0, t0 + VIGENCIA_SESION_MS - 1), true);
  assert.equal(sesionVigente(t0, t0 + VIGENCIA_SESION_MS), false);
});

test('detalleSeguro NUNCA deja pasar los params al log — ahí viaja la cookie viva', () => {
  // La forma real del mensaje de drizzle: `Failed query: <sql>\nparams: <valores>`.
  const e = new Error(
    'Failed query: insert into "sesiones_cerberus" ("vendedora_id", "sesion", "guardada_en") values ($1, $2, $3)\n' +
      'params: ana,{"sessionid":"COOKIE_SECRETA","csrftoken":"TOKEN_SECRETO"},2026-07-28T18:00:00.000Z',
  );
  const d = detalleSeguro(e);
  assert.ok(!d.includes('COOKIE_SECRETA'), `filtró la cookie: ${d}`);
  assert.ok(!d.includes('params'), `dejó pasar los params: ${d}`);

  // Con código del driver en la causa, gana el código: dice QUÉ pasó (42P01 =
  // falta la migración, ECONNREFUSED = base caída) sin arrastrar contenido.
  const conCausa = new Error('Failed query: …\nparams: COOKIE_SECRETA');
  (conCausa as Error & { cause?: { code?: string } }).cause = { code: '42P01' };
  assert.equal(detalleSeguro(conCausa), '42P01');

  assert.equal(detalleSeguro('zas'), 'zas');
});

test('una lectura LENTA no pisa un re-login: la cookie nueva gana', async () => {
  // El escenario del deploy: proceso recién reiniciado (caché vacío), un
  // `obtener` dispara un SELECT lento; mientras viaja, la vendedora vuelve a
  // entrar (Django rotó su sessionid) y `guardar` escribe la nueva. La lectura
  // vieja llega DESPUÉS: si cacheara a ciegas, la cookie vieja quedaría pegada
  // 14 días y la vendedora no podría registrar ventas con `/yo` en `true`.
  type Fila = {
    vendedoraId: string;
    sesion: { sessionid: string; csrftoken: string };
    guardadaEn: Date;
  };
  const tabla = new Map<string, Fila>();
  let latenciaSelect = 0;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const baseFalsa = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            // READ COMMITTED: el snapshot se toma cuando ARRANCA el statement,
            // no cuando la respuesta llega al cliente.
            const snapshot = tabla.get('ana');
            await espera(latenciaSelect);
            return snapshot ? [snapshot] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Fila) => ({
        onConflictDoUpdate: async () => {
          tabla.set(v.vendedoraId, { ...v });
        },
      }),
    }),
    delete: () => ({ where: async () => {} }),
  } as unknown as typeof db;

  const store = crearSesionStore(baseFalsa);
  tabla.set('ana', {
    vendedoraId: 'ana',
    sesion: { sessionid: 'VIEJA', csrftoken: 'v' },
    guardadaEn: new Date(Date.now() - 60_000),
  });

  latenciaSelect = 30;
  const lecturaEnVuelo = store.obtener('ana');
  await espera(10);
  await store.guardar('ana', { sessionid: 'NUEVA', csrftoken: 'n' });
  await lecturaEnVuelo;

  latenciaSelect = 0;
  assert.equal((await store.obtener('ana'))?.sessionid, 'NUEVA');
});
