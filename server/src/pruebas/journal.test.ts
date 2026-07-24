import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * LA GUARDIA DEL JOURNAL — el fallo que rompe producción SIN hacer ruido.
 *
 * `_journal.json` es el índice de migraciones de drizzle. El campo `when` es un
 * contador monótono: si una migración nueva queda con un `when` MENOR al máximo ya
 * aplicado, drizzle la considera vieja y la SALTEA en silencio. No hay error, no hay
 * log: el deploy sale verde y la tabla nunca se creó. Es el modo de falla que la
 * skill `goberna-migrate` documenta como responsable de tres incidentes.
 *
 * Pasa fácil: dos ramas generan una migración cada una, se mergean, y la segunda en
 * mergear tiene el `when` más chico. Por eso el helper `goberna-journal-set-when`
 * existe — y por eso esto corre en CI, que es el único lugar donde se ven las dos.
 *
 * Es un test PURO (no toca la base): entra en `npm test` y falla en segundos.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

type Entrada = { idx: number; when: number; tag: string; version: string };

function leerJournal(): Entrada[] {
  const journal = JSON.parse(readFileSync(join(DIR, "meta/_journal.json"), "utf8")) as {
    entries: Entrada[];
  };
  return journal.entries;
}

test("el journal tiene al menos el baseline", () => {
  assert.ok(leerJournal().length > 0, "el journal está vacío: ¿se borró drizzle/meta?");
});

test("los idx son consecutivos desde 0, sin huecos ni repetidos", () => {
  const idxs = leerJournal()
    .map((e) => e.idx)
    .sort((a, b) => a - b);
  for (const [i, idx] of idxs.entries()) {
    assert.equal(
      idx,
      i,
      `idx ${idx} donde se esperaba ${i}. Un hueco o un duplicado suele ser un merge ` +
        `mal resuelto del journal: dos ramas generaron la migración N y quedaron las dos.`,
    );
  }
});

test("el `when` es ESTRICTAMENTE creciente — si no, drizzle saltea en silencio", () => {
  const entradas = [...leerJournal()].sort((a, b) => a.idx - b.idx);
  for (let i = 1; i < entradas.length; i++) {
    const previa = entradas[i - 1]!;
    const actual = entradas[i]!;
    assert.ok(
      actual.when > previa.when,
      `«${actual.tag}» (idx ${actual.idx}, when ${actual.when}) NO supera a ` +
        `«${previa.tag}» (idx ${previa.idx}, when ${previa.when}).\n\n` +
        `Drizzle la va a SALTEAR en silencio: el deploy sale verde y la migración ` +
        `nunca se aplica.\n` +
        `Arreglo: JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when`,
    );
  }
});

test("cada entrada del journal tiene su .sql, y cada .sql su entrada", () => {
  const entradas = leerJournal();
  const archivos = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""));

  for (const e of entradas) {
    assert.ok(
      archivos.includes(e.tag),
      `el journal nombra «${e.tag}» pero no existe drizzle/${e.tag}.sql — ` +
        `¿se commiteó el journal sin el .sql?`,
    );
  }
  for (const a of archivos) {
    assert.ok(
      entradas.some((e) => e.tag === a),
      `existe drizzle/${a}.sql pero el journal no lo nombra: drizzle no lo va a aplicar nunca.`,
    );
  }
});

test("el baseline crea la extensión vector antes de usar el tipo", () => {
  // Se agrega a mano (drizzle-kit no la emite) y es fácil de perder al regenerar.
  // Sin ella, la migración muere con 42704 sobre cualquier base limpia — o sea que
  // staging y los tests con base dejan de poder montarse.
  // Los comentarios se descartan: el .sql explica en prosa por qué existe la línea, y
  // esa prosa menciona `vector(1024)`. Sin filtrarlos, el test se dispara contra su
  // propia documentación en vez de contra el SQL.
  const lineas = readFileSync(join(DIR, "0000_baseline.sql"), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"));

  const iExtension = lineas.findIndex((l) => l.includes("CREATE EXTENSION IF NOT EXISTS vector"));
  assert.ok(iExtension >= 0, "el baseline perdió el CREATE EXTENSION vector");

  const iUso = lineas.findIndex((l) => /\bvector\(/.test(l));
  if (iUso >= 0) {
    assert.ok(
      iExtension < iUso,
      `el CREATE EXTENSION vector (línea ${iExtension}) quedó DESPUÉS del primer uso ` +
        `del tipo (línea ${iUso}): la migración muere con 42704 en una base limpia`,
    );
  }
});
