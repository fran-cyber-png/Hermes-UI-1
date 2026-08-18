import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { equipo } from "../db/equipo.js";
import { vendedoraIdDeCenturion } from "../auth/centurion.js";
import { PROPOSITO_CAMPANA } from "../numeros/campana.js";
import { sembrarEquipo } from "../equipo/repositorio.js";
import { clavePersona, esRol, ROLES, type Rol } from "../equipo/roles.js";

/**
 * EL ALTA DE UNA PERSONA DEL COMANDO DE CAMPAÑA — `npm run equipo:campana`.
 *
 * ══ 🔴 POR QUÉ ESTE SCRIPT ES LA PRECONDICIÓN DEL LOGIN, Y NO UN ACCESORIO ═══
 *
 * Dar de alta a un agente digital son **dos pasos en dos sistemas**: la cuenta en
 * Centurión (que Hermes no crea ni puede crear — sólo verifica la firma de su
 * token) y **una fila en `numero_vendedora`**, sin la cual
 * `canjearTokenDeCenturion` rechaza con **403 `sin_linea_asignada`**.
 *
 * Y lo único que escribía esa tabla era `PUT /api/admin/numeros/:numero`, cuyo
 * dueño es **Cerberus** — que en el entorno de campaña no existe. O sea que sin
 * esta puerta, toda identidad de Centurión entra y rebota, y el SSO es inusable.
 *
 * ══ LOS TRES CANDADOS, Y CADA UNO TAPA UN DEDAZO SIN SÍNTOMA ════════════════
 *
 * 1. **La línea tiene que existir y ser de campaña.** Un número mal tipeado no
 *    matchea `numeros_wa` y el `INSERT` moriría por la FK; pero uno que existe y
 *    es de la Escuela entraría bien y metería a un operador del comando adentro
 *    del negocio educativo. Se verifica el `proposito` ANTES de escribir nada.
 * 2. **El rol se valida contra `ROLES`.** `rol` es `text` en la base: `supervisr`
 *    escribe una fila perfectamente válida que después no alcanza ningún permiso.
 * 3. **La identidad se arma con `vendedoraIdDeCenturion`**, nunca a mano. El
 *    prefijo `centurion:` es lo que hace que el push declarativo de Cerberus no
 *    la borre (`numeros/origenIdentidad.ts`) — escribir `betto.romero` pelado
 *    deja a la persona funcionando hasta el próximo push de Cerberus, y ahí
 *    desaparece sin error y sin log.
 *
 * ⚠️ **No toca a nadie más de la línea.** El `INSERT` es aditivo con
 * `onConflictDoNothing`, a diferencia de `upsertNumero`, que REEMPLAZA el set
 * entero: usar aquél acá borraría a los demás del comando de un plumazo.
 *
 * **Dry-run por default**, como todo script que escribe en esta casa.
 *
 *   npm run equipo:campana                                          ← ver (read-only)
 *   npm run equipo:campana -- --linea 51963139984
 *   npm run equipo:campana -- --usuario betto.romero --rol admin --nombre "Betto Romero" --linea 51963139984
 *   npm run equipo:campana -- --usuario ... --rol admin --linea ... --aplicar
 *
 * Los roles, leídos en campaña: **`admin` = el candidato** (gestiona a los suyos),
 * **`supervisor`** vigila a los agentes, **`vendedora` = el agente digital** que
 * responde. Es la misma escalera de `equipo/roles.ts`, nombrada para este plano.
 */

