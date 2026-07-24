import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { leadDeTelefono } from "../gente/leadDeTelefono.js";
import { ingestarLote, ICARUS_SOURCE } from "./ingestor.js";
import type { SubmissionIcarus } from "./mapeo.js";

/**
 * INGESTA ICARUS con base (#114) — la escritura idempotente al event store +
 * `leads`, contra una Postgres efímera (ADR 0008). El mapeo puro se prueba en
 * `mapeo.test.ts`; acá se fija el CABLEADO: que reprocesar no duplique, que las
 * filas sin contacto se cuenten como descartadas, y que el seam de la ficha
 * (#113) levante el lead de icarus por teléfono.
 */

function submission(over: Partial<SubmissionIcarus> = {}): SubmissionIcarus {
  return {
    id: 100,
    contact_id: 9,
    product_id: 1,
    source: "instagram",
    source_detail: "reel-julio",
    form_name: "Formulario Diplomado",
    landing_page: "diplomado-gestion-publica",
    product_name: "Diplomado en Gestión Pública",
    raw_product_name: "DIPLO GP",
    name: "María Quispe",
    email: "maria@example.com",
    phone: "+51 987 654 321",
    country: "PE",
    ocupacion: "Regidora",
    payload: { utm: "x" },
    submitted_at: new Date("2026-06-15T14:30:00Z"),
    created_at: new Date("2026-06-15T14:31:00Z"),
    ...over,
  };
}

async function contarLeads(db: Awaited<ReturnType<typeof baseDePrueba>>): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM leads`);
  return row.n;
}

test("ingesta dos submissions válidas y descarta la que no tiene contacto", async (t) => {
  const db = await baseDePrueba(t);

  const resumen = await ingestarLote(db, [
    submission({ id: 100 }),
    submission({ id: 101, phone: "+51 900 111 222", email: null }),
    submission({ id: 102, phone: null, email: null }), // sin contacto → descartada
  ]);

  assert.deepEqual(resumen, { leidos: 3, insertados: 2, yaEstaban: 0, descartados: 1 });
  assert.equal(await contarLeads(db), 2);

  // El evento crudo queda bajo el source de icarus, con el external_id namespaced.
  const [ev] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM events WHERE source = ${ICARUS_SOURCE} AND external_id = 'icarus:100'`,
  );
  assert.equal(ev.n, 1);
});

test("reprocesar el mismo lote es idempotente: nada se duplica", async (t) => {
  const db = await baseDePrueba(t);
  const lote = [submission({ id: 200 }), submission({ id: 201, email: "otra@example.com" })];

  const primera = await ingestarLote(db, lote);
  assert.deepEqual(primera, { leidos: 2, insertados: 2, yaEstaban: 0, descartados: 0 });

  const segunda = await ingestarLote(db, lote);
  assert.deepEqual(segunda, { leidos: 2, insertados: 0, yaEstaban: 2, descartados: 0 });

  assert.equal(await contarLeads(db), 2, "reprocesar no agrega filas");
});

test("el lead de icarus lo levanta el seam de la ficha (#113) por teléfono, marcado como 'web'", async (t) => {
  const db = await baseDePrueba(t);

  await ingestarLote(db, [
    submission({
      id: 300,
      phone: "+51 987 654 321",
      email: "lead.web@example.com",
      product_name: "Curso de Oratoria",
      form_name: "Landing Oratoria",
    }),
  ]);

  // La conversación abierta trae el mismo número en otro formato: el seam matchea
  // por el sufijo de 9 dígitos, así que igual lo encuentra.
  const mapa = await leadDeTelefono(db, ["51987654321"]);
  const derivado = mapa["51987654321"];

  assert.ok(derivado, "el teléfono de la conversación matchea el lead de icarus");
  assert.equal(derivado.email, "lead.web@example.com");
  assert.equal(derivado.campana, "Curso de Oratoria");
  assert.equal(derivado.formulario, "icarus:Landing Oratoria");
  assert.equal(derivado.fuente, "web");
});
