import { Router } from 'express';
import type { GestorWhatsapp } from './gestor.js';

/**
 * Ruta de DESARROLLO: inyectar un mensaje entrante como si WhatsApp lo hubiera
 * recibido. Es cómo se demuestra el flujo completo (mensaje → cola) sin vincular
 * un número real ni esperar a que alguien escriba.
 *
 * SOLO se monta cuando el transporte que corre es el falso. En producción, con el
 * transporte whatsmeow, esta ruta no existe: no hay forma de "inyectar" un
 * mensaje falso en una sesión real, ni debería haberla.
 *
 * ══ POR QUÉ RECIBE EL GESTOR Y NO UN TRANSPORTE ═════════════════════════════
 *
 * Recibía **el falso de la primera línea**, y con eso no se podía reproducir en
 * dev el único escenario que #50 agregó: dos líneas vivas. Todo mensaje
 * inyectado entraba por la primera, así que la cola nunca mostraba una
 * conversación de la segunda — y por lo tanto **nada que dependa de la línea se
 * podía ver funcionar sin vincular un número real**, que es exactamente lo que
 * esta ruta existe para evitar.
 *
 * `numeroPropio` es opcional y cae a la primera línea: lo que ya andaba, sigue
 * andando igual. Un número que no corre es un **400 con la lista de los que sí**
 * — no un mensaje que entra por la línea equivocada y se descubre después,
 * mirando una cola que no cuadra.
 */
export function rutaDevWhatsapp(gestor: GestorWhatsapp): Router {
  const r = Router();

  r.post('/simular', (req, res) => {
    const { telefono, texto, nombre, numeroPropio } = req.body ?? {};
    if (typeof telefono !== 'string' || typeof texto !== 'string' || !telefono || !texto) {
      res.status(400).json({ ok: false, message: 'Faltan "telefono" y "texto".' });
      return;
    }

    const linea = typeof numeroPropio === 'string' && numeroPropio ? gestor.de(numeroPropio) : gestor.primero();
    if (!linea) {
      res.status(400).json({
        ok: false,
        message: `La línea ${numeroPropio} no está corriendo. Vivas: ${gestor.numeros().join(', ')}.`,
      });
      return;
    }
    // El falso es el único que sabe fabricar un entrante. Con whatsmeow esta ruta
    // no se monta, pero una línea real dentro de un gestor mixto sí llegaría acá.
    if (!linea.falso) {
      res.status(400).json({ ok: false, message: `La línea ${linea.numero} no es un transporte falso.` });
      return;
    }

    const m = linea.falso.simularEntrante(telefono, texto, typeof nombre === 'string' ? nombre : null);
    res.json({ ok: true, idExterno: m.idExterno, numeroPropio: m.numeroPropio });
  });

  return r;
}
