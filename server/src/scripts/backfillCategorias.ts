import 'dotenv/config';
import { db } from '../db/client.js';
import { backfillCategorias } from '../categorias/consultarCategorias.js';

/**
 * BACKFILL one-off de categorías (#48): siembra el CATÁLOGO a partir de las
 * etiquetas de texto libre que ya existen.
 *
 *   cd server && npm run backfill:categorias
 *
 * Por cada `(vendedora_id, lower(etiqueta))` distinto de `etiquetas`, crea una
 * categoría `color='pizarra'` (neutro — la vendedora la recolorea después), con
 * `orden` por frecuencia descendente. Idempotente: re-correrlo no duplica
 * (`ON CONFLICT DO NOTHING` sobre el `unique(vendedora_id, nombre)`).
 *
 * Corré esto UNA vez tras el `db:push` que crea la tabla `categorias`.
 */
async function main(): Promise<void> {
  const creadas = await backfillCategorias(db);
  console.log(`[backfill:categorias] ${creadas} categoría(s) sembrada(s) desde etiquetas existentes.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill:categorias] falló:', err);
    process.exit(1);
  });
