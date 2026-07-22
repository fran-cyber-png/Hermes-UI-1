import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "./base.js";
import { sembrarMensaje } from "./sembrar.js";

/**
 * TEST DE HUMO del harness (#33): prueba que la maquinaria funciona, no un
 * comportamiento de producto. Es el ejemplo vivo de cómo se escribe un
 * `*.test.db.ts` — ver CLAUDE.md §Tests con base.
 */

test("el harness levanta una base aislada, con la extensión vector y el schema aplicado", async (t) => {
  const db = await baseDePrueba(t);

  const [uno] = await db.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
  assert.equal(uno.ok, 1);

  // La extensión llega por TEMPLATE (se creó una vez en montarBase.ts).
  const ext = await db.execute<{ extname: string }>(
    sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
  );
  assert.equal(ext.length, 1, "la extensión vector tiene que venir del template");

  // El schema del template está aplicado: las tablas caliente existen.
  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_name IN ('events', 'interactions', 'recordatorios')`,
  );
  assert.equal(n, 3, "el schema del template tiene que estar aplicado");
});

test("cada test corre en su propia base: nace vacía y lo sembrado se lee", async (t) => {
  const db = await baseDePrueba(t);

  const [vacio] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM interactions`);
  assert.equal(vacio.n, 0, "la base nace vacía — sin fugas de otro test");

  await sembrarMensaje(db, { personaId: "51988", texto: "hola, quiero info" });

  const [uno] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM interactions`);
  assert.equal(uno.n, 1);
});
