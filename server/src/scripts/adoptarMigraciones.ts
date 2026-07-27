import "dotenv/config";
import postgres from "postgres";
import {
  ESQUEMAS_GESTIONADOS,
  compararEstructuras,
  describirDiferencias,
  leerEstructura,
  resumirComparacion,
} from "../migraciones/estructura.js";
import {
  estructuraDeReferencia,
  hashDe,
  leerJournal,
  sobrantesDeVerificacion,
  tagsDelRepo,
} from "../migraciones/referencia.js";

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
 * LA PRUEBA DE QUE ESTÁ EN ESE ESTADO LA HACE ESTE SCRIPT. Antes la hacía el
 * runbook, a mano, con un `pg_dump` de cada lado y un `diff` — un paso manual, y los
 * pasos manuales no se hacen. Su fallo además es el peor de todos: si se adopta una
 * base que NO coincide, queda **marcada como al día mintiendo**, drizzle no vuelve a
 * mirar el baseline nunca, y la diferencia sobrevive en silencio para siempre.
 *
 * Ahora, antes de registrar nada, levanta una base temporal en el MISMO servidor, le
 * aplica las migraciones desde cero, y compara tabla por tabla, columna por columna
 * (con su tipo, su nulabilidad y su default), índice por índice y restricción por
 * restricción. **Ante cualquier diferencia se rehúsa** y las lista.
 *
 *     npm run db:adoptar            # verifica y dice qué haría; no toca nada
 *     npm run db:adoptar -- --si    # verifica y, si coincide, registra
 *
 * `--si` NO saltea la verificación: es la confirmación de escribir, no un permiso
 * para no mirar. La salida de emergencia es otra bandera, ruidosa y con motivo
 * obligatorio (`--forzar-sin-verificar --motivo="…"`), documentada en
 * `docs/migraciones.md`.
 */

export type Opciones = {
  confirmado: boolean;
  forzar: boolean;
  motivo: string;
};

export function leerOpciones(argv: readonly string[]): Opciones {
  const motivo = argv.find((a) => a.startsWith("--motivo="))?.slice("--motivo=".length) ?? "";
  return {
    confirmado: argv.includes("--si"),
    forzar: argv.includes("--forzar-sin-verificar"),
    motivo: motivo.trim(),
  };
}

async function main(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("falta DATABASE_URL (sale de server/.env)");

  if (opciones.forzar && !opciones.motivo) {
    throw new Error(
      '--forzar-sin-verificar exige --motivo="por qué se saltea la verificación". ' +
        "Saltearla sin dejar escrito el porqué es justo lo que esta bandera existe para evitar.",
    );
  }

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

    // El dry-run NO escribe: ni siquiera crea el schema `drizzle`. Un «decime qué
    // harías» que deja objetos atrás no es un dry-run, y la tabla de migraciones es
    // justo la que no querés que aparezca a medias en una base de producción.
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

    // ── LA VERIFICACIÓN ────────────────────────────────────────────────────────
    if (opciones.forzar) {
      console.log("╔════════════════════════════════════════════════════════════════════╗");
      console.log("║  SIN VERIFICAR — se está adoptando A CIEGAS                        ║");
      console.log("╚════════════════════════════════════════════════════════════════════╝");
      console.log(`motivo: ${opciones.motivo}\n`);
      console.log(
        "Si la base NO está en el estado del baseline, queda marcada como al día\n" +
          "mintiendo y drizzle no vuelve a mirar el baseline nunca. Anotá esto donde\n" +
          "alguien lo lea, porque a partir de acá nada más lo va a detectar.\n",
      );
    } else {
      const sobrantes = await sobrantesDeVerificacion(sql);
      if (sobrantes.length > 0) {
        console.log("⚠ quedaron bases de verificación de una corrida anterior:");
        for (const s of sobrantes) console.log(`    DROP DATABASE "${s}" WITH (FORCE);`);
        console.log("");
      }

      console.log("Verificando que la base esté EXACTAMENTE en el estado del baseline.");
      console.log(`  esquemas comparados : ${ESQUEMAS_GESTIONADOS.join(", ")}`);
      console.log(`  migraciones del repo: ${tagsDelRepo().join(", ")}`);

      const { estructura: baseline } = await estructuraDeReferencia(sql, url, (l) =>
        console.log(`  ${l}`),
      );
      const viva = await leerEstructura(sql);

      // QUÉ se comparó, no solo el veredicto: un «✓ todo igual» sin decir sobre
      // cuántas tablas es indistinguible de una consulta que devolvió vacío.
      console.log("\nQué se comparó:");
      for (const linea of resumirComparacion(viva, baseline)) console.log(linea);

      const difs = compararEstructuras(viva, baseline);
      if (difs.length > 0) {
        console.log(`\n✗ ${difs.length} diferencia(s). NO se adopta nada.\n`);
        for (const linea of describirDiferencias(difs)) console.log(linea);
        console.log(
          "\nCada diferencia es algo que el repo y la base no cuentan igual. Se arreglan\n" +
            "hacia el repo —que la migración las describa—, no ignorándolas: el\n" +
            "`notas_texto_gin_idx` que existía solo en producción se arregló así.\n" +
            'Salida de emergencia: --forzar-sin-verificar --motivo="…" (ver docs/migraciones.md).',
        );
        process.exitCode = 1;
        return;
      }
      console.log("\n✓ sin diferencias: la base viva y el baseline describen lo mismo.\n");
    }

    console.log("Se marcarían como aplicadas (SIN ejecutar su SQL):");
    for (const p of pendientes) console.log(`  ${p.tag}  ${p.hash.slice(0, 16)}…  when=${p.when}`);

    if (!opciones.confirmado) {
      console.log("\nEsto NO se ejecutó. Para hacerlo: el mismo comando con `--si`.");
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
