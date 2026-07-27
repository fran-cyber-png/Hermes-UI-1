import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { URL_ADMIN, TEMPLATE, guardarAntiProd, urlDeBase } from "./base.js";

/**
 * MONTA EL TEMPLATE de la base de test. Corre UNA vez, antes de los
 * `*.test.db.ts` (ver el script `test:db` en package.json).
 *
 * EL ORDEN ES EXACTO y no es casualidad:
 *   1. recrear la base template desde cero,
 *   2. `CREATE EXTENSION vector` — ANTES del push,
 *   3. `drizzle-kit push --force`.
 *
 * Sin el paso 2 antes del 3, el push muere en `rag.documentos` (columna de tipo
 * `vector`, que no existe hasta crear la extensión). La extensión se copia sola a
 * cada base derivada porque `CREATE DATABASE ... TEMPLATE` clona todo. Ver ADR 0008.
 */
async function main(): Promise<void> {
  guardarAntiProd(URL_ADMIN);

  const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
  try {
    // Recrear desde cero: FORCE corta conexiones colgadas de una corrida anterior.
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEMPLATE}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const urlTemplate = urlDeBase(TEMPLATE);

  // Paso 2: la extensión ANTES del push.
  const tmpl = postgres(urlTemplate, { max: 1, onnotice: () => {} });
  try {
    await tmpl.unsafe("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await tmpl.end({ timeout: 5 });
  }

  // Paso 3: aplica el schema. drizzle-kit lee DATABASE_URL de su config.
  //
  // En Windows hay que pasar por la shell: `npx` es `npx.cmd`, y desde el parche
  // de CVE-2024-27980 Node se niega a lanzar un .cmd sin shell (EINVAL) — antes
  // de eso ni lo encontraba (ENOENT). Sin esto el harness entero muere antes del
  // primer test. CI corre en el runner Linux de VPS1, así que solo se ve al
  // levantar los tests con base en una máquina Windows.
  // Los argumentos son constantes y sin espacios: no hay nada que citar.
  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: urlTemplate },
  });

  console.log(`[pruebas] template «${TEMPLATE}» listo (extensión vector + schema aplicado).`);
}

main().catch((err) => {
  console.error("[pruebas] no se pudo montar el template:", err);
  process.exit(1);
});
