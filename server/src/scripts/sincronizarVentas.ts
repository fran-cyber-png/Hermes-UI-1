import "dotenv/config";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { sincronizaciones } from "../db/operacion.js";
import {
  procesarLote,
  resumenVacio,
  sumarResumen,
  type EventoGuardado,
  type ResumenPuente,
} from "../atribucion/puenteIcarus.js";

/**
 * ⚠️ PUENTE TEMPORAL · `npm run ventas:sincronizar`
 *
 * Proyecta a `conversiones_wa` las ventas que Cerberus ya emitió, releyendo los payloads crudos
 * que quedaron guardados en `icarus.cerberus_events`. Es la mitad de la fase 1 de #161 que **no
 * depende de nadie**: el webhook definitivo necesita que Cerberus haga fan-out (otro repo, otra
 * decisión); esto se puede correr hoy.
 *
 * El porqué —y por qué se apaga— está escrito en `atribucion/puenteIcarus.ts`.
 * El contrato con Cerberus, en `docs/atribucion-de-ventas.md`.
 *
 *     npm run ventas:sincronizar                      # DRY-RUN: mide, no escribe
 *     npm run ventas:sincronizar -- --aplicar         # escribe en la base de Hermes
 *     npm run ventas:sincronizar -- --desde 2026-06-01
 *     npm run ventas:sincronizar -- --limite 500
 *
 * ── Las garantías ──
 * · **Read-only sobre icarus**: la conexión fuerza `default_transaction_read_only` en el paquete
 *   de arranque, así que cualquier escritura la rechaza el servidor, no una convención nuestra.
 * · **Idempotente**: la proyección deduplica por `external_sale_id` / `folio`. Correrlo dos
 *   veces no duplica una sola venta.
 * · **Dry-run por default**: escribir en la base de las vendedoras se pide explícitamente.
 */

const TANDA = 500;

function bandera(nombre: string): boolean {
  return process.argv.slice(2).includes(`--${nombre}`);
}

function valor(nombre: string): string | null {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${nombre}` || a.startsWith(`--${nombre}=`));
  if (i === -1) return null;
  const arg = argv[i];
  const v = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[i + 1];
  if (!v) {
    console.error(`--${nombre} necesita un valor.`);
    process.exit(1);
  }
  return v;
}

const aplicar = bandera("aplicar");
const crudoDesde = valor("desde");
const crudoLimite = valor("limite");

let desde: Date | null = null;
if (crudoDesde) {
  desde = new Date(`${crudoDesde}T00:00:00Z`);
  if (Number.isNaN(desde.getTime())) {
    console.error(`--desde no es una fecha válida: «${crudoDesde}» (formato YYYY-MM-DD).`);
    process.exit(1);
  }
}
const limite = crudoLimite ? Number(crudoLimite) : null;
if (limite !== null && (!Number.isInteger(limite) || limite <= 0)) {
  console.error(`--limite tiene que ser un entero positivo. Recibí: «${crudoLimite}».`);
  process.exit(1);
}

const url = process.env.ICARUS_DATABASE_URL;
if (!url) {
  // FAIL-CLOSED: sin la credencial no hay puente. Ruidoso, no silencioso.
  console.error(
    "ICARUS_DATABASE_URL no está configurado. Es la conexión READ-ONLY al Postgres donde\n" +
      "quedaron los eventos que Cerberus ya emitió (ver server/.env.example). Sin ella, el\n" +
      "puente no corre — y no hay un plan B que invente ventas.",
  );
  process.exit(1);
}

const icarus = postgres(url, {
  max: 2,
  connection: {
    // El servidor rechaza toda escritura en esta sesión, no solo nosotros.
    default_transaction_read_only: true,
    application_name: "hermes-puente-ventas",
  },
  onnotice: () => {},
});

console.log(aplicar ? "PUENTE DE VENTAS — APLICANDO" : "PUENTE DE VENTAS — dry-run (no escribe nada)");
if (desde) console.log(`  Solo eventos desde ${desde.toISOString().slice(0, 10)}.`);
if (limite) console.log(`  Tope de ${limite} eventos.`);
console.log("");

let total: ResumenPuente = resumenVacio();
let ultimoId: number | string = 0;

try {
  while (true) {
    const restantes = limite === null ? TANDA : Math.min(TANDA, limite - total.leidos);
    if (restantes <= 0) break;

    const filtroDesde = desde ? icarus`AND event_timestamp >= ${desde}` : icarus``;
    // Orden por id: los eventos de una misma venta llegan en el orden en que Cerberus los
    // mandó, así que el último —el `sale.updated` con el pago confirmado— es el que queda.
    const filas = (await icarus`
      SELECT id, payload
      FROM icarus.cerberus_events
      WHERE id > ${ultimoId} ${filtroDesde}
      ORDER BY id
      LIMIT ${restantes}
    `) as unknown as EventoGuardado[];

    if (filas.length === 0) break;

    total = sumarResumen(total, await procesarLote(db, filas, { aplicar }));
    ultimoId = filas[filas.length - 1].id;

    console.log(`  ...${total.leidos} eventos leídos`);
  }
} finally {
  await icarus.end({ timeout: 5 });
}

const atribuidas =
  total.atribuidas.llave + total.atribuidas.telefono_e164 + total.atribuidas.telefono_sufijo;
const ventas =
  atribuidas +
  total.sinAtribuir.sin_telefono +
  total.sinAtribuir.sin_conversacion +
  total.sinAtribuir.sin_llave_natural;

console.log("\n=== PUENTE DE VENTAS (temporal) ===");
console.log(`  Eventos leídos:        ${total.leidos}`);
console.log(`  No son venta:          ${total.noSonVenta} (products.sync · sale.deleted · sin id)`);
console.log(`  Payloads inválidos:    ${total.invalidos}`);
for (const m of total.ejemplosInvalidos) console.log(`      · ${m}`);
console.log(`  Ventas evaluadas:      ${ventas}`);
console.log(`  ── ATRIBUIDAS:         ${atribuidas} (${porcentaje(atribuidas, ventas)})`);
console.log(`       por la llave:     ${total.atribuidas.llave}  ← determinista`);
console.log(`       por E.164:        ${total.atribuidas.telefono_e164}`);
console.log(`       por sufijo de 9:  ${total.atribuidas.telefono_sufijo}  ← más débil (#119)`);
console.log(`  ── SIN ATRIBUIR:       ${ventas - atribuidas}`);
console.log(`       sin teléfono:     ${total.sinAtribuir.sin_telefono}`);
console.log(`       sin conversación: ${total.sinAtribuir.sin_conversacion}`);

if (!aplicar) {
  console.log("\n  (dry-run: no se escribió nada. Agregá --aplicar para proyectar de verdad.)");
} else {
  // Que el atraso se NOTE. `sincronizaciones` está vacía en producción y por eso nadie se
  // entera de que una ingesta dejó de correr (#161 E7).
  await db
    .insert(sincronizaciones)
    .values({ fuente: "puente-ventas", cursor: String(total.ultimoId ?? ""), ultimaOk: new Date() })
    .onConflictDoUpdate({
      target: sincronizaciones.fuente,
      set: { cursor: String(total.ultimoId ?? ""), ultimaOk: new Date(), ultimoError: null },
    });

  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM conversiones_wa WHERE external_sale_id IS NOT NULL`,
  );
  console.log(`\n  conversiones_wa con venta de Cerberus: ${n}`);
}

function porcentaje(parte: number, todo: number): string {
  return todo === 0 ? "—" : `${((parte / todo) * 100).toFixed(1)} %`;
}

process.exit(0);
