import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * ADOPTAR MIGRACIONES — para una base que YA tiene el schema pero no el registro.
 *
 * El problema que resuelve: producción existía antes que las migraciones. Sus tablas
 * las creó `db:push`, que no deja rastro de qué aplicó. Si ahí corrieras
 * `drizzle-kit migrate`, intentaría ejecutar el baseline y moriría en el primer
 * `CREATE TABLE` — la tabla ya está.
 *
 * Lo que hace: registra migraciones como aplicadas SIN ejecutar su SQL, que es
 * exactamente lo que hace falta cuando la base ya está en ese estado.
 *
 * ANTES de usarlo hay que PROBAR que la base realmente está en ese estado. La prueba
 * no la hace este script (no puede: comparar schemas de verdad es trabajo de pg_dump);
 * la hace el runbook, con un diff contra una base recién migrada:
 *
 *     docs/migraciones.md  §«Adoptar una base que ya existía»
 *
 * Este script solo se rehúsa a lo obviamente malo: base vacía (ahí lo correcto es
 * `db:migrate`), o migraciones ya registradas que no coinciden.
 *
 *     npm run db:adoptar            # dice qué haría, no toca nada
 *     npm run db:adoptar -- --si    # lo hace
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_MIGRACIONES = join(AQUI, "../../drizzle");

type EntradaJournal = { idx: number; when: number; tag: string };

function leerJournal(): EntradaJournal[] {
  const ruta = join(DIR_MIGRACIONES, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(ruta, "utf8")) as { entries: EntradaJournal[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

/** El mismo hash que registra drizzle-kit: sha256 del contenido del .sql, crudo. */
function hashDe(tag: string): string {
  const sql = readFileSync(join(DIR_MIGRACIONES, `${tag}.sql`), "utf8");
  return createHash("sha256").update(sql).digest("hex");
}

async function main(): Promise<void> {
  const confirmado = process.argv.includes("--si");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("falta DATABASE_URL (sale de server/.env)");

  // Qué base es, para que quede en el log de quien lo corre: sin credenciales.
  const u = new URL(url);
  console.log(`base: ${u.hostname}:${u.port}${u.pathname}\n`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // Guardia 1: la base tiene que tener el schema. Una base vacía no se «adopta»,
    // se migra — y confundirlas dejaría una base sin tablas que se cree al día.
    const [{ existe }] = await sql<{ existe: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'events'
      ) as existe`;
    if (!existe) {
      throw new Error(
        "la base no tiene la tabla `events`: está vacía o es otra base. " +
          "Para una base vacía lo correcto es `npm run db:migrate`, no adoptar.",
      );
    }

    // El dry-run NO escribe: ni siquiera crea el schema. Un «decime qué harías» que
    // deja objetos atrás no es un dry-run, y la tabla de migraciones es justo la que
    // no querés que aparezca a medias en una base de producción.
    const [{ hayTabla }] = await sql<{ hayTabla: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
      ) as "hayTabla"`;

    const registradas = new Set<string>();
    if (hayTabla) {
      const yaRegistradas = await sql<{ hash: string }[]>`
        select hash from drizzle.__drizzle_migrations`;
      for (const r of yaRegistradas) registradas.add(r.hash);
    }

    const pendientes = leerJournal()
      .map((e) => ({ ...e, hash: hashDe(e.tag) }))
      .filter((e) => !registradas.has(e.hash));

    if (pendientes.length === 0) {
      console.log("Nada que adoptar: todas las migraciones del journal ya están registradas.");
      return;
    }

    console.log("Se marcarían como aplicadas (SIN ejecutar su SQL):");
    for (const p of pendientes) console.log(`  ${p.tag}  ${p.hash.slice(0, 16)}…  when=${p.when}`);

    if (!confirmado) {
      console.log(
        "\nEsto NO se ejecutó. Antes de correrlo con `--si`, verificá con el diff de " +
          "`docs/migraciones.md` que la base tiene exactamente este schema.",
      );
      return;
    }

    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`);

    for (const p of pendientes) {
      await sql`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${p.hash}, ${p.when})`;
      console.log(`✓ ${p.tag} adoptada`);
    }
    console.log("\nListo: `drizzle-kit migrate` ahora arranca desde acá.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("no se pudo adoptar:", err instanceof Error ? err.message : err);
  process.exit(1);
});
