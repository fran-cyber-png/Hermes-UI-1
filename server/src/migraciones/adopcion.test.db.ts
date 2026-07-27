import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { URL_ADMIN, TEMPLATE, guardarAntiProd, urlDeBase } from "../pruebas/base.js";
import { compararEstructuras, leerEstructura } from "./estructura.js";
import { PREFIJO_REFERENCIA } from "./referencia.js";

/**
 * EL CAMINO COMPLETO DE LA MIGRACIÓN, contra Postgres de verdad.
 *
 * Tres preguntas, y la tercera es la que importa:
 *   1. base vacía + `db:migrate` ⇒ el schema entero, igual que el que declara el repo
 *   2. base como producción (creada con `db:push`) + `db:adoptar` ⇒ registra sin ejecutar
 *   3. base que NO coincide ⇒ **se rehúsa**, aunque le pases `--si`, y dice qué difiere
 *
 * La 3 es la razón de ser de todo esto. Adoptar una base que no coincide la deja
 * marcada como al día mintiendo, y drizzle no vuelve a mirar el baseline nunca más.
 *
 * El script se corre como SUBPROCESO a propósito: lo que hay que probar es lo que el
 * operador va a escribir en VPS1, códigos de salida incluidos — no una función
 * interna que se le parece.
 *
 * ⚠️ CORRELO CON `npm run test:db`, no con `tsx --test` a secas. La base plantilla vive
 * en un contenedor COMPARTIDO (5439) y la monta `montarBase.ts` desde el `schema.ts` de
 * quien la corrió último. Con dos worktrees trabajando en paralelo, la plantilla puede
 * ser de la otra rama — y entonces la PARIDAD falla contra un schema que no es el tuyo.
 * `npm run test:db` la remonta antes de cada corrida, así que ahí no pasa.
 */

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Cuántas migraciones declara el repo. La verdad vive en el journal, no en un literal. */
function migracionesDeclaradas(): number {
  const journal = JSON.parse(readFileSync(join(SERVER, "drizzle/meta/_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}
const SCRIPT = "src/scripts/adoptarMigraciones.ts";

/** Una base propia para el test, con su URL — el script se conecta por URL, no por handle. */
async function baseConUrl(
  t: TestContext,
  desdeTemplate: boolean,
): Promise<{ url: string; sql: Sql }> {
  guardarAntiProd(URL_ADMIN);
  const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
  const nombre = `t_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await admin.unsafe(
    desdeTemplate
      ? `CREATE DATABASE "${nombre}" TEMPLATE ${TEMPLATE}`
      : `CREATE DATABASE "${nombre}"`,
  );

  const url = urlDeBase(nombre);
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  t.after(async () => {
    await sql.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  });
  return { url, sql };
}

type Corrida = { codigo: number; salida: string };

function correr(comando: string, args: string[], url: string): Corrida {
  try {
    const salida = execFileSync("npx", [comando, ...args], {
      cwd: SERVER,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // Mismo motivo que en `pruebas/montarBase.ts`: en Windows `npx` es
      // `npx.cmd` y Node se niega a lanzar un .cmd sin shell desde el parche de
      // CVE-2024-27980. Sin esto los seis tests de acá fallan con un `spawn` roto
      // (código -1) que se lee como «la migración falló», y no falló: nunca corrió.
      shell: process.platform === "win32",
      // DATABASE_URL de este test y nada más: el `.env` del repo no puede filtrarse
      // acá, o el test le hablaría a la base de desarrollo de quien lo corre.
      env: { ...process.env, DATABASE_URL: url, DOTENV_CONFIG_PATH: "/dev/null" },
    });
    return { codigo: 0, salida };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { codigo: e.status ?? -1, salida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const adoptar = (url: string, ...args: string[]): Corrida =>
  correr("tsx", [SCRIPT, ...args], url);

/** El índice GIN de notas: drizzle-kit no lo emite, la migración sí. Producción lo tiene. */
const GIN_DE_NOTAS =
  `CREATE INDEX IF NOT EXISTS notas_texto_gin_idx ON notas USING gin (to_tsvector('spanish', texto))`;

// ── 1 · base vacía + db:migrate ════════════════════════════════════════════════
//
// LA PARIDAD: las migraciones y `src/db/*.ts` tienen que describir la MISMA base.
//
// Es la guardia que hace que un cambio de schema no pueda volver a ser un `db:push`
// manual sorpresa: si alguien agrega una tabla y no genera la migración, esto falla
// en CI (N2b) con el nombre de la tabla puesto. La misma disciplina que la paridad de
// la urgencia (ADR 0009): dos implementaciones del mismo hecho, y un test que
// impide que diverjan.
test("PARIDAD · migrar desde cero da el mismo schema que declara `src/db/*.ts`", async (t) => {
  const vacia = await baseConUrl(t, false);
  const declarado = await baseConUrl(t, true); // el template se monta con `db:push`

  const migrada = correr("drizzle-kit", ["migrate"], vacia.url);
  assert.equal(migrada.codigo, 0, `db:migrate falló:\n${migrada.salida}`);

  // `db:push` no emite índices de expresión, así que el GIN de notas hay que
  // agregarlo de este lado para comparar peras con peras. Es la ÚNICA excepción
  // conocida, y está escrita en el baseline por eso mismo.
  await declarado.sql.unsafe(GIN_DE_NOTAS);

  const difs = compararEstructuras(
    await leerEstructura(vacia.sql),
    await leerEstructura(declarado.sql),
  );
  assert.deepEqual(
    difs,
    [],
    "Las migraciones y el schema declarado divergieron:\n" +
      difs.map((d) => `  [${d.aspecto}] (${d.lado}) ${d.firma}`).join("\n") +
      "\n\nSi cambiaste `src/db/*.ts`, falta la migración:\n" +
      "  cd server && npm run db:generate\n" +
      "  JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when\n" +
      "y commiteá `server/drizzle/` completo junto al cambio de schema.",
  );
});

// ── 2 · base como producción + db:adoptar ──────────────────────────────────────
test("una base como producción se adopta: registra la migración SIN ejecutar su SQL", async (t) => {
  const base = await baseConUrl(t, true);
  await base.sql.unsafe(GIN_DE_NOTAS);

  // Una fila que sobreviva: si el script ejecutara el SQL del baseline en vez de
  // registrarlo, el CREATE TABLE moriría (o peor, algo se recrearía vacío).
  await base.sql`
    insert into events (source, external_id, occurred_at, payload)
    values ('prueba', 'adopcion-1', now(), '{}'::jsonb)`;

  const seco = adoptar(base.url);
  assert.equal(seco.codigo, 0, seco.salida);
  assert.match(seco.salida, /sin diferencias/);
  assert.match(seco.salida, /Esto NO se ejecutó/);

  // El dry-run no deja rastro: ni el schema `drizzle` tiene que aparecer.
  const [{ hay }] = await base.sql<{ hay: boolean }[]>`
    select exists (select 1 from pg_namespace where nspname = 'drizzle') as hay`;
  assert.equal(hay, false, "el dry-run creó el schema `drizzle`: un dry-run que deja objetos no lo es");

  const hecho = adoptar(base.url, "--si");
  assert.equal(hecho.codigo, 0, hecho.salida);
  assert.match(hecho.salida, /0000_baseline adoptada/);

  const registradas = await base.sql<{ hash: string }[]>`
    select hash from drizzle.__drizzle_migrations`;
  // Contra el JOURNAL, no contra un número escrito acá: adoptar registra TODAS las
  // migraciones que el repo declara, así que un literal envejece con la primera que
  // alguien agregue —y el test se pondría rojo por existir, no por estar mal—. Pasó
  // con `0001_procedencia_de_envios` a las horas de mergear el pipeline.
  assert.equal(registradas.length, migracionesDeclaradas());

  const [{ n }] = await base.sql<{ n: number }[]>`select count(*)::int as n from events`;
  assert.equal(n, 1, "los datos no se tocan: adoptar registra, no ejecuta");

  // Y después de adoptar, migrar no hace nada: es el punto de todo el ejercicio.
  const migrar = correr("drizzle-kit", ["migrate"], base.url);
  assert.equal(migrar.codigo, 0, migrar.salida);

  const otraVez = adoptar(base.url, "--si");
  assert.match(otraVez.salida, /Nada que adoptar/);
});

// ── 3 · base que NO coincide ───────────────────────────────────────────────────
test("una base que NO coincide con el baseline NO se adopta, ni con `--si`", async (t) => {
  const base = await baseConUrl(t, true);
  // Tres derivas de las que pasan de verdad: un índice que solo existe en el repo
  // (el GIN, que acá a propósito NO se crea), una columna parchada a mano en el
  // servidor, y un NOT NULL relajado con un ALTER de emergencia.
  await base.sql.unsafe(`ALTER TABLE notas ADD COLUMN parche_de_las_2am text`);
  await base.sql.unsafe(`ALTER TABLE hechos ALTER COLUMN texto DROP NOT NULL`);

  const r = adoptar(base.url, "--si");

  assert.equal(r.codigo, 1, `tenía que fallar y no falló:\n${r.salida}`);
  assert.match(r.salida, /NO se adopta nada/);
  assert.match(r.salida, /parche_de_las_2am/);
  assert.match(r.salida, /notas_texto_gin_idx/);
  assert.match(r.salida, /hechos\.texto/);

  // Y no escribió: la base sigue sin registro, que es lo único que la salva de
  // quedar marcada como al día mintiendo.
  const [{ hay }] = await base.sql<{ hay: boolean }[]>`
    select exists (select 1 from pg_namespace where nspname = 'drizzle') as hay`;
  assert.equal(hay, false);
});

test("la verificación dice QUÉ comparó, no solo si coincidió", async (t) => {
  const base = await baseConUrl(t, true);
  await base.sql.unsafe(GIN_DE_NOTAS);

  const r = adoptar(base.url);
  assert.match(r.salida, /esquemas comparados : public, fuentes, ontologia, rag/);
  assert.match(r.salida, /migraciones del repo: 0000_baseline/);
  for (const aspecto of ["tabla", "columna", "índice", "restricción"]) {
    assert.match(r.salida, new RegExp(`${aspecto}\\s+base viva:\\s+\\d+\\s+baseline:\\s+\\d+`));
  }
});

test("la base temporal de verificación se borra sola", async (t) => {
  const base = await baseConUrl(t, true);
  await base.sql.unsafe(GIN_DE_NOTAS);

  const r = adoptar(base.url);
  const nombre = /base de referencia: (\S+)/.exec(r.salida)?.[1];
  assert.ok(nombre?.startsWith(PREFIJO_REFERENCIA), `no se nombró la base temporal:\n${r.salida}`);

  const quedan = await base.sql<{ datname: string }[]>`
    select datname from pg_database where datname = ${nombre!}`;
  assert.equal(quedan.length, 0, `quedó la base temporal «${nombre}»`);
});

test("`--forzar-sin-verificar` exige un motivo escrito", async (t) => {
  const base = await baseConUrl(t, true); // sin el GIN: no coincide, a propósito

  const sinMotivo = adoptar(base.url, "--si", "--forzar-sin-verificar");
  assert.equal(sinMotivo.codigo, 1);
  assert.match(sinMotivo.salida, /exige --motivo/);

  const conMotivo = adoptar(base.url, "--si", "--forzar-sin-verificar", "--motivo=test");
  assert.equal(conMotivo.codigo, 0, conMotivo.salida);
  assert.match(conMotivo.salida, /A CIEGAS/);
  assert.match(conMotivo.salida, /motivo: test/);
});
