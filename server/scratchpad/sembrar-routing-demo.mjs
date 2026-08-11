import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/**
 * Siembra una base local con las 92 llegadas REALES de click-to-WhatsApp de
 * producción (read-only en origen) para poder mirar la pantalla de Routing con
 * los datos que va a tener de verdad.
 *
 * La galería que muestra el caso ideal no es evidencia: acá las campañas son las
 * dos que existen, con sus nombres, sus estados y su volumen real.
 */

const URL = process.env.DEMO_DATABASE_URL;
const ARCHIVO = process.env.CTWA_ARCHIVO;
if (!URL || !ARCHIVO) throw new Error('faltan DEMO_DATABASE_URL y CTWA_ARCHIVO');

const LINEA = '51984429504';
const sql = postgres(URL, { max: 1, onnotice: () => {} });

const filas = readFileSync(ARCHIVO, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => l.split('|'))
  .filter((p) => p.length === 3);

await sql`DELETE FROM events WHERE source = 'meta_wa_ctwa'`;
let i = 0;
for (const [adId, telefono, cuando] of filas) {
  await sql`
    INSERT INTO events (source, external_id, occurred_at, payload)
    VALUES ('meta_wa_ctwa', ${`wamid-demo-${i++}`}, ${cuando},
            ${sql.json({ from: telefono, referral: { source_id: adId } })})
    ON CONFLICT DO NOTHING`;
}

// La línea y su rueda, tal como están en producción.
await sql`
  INSERT INTO numeros_wa (numero, etiqueta, proposito, activo)
  VALUES (${LINEA}, 'Ventas Meta', 'vendedora', true)
  ON CONFLICT (numero) DO UPDATE SET etiqueta = excluded.etiqueta`;

const RUEDA = [
  ['ventas10@grupogoberna.com', 0, 'si'],
  ['ventas11@grupogoberna.com', 1, 'si'],
  ['ventas12@grupogoberna.com', 2, 'si'],
  ['ventas13@grupogoberna.com', 3, 'no'],
  ['ventas14@grupogoberna.com', 4, 'no'],
  ['Tracy', 5, 'si'],
];
for (const [vendedora, orden, activa] of RUEDA) {
  await sql`
    INSERT INTO reparto_rueda (numero_propio, vendedora_id, orden, activa)
    VALUES (${LINEA}, ${vendedora}, ${orden}, ${activa})
    ON CONFLICT (numero_propio, vendedora_id) DO NOTHING`;
}
await sql`
  INSERT INTO numero_vendedora (numero, vendedora_id) VALUES (${LINEA}, 'Luz')
  ON CONFLICT DO NOTHING`;

const [{ count }] = await sql`SELECT count(*)::int FROM events WHERE source = 'meta_wa_ctwa'`;
console.log(`sembradas ${count} llegadas reales · rueda de ${RUEDA.length} · línea ${LINEA}`);
await sql.end();
