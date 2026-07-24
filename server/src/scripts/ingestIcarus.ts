import "dotenv/config";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  ingestarLote,
  sumarResumen,
  type ResumenIcarus,
} from "../icarus/ingestor.js";
import type { SubmissionIcarus } from "../icarus/mapeo.js";

/**
 * INGESTA READ-ONLY de las submissions de las landings web (ICARUS) → `leads`
 * (#114). Manual, como `ingest:leads`: `npm run ingest:icarus [-- --desde YYYY-MM-DD]`.
 *
 * icarus vive en el MISMO VPS1, en su propio Postgres (schema `icarus`). Este
 * script SOLO LEE de ahí — nunca escribe: la conexión fuerza
 * `default_transaction_read_only=on` a nivel de sesión, así que cualquier INSERT
 * o UPDATE contra icarus falla en el servidor, no solo por convención. Lo que
 * escribe es la base de Hermes (event store + `leads`), vía `ingestarLote`.
 */

const TANDA = 1000;

/** Lee `--desde YYYY-MM-DD` (o `--desde=YYYY-MM-DD`) para corridas incrementales. */
function parsearDesde(argv: string[]): Date | null {
  const idx = argv.findIndex((a) => a === "--desde" || a.startsWith("--desde="));
  if (idx === -1) return null;

  const arg = argv[idx];
  const valor = arg.includes("=") ? arg.split("=")[1] : argv[idx + 1];
  if (!valor) {
    console.error("--desde necesita una fecha YYYY-MM-DD.");
    process.exit(1);
  }

  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) {
    console.error(`--desde no es una fecha válida: «${valor}» (formato YYYY-MM-DD).`);
    process.exit(1);
  }
  return fecha;
}

const url = process.env.ICARUS_DATABASE_URL;
if (!url) {
  // FAIL-CLOSED: sin la credencial no hay nada que ingerir. Ruidoso, no silencioso.
  console.error(
    "ICARUS_DATABASE_URL no está configurado. Es la conexión READ-ONLY al Postgres " +
      "de icarus (ver server/.env.example). Sin ella, la ingesta no corre.",
  );
  process.exit(1);
}

const desde = parsearDesde(process.argv.slice(2));

// Conexión de SOLO LECTURA a icarus. `default_transaction_read_only=on` va en el
// paquete de arranque: el servidor rechaza toda escritura en esta sesión.
const icarus = postgres(url, {
  max: 2,
  connection: {
    // El servidor rechaza toda escritura en esta sesión. postgres.js serializa
    // el booleano a "true", que Postgres acepta para este GUC igual que "on".
    default_transaction_read_only: true,
    application_name: "hermes-ingest-icarus",
  },
  onnotice: () => {},
});

console.log("Ingiriendo submissions de landings web (icarus)...");
if (desde) console.log(`  Solo desde ${desde.toISOString().slice(0, 10)} (submitted_at).`);
console.log("");

let total: ResumenIcarus = { leidos: 0, insertados: 0, yaEstaban: 0, descartados: 0 };
// Keyset por id (mejor que OFFSET para 25k filas): la próxima tanda arranca
// después del último id visto. `ultimoId` conserva el tipo que devuelve el
// driver (int → number, bigint → string); Postgres compara igual.
let ultimoId: number | string = 0;

try {
  while (true) {
    const filtroDesde = desde ? icarus`AND submitted_at >= ${desde}` : icarus``;
    const filas = (await icarus`
      SELECT id, contact_id, product_id, source, source_detail, form_name,
             landing_page, product_name, raw_product_name, name, email, phone,
             country, ocupacion, payload, submitted_at, created_at
      FROM icarus.contact_form_submissions
      WHERE id > ${ultimoId} ${filtroDesde}
      ORDER BY id
      LIMIT ${TANDA}
    `) as unknown as SubmissionIcarus[];

    if (filas.length === 0) break;

    total = sumarResumen(total, await ingestarLote(db, filas));
    ultimoId = filas[filas.length - 1].id;

    // Latido: para 25k filas conviene ver que avanza.
    console.log(`  ...${total.leidos} leídas (+${total.insertados} nuevas hasta acá)`);
  }
} finally {
  await icarus.end({ timeout: 5 });
}

const [{ n }] = await db.execute<{ n: number }>(
  sql`SELECT count(*)::int AS n FROM leads WHERE lead_id LIKE 'icarus:%'`,
);

console.log("\n=== INGESTA ICARUS ===");
console.log(`  Submissions leídas:  ${total.leidos}`);
console.log(`  Leads nuevos:        ${total.insertados}`);
console.log(`  Ya estaban:          ${total.yaEstaban}`);
console.log(`  Descartadas:         ${total.descartados} (sin teléfono ni email)`);
console.log(`  Total icarus en base: ${n}`);

process.exit(0);
