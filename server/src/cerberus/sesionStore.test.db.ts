import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { baseDePrueba } from '../pruebas/base.js';
import { crearSesionStore, sesionVigente, VIGENCIA_SESION_MS } from './sesionStore.js';

/**
 * EL PUNTO DE TODOS ESTOS TESTS ES EL REINICIO (#106, ADR 0027).
 *
 * «El server reinició» se simula con `crearSesionStore(db)` de nuevo sobre la
 * MISMA base: caché de proceso vacío, filas intactas. Eso es exactamente lo que
 * un deploy le hace a producción — y lo que antes deslogueaba a las tres
 * vendedoras a la vez.
 */

const SESION = { sessionid: 'abc123', csrftoken: 'tok456' };

test('la sesión cruza el reinicio: la guarda un proceso y la lee el siguiente', async (t) => {
  const db = await baseDePrueba(t);
  const antes = crearSesionStore(db);
  await antes.guardar('ana', SESION);

  const despues = crearSesionStore(db); // caché vacío = proceso nuevo
  assert.deepEqual(await despues.obtener('ana'), SESION);
});

test('a los 14 días venció: null para el proceso nuevo Y para el que la tenía en caché', async (t) => {
  const db = await baseDePrueba(t);
  let reloj = Date.UTC(2026, 6, 28, 12, 0, 0);
  const viejo = crearSesionStore(db, () => reloj);
  await viejo.guardar('ana', SESION);

  reloj += VIGENCIA_SESION_MS + 1;
  const nuevo = crearSesionStore(db, () => reloj);
  assert.equal(await nuevo.obtener('ana'), null);
  // El proceso que la guardó también la ve vencida: el caché no alarga la vida.
  assert.equal(await viejo.obtener('ana'), null);
});

test('un re-login pisa la sesión anterior, y el reinicio lee la nueva', async (t) => {
  const db = await baseDePrueba(t);
  const store = crearSesionStore(db);
  await store.guardar('ana', SESION);
  const renovada = { sessionid: 'zzz999', csrftoken: 'tok999' };
  await store.guardar('ana', renovada);

  assert.deepEqual(await crearSesionStore(db).obtener('ana'), renovada);
});

test('borrar la saca del caché y de la base', async (t) => {
  const db = await baseDePrueba(t);
  const store = crearSesionStore(db);
  await store.guardar('ana', SESION);
  await store.borrar('ana');

  assert.equal(await store.obtener('ana'), null);
  assert.equal(await crearSesionStore(db).obtener('ana'), null);
});

test('cada vendedora tiene la suya: obtener no cruza identidades', async (t) => {
  const db = await baseDePrueba(t);
  const store = crearSesionStore(db);
  await store.guardar('ana', SESION);
  assert.equal(await store.obtener('walter'), null);
});

test('sin la tabla migrada DEGRADA al Map de siempre: funciona en el proceso, no cruza el reinicio, y no revienta', async (t) => {
  const db = await baseDePrueba(t);
  await db.execute(sql`DROP TABLE sesiones_cerberus`);

  const store = crearSesionStore(db);
  await store.guardar('ana', SESION); // no tira: degrada y avisa por el log
  assert.deepEqual(await store.obtener('ana'), SESION); // el caché del proceso la sirve
  await store.borrar('ana');
  assert.equal(await store.obtener('ana'), null);

  await store.guardar('ana', SESION);
  // El comportamiento viejo, honesto: un proceso nuevo no la ve.
  assert.equal(await crearSesionStore(db).obtener('ana'), null);
});

test('sesionVigente: el borde exacto de los 14 días', () => {
  const t0 = 1_000;
  assert.equal(sesionVigente(t0, t0 + VIGENCIA_SESION_MS - 1), true);
  assert.equal(sesionVigente(t0, t0 + VIGENCIA_SESION_MS), false);
});
