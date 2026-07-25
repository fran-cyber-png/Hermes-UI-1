import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { esCotizacion } from "../senales/cotizacion.js";

/**
 * LA REGLA DE CÁLCULO DEL DETECTOR — read-only, para poder discutir su precisión
 * con números en vez de con intuiciones.
 *
 * `npm run medir:cotizaciones [dias]`  (default 14)
 *
 * Compara, sobre los salientes reales de la base a la que apunte `DATABASE_URL`:
 *
 *   · **INGENUO** — «el texto menciona una moneda». Es el criterio que produjo
 *     los 696 de la minería del 2026-07-25, y el que marca «tenemos cuenta
 *     bancaria en soles» como cotización.
 *   · **DETECTOR** — `senales/cotizacion.ts`: monto con moneda, plausible, sin
 *     veto bancario.
 *   · **CORROBORADAS** — de las que el detector acepta, cuántas además mandaron
 *     flyer (multimedia) o temario antes. Es la segunda señal que pidió el dueño.
 *
 * NO ESCRIBE NADA. Imprime además una MUESTRA de los textos que el ingenuo
 * cuenta y el detector rechaza: esa lista es la evidencia de los falsos
 * positivos evitados, y se lee en 30 segundos.
 */

const dias = Number(process.argv[2]) || 14;
const MUESTRA = 15;

interface Fila {
  clave: string;
  texto: string | null;
  con_media: boolean;
  temario: boolean;
}

async function main() {
  const filas = (await db.execute(sql`
    SELECT 'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '') AS clave,
           i.texto,
           (e.payload->'media' IS NOT NULL AND e.payload->>'media' <> 'null') AS con_media,
           (i.texto ~* 'temario')                                            AS temario
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.tipo = 'mensaje'
      AND i.direccion = 'saliente'
      AND i.occurred_at > now() - (${dias} || ' days')::interval
  `)) as unknown as Fila[];

  const ingenuo = new Set<string>();
  const detectado = new Set<string>();
  const conApoyo = new Set<string>();
  const rechazados: string[] = [];

  // Primera pasada: quién mandó flyer/temario (el apoyo de la corroboración).
  const apoyo = new Set<string>();
  for (const f of filas) if (f.con_media || f.temario) apoyo.add(f.clave);

  const RE_INGENUO = /(s\/|soles|\$|usd|d[oó]lares|pen\b)/i;
  for (const f of filas) {
    const texto = f.texto ?? "";
    const esIngenuo = RE_INGENUO.test(texto);
    const v = esCotizacion(texto);
    if (esIngenuo) ingenuo.add(f.clave);
    if (v.esCotizacion) {
      detectado.add(f.clave);
      if (apoyo.has(f.clave)) conApoyo.add(f.clave);
    } else if (esIngenuo && texto.trim() && rechazados.length < 400) {
      rechazados.push(texto.replace(/\s+/g, " ").slice(0, 140));
    }
  }

  const pct = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);

  console.log(`\nVentana: últimos ${dias} días · ${filas.length} mensajes salientes\n`);
  console.log(`  INGENUO (menciona una moneda)     ${ingenuo.size} conversaciones`);
  console.log(`  DETECTOR (monto con moneda)       ${detectado.size} conversaciones`);
  console.log(
    `  descartadas por el detector       ${ingenuo.size - detectado.size} (${pct(ingenuo.size - detectado.size, ingenuo.size)} de las del ingenuo)`,
  );
  console.log(
    `  CORROBORADAS (flyer o temario)    ${conApoyo.size} (${pct(conApoyo.size, detectado.size)} de las detectadas)\n`,
  );

  console.log(`Muestra de textos que el ingenuo contaba y el detector NO (falsos positivos evitados):`);
  for (const t of rechazados.slice(0, MUESTRA)) console.log(`   · ${t}`);
  console.log("");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
