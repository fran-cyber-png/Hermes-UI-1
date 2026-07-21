import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversionesWa } from '../db/schema.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ficha } from '../cerberus/ficha.js';

/**
 * La ficha del contacto y el registro de venta. Detrás de auth: muestra PII de
 * clientes (nombre, DNI, compras), y eso solo lo ve una vendedora identificada.
 */
export const contactosRouter = Router();

contactosRouter.get('/ficha', requiereVendedora, async (req, res) => {
  const telefono = typeof req.query.telefono === 'string' ? req.query.telefono : '';
  if (!telefono) {
    res.status(400).json({ estado: 'error', motivo: 'falta el teléfono' });
    return;
  }
  res.json(await ficha(telefono));
});

/**
 * REGISTRAR VENTA — captura la conversión y abre el formulario real de Cerberus.
 *
 * La venta EN SÍ la crea la vendedora en Cerberus (Hermes flaco / Cerberus gordo:
 * no reimplementamos el ERP, con su validación de stock, cuotas y pagos). Lo que
 * Hermes registra —y que hoy no existe— es el ESLABÓN DEL EMBUDO: qué vendedora
 * convirtió a quién, desde qué origen (el anuncio o la landing), y cuándo. Ese es
 * el dato que Ivi va a leer para "cuánto convierte WhatsApp".
 */
contactosRouter.post('/registrar-venta', requiereVendedora, async (req, res) => {
  const tel = String(req.body?.telefono ?? '').replace(/\D/g, '');
  if (!tel) {
    res.status(400).json({ ok: false, message: 'falta el teléfono' });
    return;
  }

  // ¿Ya es cliente? (para atar la conversión al cliente de Cerberus si existe).
  const f = await ficha(tel);
  const clienteId = f.estado === 'cliente' ? f.id : null;

  // El origen del lead: la atribución que capturamos en el primer mensaje.
  const [ev] = await db.execute<{ origen: unknown }>(sql`
    SELECT e.payload->'origen' AS origen
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp' AND i.persona_id = ${tel}
      AND e.payload->>'origen' IS NOT NULL AND e.payload->>'origen' <> 'null'
    ORDER BY i.occurred_at ASC LIMIT 1
  `);

  await db.insert(conversionesWa).values({
    vendedoraId: req.vendedoraId!,
    telefono: tel,
    nombre: typeof req.body?.nombre === 'string' ? req.body.nombre : f.estado === 'cliente' ? f.nombre : null,
    cerberusClienteId: clienteId,
    origen: (ev?.origen as object) ?? null,
  });

  const CERBERUS = (process.env.CERBERUS_BASE_URL ?? 'https://app.goberna.us').replace(/\/$/, '');
  // La venta se completa en el formulario real de Cerberus. Si es cliente conocido,
  // abrimos su ficha (desde ahí Cerberus prellena la venta); si es nuevo, el form
  // de venta directo (la vendedora crea el cliente ahí).
  const cerberusUrl = clienteId ? `${CERBERUS}/clientes/${clienteId}/` : `${CERBERUS}/ventas/crearVenta/`;

  res.json({ ok: true, cerberusUrl, clienteId });
});
