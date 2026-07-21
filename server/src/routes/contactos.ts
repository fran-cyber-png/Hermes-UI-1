import { Router } from 'express';
import { requiereVendedora } from '../auth/sesion.js';
import { ficha } from '../cerberus/ficha.js';

/**
 * La ficha del contacto. Detrás de auth: muestra PII de clientes (nombre, DNI,
 * compras), y eso solo lo ve una vendedora identificada.
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
