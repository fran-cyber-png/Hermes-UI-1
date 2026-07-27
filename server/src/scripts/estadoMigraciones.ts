import "dotenv/config";
import postgres from "postgres";
import { hashDe, leerJournal } from "../migraciones/referencia.js";

/**
 * EN QUÉ ESTADO ESTÁ LA BASE respecto de las migraciones del repo. Solo lee.
 *
 * Es el «con qué miro para saber que salió bien» del deploy, y también el «qué pasó»
 * cuando algo no cuadra. Contesta las tres preguntas en una pantalla:
 *
 *   ¿adoptó el baseline?      sin la tabla de registro, `db:migrate` intentaría recrear
 *                             tablas que ya existen y moriría
 *   ¿le falta aplicar algo?   el journal del repo menos lo registrado
 *   ¿registró algo que el repo NO conoce?  ← el caso feo: la base se migró contra OTRO
 *                             baseline (por ejemplo, uno regenerado después). Su schema
 *                             puede ser cualquier cosa, y drizzle no lo va a notar solo:
 *                             el migrador compara por `when`, no por hash.
 *
 *     npm run db:estado                        # informe
 *     npm run db:estado -- --exigir-coherencia # además, sale 1 si hay algo raro
 *
 * La segunda forma es la que corre el pipeline antes de migrar staging: así el fallo
 * dice qué pasa en vez de un «relation already exists» a mitad del .sql.
 */

async function main(): Promise<void> {
  const exigir = process.argv.includes("--exigir-coherencia");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("falta DATABASE_URL (sale de server/.env)");

  const u = new URL(url);
  console.log(`base: ${u.hostname}:${u.port}${u.pathname}\n`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const delRepo = leerJournal().map((e) => ({ ...e, hash: hashDe(e.tag) }));
    console.log("migraciones del repo:");
    for (const m of delRepo) {
      console.log(`  ${String(m.idx).padStart(4)}  ${m.tag.padEnd(28)} ${m.hash.slice(0, 12)}…  when=${m.when}`);
    }

    const [{ hayTabla }] = await sql<{ hayTabla: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
      ) as "hayTabla"`;

    if (!hayTabla) {
      console.log("\nregistradas en la base: NINGUNA — la base nunca adoptó el baseline.");
      console.log(
        "  Si la base ya tiene el schema (viene de `db:push`): `npm run db:adoptar`.\n" +
          "  Si está vacía: `npm run db:migrate`.",
      );
      if (exigir) process.exitCode = 1;
      return;
    }

    const registradas = await sql<{ hash: string; createdAt: string }[]>`
      select hash, created_at::text as "createdAt"
      from drizzle.__drizzle_migrations
      order by created_at`;

    console.log("\nregistradas en la base:");
    const porHash = new Map(delRepo.map((m) => [m.hash, m.tag]));
    for (const r of registradas) {
      const tag = porHash.get(r.hash);
      console.log(
        `  ${(tag ?? "??? DESCONOCIDA").padEnd(34)} ${r.hash.slice(0, 12)}…  created_at=${r.createdAt}`,
      );
    }

    const conocidos = new Set(registradas.map((r) => r.hash));
    const faltan = delRepo.filter((m) => !conocidos.has(m.hash));
    const ajenas = registradas.filter((r) => !porHash.has(r.hash));

    console.log("");
    let mal = false;

    if (ajenas.length > 0) {
      mal = true;
      console.log(
        `✗ ${ajenas.length} migración(es) registrada(s) que este repo NO conoce.\n` +
          "  Esta base se migró contra otro baseline. El schema que tiene no es\n" +
          "  necesariamente el que el repo describe, y `db:migrate` NO se va a dar cuenta:\n" +
          "  el migrador compara por `when`, no por hash.\n" +
          "  · Si es una base descartable (staging, dev): borrarla y volver a migrar.\n" +
          "  · Si tiene datos que importan: `npm run db:adoptar` sobre una base limpia NO\n" +
          "    es la respuesta — hace falta mirar el diff a mano antes de tocar nada.",
      );
    }

    if (faltan.length > 0) {
      console.log(`· ${faltan.length} migración(es) del repo sin aplicar: ${faltan.map((f) => f.tag).join(", ")}`);
      console.log("  `npm run db:migrate` las aplica (el deploy lo hace solo).");
    }

    if (!mal && faltan.length === 0) console.log("✓ la base está al día con el repo.");

    if (exigir && mal) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("no se pudo leer el estado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
