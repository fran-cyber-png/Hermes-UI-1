import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ingestarInteracciones } from "../meta/interactionsIngestor.js";

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN no está configurado.");
  process.exit(1);
}

console.log("Capturando comentarios y mensajes de Facebook e Instagram...\n");

const resumenes = await ingestarInteracciones(token);

for (const r of resumenes) {
  if (r.error) {
    console.log(`  ⚠️  ${r.pagina} · ${r.canal}/${r.tipo} → ${r.error}`);
    continue;
  }
  const nuevos = r.nuevos > 0 ? `+${r.nuevos} nuevos` : "sin novedades";
  console.log(`  ${r.pagina} · ${r.canal}/${r.tipo}: ${r.encontrados} encontrados → ${nuevos}`);
}

const [total] = await db.execute<{ canal: string; tipo: string; n: number }>(sql`
  SELECT 'TOTAL' AS canal, '' AS tipo, count(*)::int AS n FROM interactions
`);
const porCanal = await db.execute<{ canal: string; tipo: string; n: number }>(sql`
  SELECT canal, tipo, count(*)::int AS n FROM interactions GROUP BY 1, 2 ORDER BY 3 DESC
`);

console.log("\n=== INTERACCIONES EN EL EVENT STORE ===");
for (const r of porCanal) console.log(`  ${r.canal} / ${r.tipo}: ${r.n}`);
console.log(`  TOTAL: ${total.n}`);

process.exit(0);
