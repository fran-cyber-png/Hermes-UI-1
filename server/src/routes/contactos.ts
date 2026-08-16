import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ficha } from '../cerberus/ficha.js';
import { leadDeTelefono } from '../gente/leadDeTelefono.js';
import { registrarVenta } from '../contactos/registrarVenta.js';

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
 * EL LEAD-FORM DEL CONTACTO — el enriquecimiento automático (#113).
 *
 * Aparte de la ficha de Cerberus, esto cruza el teléfono contra `leads` (los
 * formularios de Meta y las landings web): nombre real, EMAIL y campaña. Es una
 * derivación en consulta, no un dato copiado — vive detrás de auth porque muestra
 * PII. `{ lead: null }` cuando el teléfono no matchea ningún lead: la ficha
 * simplemente no muestra el bloque (nunca un placeholder).
 */
contactosRouter.get('/lead', requiereVendedora, async (req, res) => {
  const telefono = typeof req.query.telefono === 'string' ? req.query.telefono : '';
  if (!telefono) {
    res.status(400).json({ estado: 'error', motivo: 'falta el teléfono' });
    return;
  }
  const mapa = await leadDeTelefono(db, [telefono]);
  res.json({ lead: mapa[telefono] ?? null });
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

  const { cerberusUrl, clienteId } = await registrarVenta(db, {
    vendedoraId: req.vendedoraId!,
    telefono: tel,
    nombre: typeof req.body?.nombre === 'string' ? req.body.nombre : null,
  });

  res.json({ ok: true, cerberusUrl, clienteId });
});
