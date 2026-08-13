import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import express from 'express';
import { authRouter } from './auth.js';

/**
 * LA PUERTA DE `/api/auth/centurion` — el cableado, no la regla.
 *
 * Mismo criterio que `dashboard.test.db.ts`: `routes/auth.ts` importa el
 * singleton `db` (por eso `.test.db.ts` y no `.test.ts` — revienta al
 * importarse sin `DATABASE_URL`), que **no es** la base de este harness. Así
 * que el camino que SÍ toca la base —¿tiene línea asignada?, 403 vs. 200— NO
 * se puede probar acá: `lineasDeVendedora` ya tiene sus tests contra una base
 * de verdad en `numeros/repositorio.test.db.ts`. Lo que se prueba acá es todo
 * lo que la ruta rechaza ANTES de llegar a esa consulta.
 */

function firmarTokenCenturion(payload: Record<string, unknown>, secreto: string): string {
  const encabezado = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = createHmac('sha256', secreto).update(`${encabezado}.${cuerpo}`).digest('base64url');
  return `${encabezado}.${cuerpo}.${firma}`;
}

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

async function pedir(body: unknown): Promise<Respuesta> {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/auth/centurion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: resp.status, json };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('POST /centurion: sin CENTURION_SSO_SECRET, 503 — nunca un 401 que sugiera reintentar', async () => {
  const antes = process.env.CENTURION_SSO_SECRET;
  delete process.env.CENTURION_SSO_SECRET;
  try {
    const r = await pedir({ token: 'lo-que-sea' });
    assert.equal(r.status, 503);
    assert.equal(r.json?.type, 'sso_no_configurado');
  } finally {
    if (antes === undefined) delete process.env.CENTURION_SSO_SECRET;
    else process.env.CENTURION_SSO_SECRET = antes;
  }
});

test('POST /centurion: sin token en el body, 400', async () => {
  process.env.CENTURION_SSO_SECRET = 'secreto-de-prueba';
  const r = await pedir({});
  assert.equal(r.status, 400);
});

test('POST /centurion: un token que no verifica (firmado con otro secreto), 401 — nunca llega a mirar la base', async () => {
  process.env.CENTURION_SSO_SECRET = 'secreto-de-prueba';
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = firmarTokenCenturion({ sub: 'betto.romero', aud: 'hermes', exp }, 'secreto-equivocado');
  const r = await pedir({ token });
  assert.equal(r.status, 401);
});
