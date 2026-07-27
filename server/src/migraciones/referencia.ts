import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { leerEstructura, type Estructura } from "./estructura.js";

/**
 * LA BASE DE REFERENCIA — «cómo se vería esta base si se hubiera creado desde cero
 * con las migraciones del repo».
 *
 * Sin ella, «la base coincide con el baseline» no se puede contestar sin que alguien
 * lo mire a ojo. Con ella es una pregunta que la máquina responde: se levanta una
 * base **temporal en el MISMO servidor** (misma versión de Postgres, mismo locale —
 * comparar contra otra máquina compararía también las diferencias del servidor), se
 * le aplican las migraciones, se leen las dos estructuras y se restan.
 *
 * Es aditiva y efímera: crea una base propia con nombre reconocible, no toca ni una
 * fila de la base viva, y la borra al terminar pase lo que pase.
 */

export const DIR_MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** El prefijo hace que un sobrante sea obvio y borrable sin dudar de qué es. */
export const PREFIJO_REFERENCIA = "hermes_verificacion_";

export type EntradaJournal = { idx: number; when: number; tag: string };

export function leerJournal(dir = DIR_MIGRACIONES): EntradaJournal[] {
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as {
    entries: EntradaJournal[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

/** El mismo hash que registra drizzle-kit: sha256 del contenido del .sql, crudo. */
export function hashDe(tag: string, dir = DIR_MIGRACIONES): string {
  return createHash("sha256").update(readFileSync(join(dir, `${tag}.sql`), "utf8")).digest("hex");
}

/**
 * Bases de verificación que quedaron de una corrida anterior interrumpida.
 *
 * El `_` del prefijo va escapado: en un `LIKE` de SQL es un comodín de un carácter, así
 * que sin escapar esto también matchearía `hermesXverificacionY…`. Lo único que se hace
 * con el resultado es imprimir un `DROP DATABASE` para copiar y pegar — y un `DROP` que
 * se copia a ciegas tiene que nombrar exactamente lo que dice nombrar.
 */
export async function sobrantesDeVerificacion(sql: Sql): Promise<string[]> {
  const patron = PREFIJO_REFERENCIA.replace(/_/g, "\\_") + "%";
  const filas = await sql<{ datname: string }[]>`
    select datname from pg_database where datname like ${patron}`;
  return filas.map((f) => f.datname).sort();
}

/**
 * Levanta la base de referencia, la migra, lee su estructura y la borra.
 *
 * `urlViva` solo se usa para saber a qué SERVIDOR conectarse: la base temporal se
 * crea al lado, nunca dentro.
 */
export async function estructuraDeReferencia(
  sql: Sql,
  urlViva: string,
  registrar: (linea: string) => void = () => {},
): Promise<{ estructura: Estructura; nombre: string }> {
  // Único por corrida: dos verificaciones simultáneas no se pisan, y un sobrante de
  // una corrida muerta no bloquea la siguiente.
  const nombre = `${PREFIJO_REFERENCIA}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const u = new URL(urlViva);
  if (u.pathname === `/${nombre}`) throw new Error("la base viva ya se llama como la de referencia");

  registrar(`base de referencia: ${nombre} (temporal, se borra al terminar)`);
  await sql.unsafe(`CREATE DATABASE "${nombre}"`);

  const urlReferencia = new URL(urlViva);
  urlReferencia.pathname = `/${nombre}`;
  const ref = postgres(urlReferencia.toString(), { max: 1, onnotice: () => {} });
  try {
    // Las migraciones del repo, todas, desde cero. Es la MISMA pieza que corre en el
    // deploy (`drizzle-kit migrate` usa este mismo journal y estos mismos .sql), así
    // que lo que se compara es lo que realmente se aplicaría.
    await migrate(drizzle(ref), { migrationsFolder: DIR_MIGRACIONES });
    const estructura = await leerEstructura(ref);
    return { estructura, nombre };
  } finally {
    await ref.end({ timeout: 5 });
    // WITH (FORCE) corta cualquier conexión que haya quedado colgada.
    await sql.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`).catch(() => {
      registrar(`⚠ no se pudo borrar la base temporal «${nombre}» — borrala a mano`);
    });
  }
}

/** Los tags que hay en `drizzle/`, para poder decir QUÉ se aplicó a la referencia. */
export function tagsDelRepo(dir = DIR_MIGRACIONES): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort();
}
