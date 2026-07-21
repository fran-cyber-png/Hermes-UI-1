import { Router } from 'express';
import type { TransporteFalso } from './transporteFalso.js';

/**
 * Ruta de DESARROLLO: inyectar un mensaje entrante como si WhatsApp lo hubiera
 * recibido. Es cómo se demuestra el flujo completo (mensaje → cola) sin vincular
 * un número real ni esperar a que alguien escriba.
 *
 * SOLO se monta cuando el transporte que corre es el falso. En producción, con el
 * transporte whatsmeow, esta ruta no existe: no hay forma de "inyectar" un
 * mensaje falso en una sesión real, ni debería haberla.
 */
export function rutaDevWhatsapp(falso: TransporteFalso): Router {
  const r = Router();

  r.post('/simular', (req, res) => {
    const { telefono, texto, nombre } = req.body ?? {};
    if (typeof telefono !== 'string' || typeof texto !== 'string' || !telefono || !texto) {
      res.status(400).json({ ok: false, message: 'Faltan "telefono" y "texto".' });
      return;
    }
    const m = falso.simularEntrante(telefono, texto, typeof nombre === 'string' ? nombre : null);
    res.json({ ok: true, idExterno: m.idExterno, numeroPropio: m.numeroPropio });
  });

  return r;
}