function flag(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APLICAR = process.argv.includes("--aplicar");

async function main(): Promise<void> {
  const linea = (flag("linea") ?? "").trim();
  const usuario = (flag("usuario") ?? "").trim();
  const rolCrudo = (flag("rol") ?? "").trim();
  const nombre = (flag("nombre") ?? "").trim();

  // ── Sin `--usuario`: sólo mostrar. Leer nunca escribe. ──────────────────────
  if (!usuario) {
    await mostrar(linea);
    return;
  }

  if (!linea) {
    console.error("\n❌ Falta `--linea`: sin línea la persona entra y come 403 `sin_linea_asignada`.\n");
    process.exitCode = 1;
    return;
  }
  if (!esRol(rolCrudo)) {
    console.error(`\n❌ Rol inválido: «${rolCrudo}». Los que hay: ${ROLES.join(" · ")}.`);
    console.error("   En campaña se leen: admin = el candidato · supervisor · vendedora = agente digital.\n");
    process.exitCode = 1;
    return;
  }
  const rol: Rol = rolCrudo;

  // ── Candado 1: la línea existe y es de campaña ──────────────────────────────
  const [fila] = await db
    .select({ numero: schema.numerosWa.numero, proposito: schema.numerosWa.proposito, etiqueta: schema.numerosWa.etiqueta })
    .from(schema.numerosWa)
    .where(eq(schema.numerosWa.numero, linea))
    .limit(1);

  if (!fila) {
    console.error(`\n❌ La línea «${linea}» no existe en \`numeros_wa\`. Doy de alta el número primero.\n`);
    process.exitCode = 1;
    return;
  }
  if (fila.proposito !== PROPOSITO_CAMPANA) {
    console.error(
      `\n❌ «${linea}» (${fila.etiqueta ?? "sin etiqueta"}) tiene proposito=«${fila.proposito}», no «${PROPOSITO_CAMPANA}».`,
    );
    console.error("   Este script da de alta gente del COMANDO DE CAMPAÑA: meterla en una línea");
    console.error("   de la Escuela la pondría adentro del negocio educativo. No escribo nada.\n");
    process.exitCode = 1;
    return;
  }

  const identidad = vendedoraIdDeCenturion(usuario);
  const aMostrar = nombre || usuario;

  console.log("\n════ ALTA DE CAMPAÑA ════");
  console.log(`  línea      ${fila.numero}  «${fila.etiqueta ?? "—"}»  (${fila.proposito})`);
  console.log(`  usuario    ${usuario}   → identidad \`${identidad}\``);
  console.log(`  rol        ${rol}${rol === "admin" ? "  (el candidato)" : rol === "vendedora" ? "  (agente digital)" : ""}`);
  console.log(`  nombre     ${aMostrar}`);
  console.log(`  origen     centurion  (NO Cerberus: por eso el prefijo, y por eso su push no la borra)`);

  if (!APLICAR) {
    console.log("\n(dry-run: no se escribió nada. Volvé a correr con `-- --aplicar`.)\n");
    await mostrar(linea);
    return;
  }

  // ── Escribir: primero el equipo, después la línea ───────────────────────────
  const siembra = await sembrarEquipo(db, [
    { personaId: identidad, nombre: aMostrar, rol, origen: "centurion", grafias: [identidad] },
  ]);
  if (siembra.sinTabla) {
    console.error("\n⚠️  La tabla `equipo` no existe todavía (falta la migración). La línea sí se escribe:");
    console.error("    sin fila de equipo el rol cae en `vendedora` por la cascada, que es seguro.\n");
  } else if (siembra.personas === 0) {
    console.log(`\n⚠️  «${identidad}» YA estaba en \`equipo\` — no se pisa su rol (la siembra nunca pisa).`);
    console.log("    Si hay que cambiárselo, va por el panel de equipo o un UPDATE explícito.");
  }

  const insertadas = await db
    .insert(schema.numeroVendedora)
    .values({ numero: linea, vendedoraId: identidad })
    .onConflictDoNothing()
    .returning({ n: schema.numeroVendedora.numero });

  console.log(
    insertadas.length > 0
      ? `\n✅ Línea asignada: ya puede entrar por el SSO de Centurión.`
      : `\n✅ Ya tenía la línea asignada (nada que hacer).`,
  );
  await mostrar(linea);
}

/** El estado de las líneas de campaña y quién las atiende. Read-only. */
async function mostrar(soloEsta: string): Promise<void> {
  const filas = await db
    .select({
      numero: schema.numerosWa.numero,
      etiqueta: schema.numerosWa.etiqueta,
      vendedoraId: schema.numeroVendedora.vendedoraId,
      rol: equipo.rol,
      activa: equipo.activa,
      nombre: equipo.nombre,
    })
    .from(schema.numerosWa)
    .leftJoin(schema.numeroVendedora, eq(schema.numeroVendedora.numero, schema.numerosWa.numero))
    .leftJoin(equipo, sql`${equipo.personaId} = lower(btrim(${schema.numeroVendedora.vendedoraId}))`)
    .where(
      soloEsta
        ? and(eq(schema.numerosWa.proposito, PROPOSITO_CAMPANA), eq(schema.numerosWa.numero, soloEsta))
        : eq(schema.numerosWa.proposito, PROPOSITO_CAMPANA),
    )
    .orderBy(schema.numerosWa.numero, schema.numeroVendedora.vendedoraId);

  console.log("\n──── LÍNEAS DE CAMPAÑA Y SU COMANDO ────");
  if (filas.length === 0) {
    console.log("  (ninguna)");
  }
  let ultima = "";
  for (const f of filas) {
    if (f.numero !== ultima) {
      console.log(`\n  ${f.numero}  «${f.etiqueta ?? "—"}»`);
      ultima = f.numero;
    }
    if (!f.vendedoraId) {
      console.log("    ⚠️  sin nadie asignado — quien entre por el SSO come 403");
      continue;
    }
    const rol = f.rol ?? "vendedora (por la cascada: sin fila en `equipo`)";
    const baja = f.activa === false ? "  ⛔ INACTIVA" : "";
    console.log(`    · ${f.vendedoraId}  →  ${rol}${baja}${f.nombre ? `   («${f.nombre}»)` : ""}`);
  }
  console.log("");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
