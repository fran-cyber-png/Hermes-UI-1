import type { TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.js";

/**
 * EL HARNESS DE TESTS CON BASE — una Postgres de verdad, aislada por test.
 *
 * Los tests puros (`*.test.ts`) no tocan la base y no cubren NADA del SQL: la
 * cola, el radar, las proyecciones. Estos (`*.test.db.ts`) sí, contra una
 * Postgres efímera en el puerto 5439 (ver `docker-compose.test.yml` y ADR 0008).
 *
 * CÓMO se aísla: se monta un `template` UNA vez (`montarBase.ts`) con la
 * extensión `vector` y el schema aplicado; cada test crea su propia base con
 * `CREATE DATABASE ... TEMPLATE`, la usa, y la borra al terminar. Es rápido
 * (copiar el template es barato) y no hay fugas entre tests.
 *
 * POR QUÉ inyectar `db`, no swappear el singleton: `db/client.ts` arma la
 * conexión al importar. Cambiarlo por test es frágil. En vez de eso, los seams
 * (`consultarRadar(db)`, `consultarCola(db)`) reciben el `db` como argumento —
 * el test le pasa el suyo, producción le pasa el singleton. Ese es el motivo de
 * extraer los seams (issues #37/#38).
 */

/**
 * La URL del Postgres de TEST. En CI se pasa por env; en local es el default del
 * `docker-compose.test.yml`. NUNCA la de dev (5434) ni la de prod (5438).
 */
export const URL_ADMIN =
  process.env.TEST_DATABASE_URL ??
  "postgresql://hermes_test:hermes_test@127.0.0.1:5439/hermes_test";

/** La base plantilla: se monta una vez con extensión + schema; nadie escribe en ella. */
export const TEMPLATE = "hermes_test_template";

/** Marcas que delatan que una URL apunta a dev (5434) o a producción (5438). */
const PROHIBIDOS = [":5438", ":5434", "meta_escuela", "hermes_db"];

/**
 * GUARDIA HARD-FAIL ANTI-PROD. Corre ANTES de crear o borrar nada.
 *
 * El runner de CI es el de VPS1, la MISMA máquina donde vive la base de
 * producción (`meta_escuela` en 5438). Un test que por error apunte ahí y haga
 * `DROP DATABASE` es catastrófico. Esta función aborta antes de tocar nada si la
 * URL menciona el puerto o el nombre de dev/prod, o si no es explícitamente 5439.
 */
export function guardarAntiProd(url: string): void {
  for (const marca of PROHIBIDOS) {
    if (url.includes(marca)) {
      throw new Error(
        `GUARDIA anti-prod: la URL de test menciona «${marca}» — eso es dev o producción, ` +
          `no la base de test. Abortando ANTES de crear o borrar nada.`,
      );
    }
  }
  if (!url.includes(":5439")) {
    throw new Error(
      `GUARDIA anti-prod: la URL de test tiene que apuntar al puerto 5439 (la base de test ` +
        `corre SOLO ahí). Recibí: ${url}`,
    );
  }
}

/** La misma URL de admin pero apuntando a otra base (misma máquina/credenciales). */
export function urlDeBase(nombre: string): string {
  const u = new URL(URL_ADMIN);
  u.pathname = `/${nombre}`;
  return u.toString();
}

/**
 * Crea una base FRESCA a partir del template, aislada para este test, y la borra
 * cuando el test termina (via `t.after`). Devuelve el `db` de Drizzle para
 * inyectarlo en los seams — nunca se usa el singleton de `db/client.ts` acá.
 */
export async function baseDePrueba(t: TestContext) {
  guardarAntiProd(URL_ADMIN);

  const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
  const nombre = `t_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await admin.unsafe(`CREATE DATABASE "${nombre}" TEMPLATE ${TEMPLATE}`);

  const client = postgres(urlDeBase(nombre), { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema });

  t.after(async () => {
    await client.end({ timeout: 5 });
    // WITH (FORCE): corta cualquier conexión colgada antes de borrar la base.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  });

  return db;
}

/** El tipo del `db` inyectable que devuelve `baseDePrueba` — para los seams. */
export type DbDePrueba = Awaited<ReturnType<typeof baseDePrueba>>;
