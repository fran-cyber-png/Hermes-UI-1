import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { supervisoresConfigurados } from "../padron/supervisor.js";
import { adminsConfigurados } from "../equipo/cascada.js";
import { leerEquipo, sembrarEquipo } from "../equipo/repositorio.js";
import { EQUIPO_SEMILLA, esCadenaDeServicio, revisarSemilla } from "../equipo/semilla.js";
import { clavePersona } from "../equipo/roles.js";

/**
 * EL EQUIPO — `npm run equipo:sembrar`.
 *
 *   npm run equipo:sembrar              ← el censo y el plan, sin escribir nada
 *   npm run equipo:sembrar -- --aplicar ← siembra
 *
 * **Dry-run por default**, como todo script que escribe en esta casa.
 *
 * ══ 🔴 PARA QUÉ SIRVE DE VERDAD: EL CENSO ════════════════════════════════════
 *
 * La lista de `equipo/semilla.ts` salió de una medición, y una medición envejece.
 * La primera versión del análisis nombraba cinco personas; el censo encontró
 * **once**, y la que faltaba —`Tracy`— está activa en la rueda con 10
 * conversaciones asignadas. Sembrar una lista escrita de memoria la habría
 * dejado sin fila, o sea sin rol, sin un solo síntoma.
 *
 * Por eso este script **no imprime sólo lo que va a hacer: imprime contra qué**.
 * Barre TODA columna `vendedora_id` del schema `public` —no una lista de tablas a
 * mano, que es la misma clase de lista que envejece— y dice **quién apareció en
 * la base y no está ni en la tabla ni en la semilla**. Ese renglón es el motivo
 * de que el script exista.
 *
 * ⚠️ **No decide por nadie.** A quien aparezca de más lo nombra; darle rol es una
 * decisión de una persona, no de un `INSERT` automático.
 *
 * ⚠️ **Nunca contra producción.** Corre contra el `DATABASE_URL` que tenga el
 * `.env` de este checkout, y lo imprime antes de tocar nada.
 */

const APLICAR = process.argv.includes("--aplicar");

/**
 * Las columnas que guardan la identidad de una PERSONA, preguntándoselo a la base.
 *
 * ⚠️ **`creada_por` queda afuera a propósito**: ahí viven `alta-automatica`,
 * `siembra` y otros valores de máquina que se verían como humanos nuevos. Y las
 * propias tablas `equipo*` también, o el censo se leería a sí mismo.
 */
