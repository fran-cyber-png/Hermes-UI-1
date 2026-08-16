import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { conversionesWa } from '../db/schema.js';
import { ficha } from '../cerberus/ficha.js';

/**
 * EL SEAM DE «REGISTRAR VENTA» — `db` inyectado (ADR 0008).
 *
 * La ruta le pasa el singleton, el test su base de prueba: por eso la base entra
 * como primer parámetro y nunca se importa el singleton acá adentro. El router
 * (`routes/contactos.ts`) queda con lo suyo —validar el teléfono y serializar la
 * respuesta— y el porqué del endpoint sigue escrito arriba de esa ruta.
 */

export interface OpcionesRegistrarVenta {
  /** Quién registra la venta (username de Cerberus, del token). */
  vendedoraId: string;
  /** El teléfono, ya normalizado a dígitos por la ruta. */
  telefono: string;
  /**
   * El nombre que mandó la vendedora, o `null` si no mandó ninguno: ahí se cae
   * al nombre de Cerberus cuando la persona ya es cliente.
   */
  nombre: string | null;
}

export interface ResultadoRegistrarVenta {
  /** A dónde mandar a la vendedora para completar la venta en Cerberus. */
  cerberusUrl: string;
  /** El id de cliente en Cerberus, si ya existía. */
  clienteId: number | null;
}

export async function registrarVenta(
  base: typeof db,
  o: OpcionesRegistrarVenta,
): Promise<ResultadoRegistrarVenta> {
  const tel = o.telefono;

  // ¿Ya es cliente? (para atar la conversión al cliente de Cerberus si existe).
  const f = await ficha(tel);
  const clienteId = f.estado === 'cliente' ? f.id : null;

  // El origen del lead: la atribución que capturamos en el primer mensaje.
  const [ev] = await base.execute<{ origen: unknown }>(sql`
    SELECT e.payload->'origen' AS origen
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp' AND i.persona_id = ${tel}
      AND e.payload->>'origen' IS NOT NULL AND e.payload->>'origen' <> 'null'
    ORDER BY i.occurred_at ASC LIMIT 1
  `);

  await base.insert(conversionesWa).values({
    vendedoraId: o.vendedoraId,
    telefono: tel,
    nombre: o.nombre ?? (f.estado === 'cliente' ? f.nombre : null),
    cerberusClienteId: clienteId,
    origen: (ev?.origen as object) ?? null,
  });

  const CERBERUS = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');
  // La venta se completa en el formulario real de Cerberus. Si es cliente conocido,
  // abrimos su ficha (desde ahí Cerberus prellena la venta); si es nuevo, el form
  // de venta directo (la vendedora crea el cliente ahí).
  const cerberusUrl = clienteId ? `${CERBERUS}/clientes/${clienteId}/` : `${CERBERUS}/ventas/crearVenta/`;

  return { cerberusUrl, clienteId };
}
