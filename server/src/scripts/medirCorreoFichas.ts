import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ficha } from '../cerberus/ficha.js';

/**
 * MEDICIÓN OPERATIVA (#43): ¿qué % de fichas 'cliente' traen `correo` no vacío?
 *
 * El correo de cotización (Fase 1) lee `Ficha.correo`; si casi ninguna ficha lo
 * trae, ese correo nace muerto — y hay que saberlo ANTES de construirlo. Esto
 * NO es un test de CI: es una medición de una vez, sobre datos reales.
 *
 *   cd /srv/hermes/server && npx tsx src/scripts/medirCorreoFichas.ts
 *
 * SOLO LECTURA: un SELECT sobre `interactions` (los teléfonos de WhatsApp de
 * los últimos 30 días — la misma ventana de la cola) + el `ficha()` de siempre
 * contra los endpoints públicos de Cerberus. No escribe nada en ningún lado, y
 * no imprime teléfonos ni correos: solo los agregados.
 */

const TOPE = Number(process.argv[2] ?? 80);

async function main() {
  const filas = await db.execute<{ telefono: string }>(sql`
    SELECT DISTINCT persona_id AS telefono
    FROM interactions
    WHERE canal = 'whatsapp'
      AND direccion = 'entrante'
      AND persona_id ~ '^[0-9]{8,}$'
      AND occurred_at > now() - interval '30 days'
    LIMIT ${TOPE}
  `);
  console.log(`Muestra: ${filas.length} teléfonos únicos de WhatsApp (entrantes, últimos 30 días)`);

  let clientes = 0;
  let conCorreo = 0;
  let errores = 0;
  for (const { telefono } of filas) {
    const f = await ficha(telefono);
    if (f.estado === 'error') {
      errores++;
    } else if (f.estado === 'cliente') {
      clientes++;
      if (f.correo.trim() !== '') conCorreo++;
    }
    // Respiro entre consultas: es Cerberus de producción, no una carrera.
    await new Promise((r) => setTimeout(r, 250));
  }

  const pct = clientes ? ((conCorreo / clientes) * 100).toFixed(1) : 'n/a';
  console.log(`Fichas estado 'cliente':  ${clientes} de ${filas.length} muestreados`);
  console.log(`Con correo no vacío:      ${conCorreo} de ${clientes} (${pct}%)`);
  console.log(`Errores (Cerberus caído): ${errores}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