async function columnasDeIdentidad(): Promise<{ tabla: string; columna: string }[]> {
  const filas = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name IN ('vendedora_id', 'asignada_por')
       AND data_type = 'text'
       AND table_name NOT LIKE 'equipo%'
     ORDER BY table_name, column_name
  `);
  return filas.map((f) => ({ tabla: f.table_name, columna: f.column_name }));
}

/** El censo: cada id crudo que aparece en la base, con en cuántas tablas se lo vio. */
async function censo(): Promise<Map<string, { grafias: Set<string>; tablas: Set<string> }>> {
  const columnas = await columnasDeIdentidad();
  const gente = new Map<string, { grafias: Set<string>; tablas: Set<string> }>();
  for (const { tabla, columna } of columnas) {
    // Una consulta por columna y no un `UNION ALL` gigante: si una tabla falla
    // —porque la migración de otro frente todavía no corrió— el censo sigue.
    let filas: { id: string | null }[] = [];
    try {
      filas = await db.execute<{ id: string | null }>(
        sql`SELECT DISTINCT ${sql.identifier(columna)} AS id FROM ${sql.identifier(tabla)}`,
      );
    } catch (e) {
      console.warn(`  ⚠ no se pudo leer ${tabla}.${columna}: ${(e as Error).message.slice(0, 80)}`);
      continue;
    }
    for (const f of filas) {
      const crudo = (f.id ?? "").trim();
      if (!crudo || esCadenaDeServicio(crudo)) continue;
      const clave = clavePersona(crudo);
      const yaEsta = gente.get(clave) ?? { grafias: new Set(), tablas: new Set() };
      yaEsta.grafias.add(crudo);
      yaEsta.tablas.add(tabla);
      gente.set(clave, yaEsta);
    }
  }
  return gente;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "(sin DATABASE_URL)";
  console.log(`\n═══ EQUIPO ═══  base: ${url.replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(APLICAR ? "modo: APLICAR (escribe)\n" : "modo: dry-run (no escribe nada)\n");

  const enLaTabla = await leerEquipo(db).catch(() => {
    console.log("⚠ la tabla `equipo` todavía no existe (falta la migración 0028).\n");
    return [] as Awaited<ReturnType<typeof leerEquipo>>;
  });
  const idsEnLaTabla = new Set(enLaTabla.map((f) => f.personaId));

  console.log(`— En la tabla hoy: ${enLaTabla.length}`);
  for (const f of enLaTabla) {
    console.log(`    ${f.activa ? " " : "✗"} ${f.personaId.padEnd(28)} ${f.rol}`);
  }

  console.log("\n— El censo de la base (toda columna de identidad, cadenas de servicio afuera):");
  const gente = await censo();
  const enLaSemilla = new Set(EQUIPO_SEMILLA.map((p) => clavePersona(p.personaId)));
  const faltantes: string[] = [];
  for (const [clave, { grafias, tablas }] of [...gente].sort()) {
    const marca = idsEnLaTabla.has(clave) ? "en la tabla" : enLaSemilla.has(clave) ? "en la semilla" : "🔴 NO ESTÁ";
    if (!idsEnLaTabla.has(clave) && !enLaSemilla.has(clave)) faltantes.push(clave);
    const g = [...grafias].sort().join(" · ");
    console.log(`    ${clave.padEnd(28)} ${marca.padEnd(14)} ${tablas.size} tablas   grafías: ${g}`);
  }

  if (faltantes.length > 0) {
    console.log(
      `\n🔴 ${faltantes.length} identidad(es) con trabajo en la base y sin rol en ningún lado:` +
        `\n   ${faltantes.join(", ")}` +
        `\n   Decidí su rol y agregalas a \`equipo/semilla.ts\` ANTES de aplicar. Este es el` +
        `\n   renglón por el que existe este script: \`Tracy\` fue exactamente esto.`,
    );
  }

  const { aSembrar, degradarian } = revisarSemilla(EQUIPO_SEMILLA, process.env);
  console.log(
    `\n— El .env de este server: HERMES_SUPERVISORES=[${supervisoresConfigurados(process.env).join(", ")}] · ` +
      `HERMES_ADMINS=[${adminsConfigurados(process.env).join(", ")}]`,
  );
  if (degradarian.length > 0) {
    console.log(
      `🔴 NO se siembran ${degradarian.join(", ")}: el .env les da supervisor y la semilla les daría` +
        `\n   menos. Una fila activa le gana al CSV, así que sembrarlas les sacaría el padrón y las` +
        `\n   campañas en el próximo restart, sin un error.`,
    );
  }

  const nuevas = aSembrar.filter((p) => !idsEnLaTabla.has(clavePersona(p.personaId)));
  console.log(`\n— A sembrar: ${nuevas.length} de ${EQUIPO_SEMILLA.length}`);
  for (const p of nuevas) console.log(`    + ${clavePersona(p.personaId).padEnd(28)} ${p.rol}`);

  if (!APLICAR) {
    console.log("\n(dry-run: no se escribió nada. Volvé a correr con `-- --aplicar`.)\n");
    return;
  }
  const r = await sembrarEquipo(db, aSembrar);
  if (r.sinTabla) {
    console.log("\n⚠ no se sembró nada: falta la migración de `equipo`.\n");
    return;
  }
  console.log(`\n✅ ${r.personas} personas y ${r.grafias} grafías sembradas.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
