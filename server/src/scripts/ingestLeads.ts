import "dotenv/config";
import { ingestAllLeads, leadColdnessStats } from "../meta/leadsIngestor.js";

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN no está configurado.");
  process.exit(1);
}

console.log("Ingiriendo leads de Meta...\n");

const { summaries, errors } = await ingestAllLeads(token);

for (const s of summaries) {
  const nuevos = s.inserted > 0 ? `+${s.inserted} nuevos` : "sin novedades";
  console.log(`  ${s.pageName} · ${s.formName}`);
  console.log(`     ${s.fetched} leads en Meta → ${nuevos} (${s.alreadyKnown} ya estaban)`);
}

if (errors.length > 0) {
  console.log("\nPáginas que no se pudieron leer (probablemente partner-shared sin permiso de Leads):");
  for (const e of errors) console.log(`  - ${e.pageName}: ${e.message}`);
}

const stats = await leadColdnessStats();
console.log("\n=== ESTADO DEL EVENT STORE ===");
console.log(`  Leads totales:       ${stats.total}`);
console.log(`  Sin atender:         ${stats.sin_atender}`);
console.log(`  Lead más viejo:      ${stats.lead_mas_viejo}`);
console.log(`  Antigüedad promedio: ${stats.dias_promedio_frio} días`);

process.exit(0);
