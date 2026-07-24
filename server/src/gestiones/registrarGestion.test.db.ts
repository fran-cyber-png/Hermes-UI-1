import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarConversionWa, sembrarInteres } from '../pruebas/sembrar.js';
import { registrarGestion, type EntradaGestion } from './registrarGestion.js';

/**
 * LAS COMPUERTAS DEL EMBUDO, FIJADAS COMO COMPORTAMIENTO (#60): contra una
 * Postgres de verdad (ADR 0008), el seam inyectable rechaza lo que la UI no
 * puede evitar con modales — a Cotizado sin interés no se pasa; a Cierre solo
 * se llega con la venta registrada. Los modales del Pipeline SATISFACEN estas
 * compuertas, y estos tests garantizan que nadie las relaje sin darse cuenta.
 */

const CLAVE = 'conv:whatsapp:51900000000:51999999999';

function entrada(sobre: Partial<EntradaGestion> = {}): EntradaGestion {
  return {
    vendedoraId: 'vendedora-prueba',
    clave: CLAVE,
    canal: 'whatsapp',
    personaId: '51900000000',
    personaNombre: 'Lead de prueba',
    numeroPropio: '51999999999',
    etapa: 'contactado',
    proximaAccion: null,
    proximaFecha: null,
    notas: null,
    ...sobre,
  };
}

async function cuantasGestiones(db: Awaited<ReturnType<typeof baseDePrueba>>): Promise<number> {
  const [fila] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM gestiones`);
  return fila.n;
}

test('COMPUERTA 1: a cotizado SIN interés no se pasa — y no queda gestión fantasma', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarGestion(db, entrada({ etapa: 'cotizado' }));

  assert.equal(r.ok, false, 'la compuerta tiene que rechazar');
  assert.match((r as { message: string }).message, /interés/i);
  assert.equal(await cuantasGestiones(db), 0, 'el rechazo no inserta nada');
});

test('COMPUERTA 1: con un interés registrado, cotizado pasa y la gestión queda', async (t) => {
  const db = await baseDePrueba(t);
  await sembrarInteres(db, { clave: CLAVE, curso: 'Oratoria para Políticos' });

  const r = await registrarGestion(db, entrada({ etapa: 'cotizado' }));

  assert.equal(r.ok, true);
  const [fila] = await db.execute<{ etapa: string; clave: string }>(
    sql`SELECT etapa, clave FROM gestiones`,
  );
  assert.equal(fila.etapa, 'cotizado');
  assert.equal(fila.clave, CLAVE);
});

test('COMPUERTA 2: a cierre SIN venta registrada no se pasa — el cierre se gana', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarGestion(db, entrada({ etapa: 'cierre' }));

  assert.equal(r.ok, false, 'la compuerta tiene que rechazar');
  assert.match((r as { message: string }).message, /venta/i);
  assert.equal(await cuantasGestiones(db), 0);
});

test('COMPUERTA 2: con la conversión registrada para ese teléfono, cierre pasa', async (t) => {
  const db = await baseDePrueba(t);
  // El teléfono sale de la CLAVE de la conversación (conv:whatsapp:<tel>:…).
  await sembrarConversionWa(db, { telefono: '51900000000' });

  const r = await registrarGestion(db, entrada({ etapa: 'cierre' }));

  assert.equal(r.ok, true);
  const [fila] = await db.execute<{ etapa: string }>(sql`SELECT etapa FROM gestiones`);
  assert.equal(fila.etapa, 'cierre');
});

test('las etapas sin compuerta insertan directo — y la próxima acción con fecha cae en la Agenda', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarGestion(
    db,
    entrada({ etapa: 'contactado', proximaAccion: 'llamada', proximaFecha: new Date('2026-08-01T15:00:00Z'), notas: 'quedó en pensarlo' }),
  );

  assert.equal(r.ok, true);
  assert.equal(await cuantasGestiones(db), 1);
  const [rec] = await db.execute<{ nota: string; clave: string }>(
    sql`SELECT nota, clave FROM recordatorios`,
  );
  assert.equal(rec.clave, CLAVE, 'la promesa con fecha va derecho a la Agenda');
  assert.match(rec.nota, /Llamada/);
});
