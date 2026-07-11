import "dotenv/config";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";

/**
 * Borra de Meta objetos creados en una prueba, sin dejar basura en la cuenta.
 *
 *   npx tsx src/scripts/cleanupTest.ts <adId> <adsetId> <campaignId>
 *
 * REGLA DE ORO: esta plataforma NO debe tocar lo que el equipo ya tiene
 * corriendo. Por eso, antes de borrar cualquier cosa, se verifica que:
 *
 *   1. esté PAUSADA (una campaña viva jamás se toca), y
 *   2. NO tenga gasto (si gastó plata, es real — no es una prueba).
 *
 * Si alguna de las dos falla, se niega a borrar y avisa. Es deliberadamente
 * más molesto que peligroso: nunca borra por patrón de nombre, ni "todo lo
 * pausado", ni acepta comodines. Solo ids explícitos que pasen el chequeo.
 *
 * El orden importa: Meta no deja borrar un conjunto con anuncios adentro, ni
 * una campaña con conjuntos. Va de adentro hacia afuera.
 */
const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN no está configurado.");
  process.exit(1);
}

const ids = process.argv.slice(2).filter(Boolean);
if (ids.length === 0) {
  console.error("Uso: npx tsx src/scripts/cleanupTest.ts <adId> <adsetId> <campaignId>");
  process.exit(1);
}

const client = new MetaGraphClient(token);

/** Se niega a borrar si el objeto está activo o si alguna vez gastó plata. */
async function esSeguroBorrar(id: string): Promise<{ ok: boolean; motivo: string; nombre?: string }> {
  const info = await client.get(id, { fields: "name,status,effective_status" });

  const activo = info.status === "ACTIVE" || info.effective_status === "ACTIVE";
  if (activo) return { ok: false, motivo: "está ACTIVA — no se toca lo que está corriendo", nombre: info.name };

  // ¿Gastó alguna vez? Si sí, es real, no una prueba.
  let spend = 0;
  try {
    const ins = await client.get(`${id}/insights`, { fields: "spend", date_preset: "maximum" });
    spend = Number(ins.data?.[0]?.spend ?? 0);
  } catch {
    // Sin insights = nunca corrió. Es la respuesta esperada para una prueba.
  }
  if (spend > 0) {
    return { ok: false, motivo: `tiene gasto real (${spend}) — no es una prueba`, nombre: info.name };
  }

  return { ok: true, motivo: "pausada y sin gasto", nombre: info.name };
}

for (const id of ids) {
  try {
    const check = await esSeguroBorrar(id);
    if (!check.ok) {
      console.log(`  🛑 NO BORRADO ${id} (“${check.nombre}”) → ${check.motivo}`);
      continue;
    }
    // El DELETE de la Graph API se hace con ?method=delete sobre un POST.
    await client.post(id, { method: "delete" });
    console.log(`  ✅ borrado ${id} (“${check.nombre}”) — ${check.motivo}`);
  } catch (err) {
    const msg = err instanceof MetaGraphError ? `${err.errorCode}: ${err.message}` : (err as Error).message;
    console.log(`  ❌ ${id} → ${msg}`);
  }
}

process.exit(0);
