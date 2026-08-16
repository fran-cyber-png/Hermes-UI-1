import { Router } from 'express';
import nodemailer from 'nodemailer';
import { db } from '../db/client.js';
import {
  anotarCorreoEnviado,
  anotarCorreoFallido,
  ultimosCorreos,
} from '../correos/correos.js';
import { requiereVendedora } from '../auth/sesion.js';
import { porQueFallo } from '../lib/porQueFallo.js';
import { ruta } from '../lib/ruta.js';

/**
 * CORREOS — enviar emails desde Hermes, con la filosofía de la casa.
 *
 * Un correo = UNA vendedora → UN destinatario, auditado (tabla `correos`,
 * incluidos los fallidos). Sin listas, sin campañas — eso es otra herramienta
 * y otra política. Sale por el SMTP de Goberna (mail.goberna.us): credenciales
 * por nombre en el .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * SMTP_FROM). Sin configurar → 503 honesto: la UI dice qué falta, no finge.
 */
export const correosRouter = Router();
correosRouter.use(requiereVendedora);

function transporte() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const puerto = Number(SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: puerto,
    // 465 es TLS desde el saludo; 587 arranca en claro y sube con STARTTLS.
    secure: puerto === 465,
    // Fail-closed: sin esto, en el 587 el STARTTLS es OPORTUNISTA — si el
    // servidor no lo anuncia (o alguien se mete en el medio y lo saca del
    // saludo), nodemailer sigue igual y manda usuario y contraseña en claro,
    // sin un solo error. Con esto, ahí falla, que es lo correcto: preferimos un
    // correo que no sale a una credencial que sí.
    requireTLS: puerto !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/** ¿Está conectado el canal? La UI pregunta antes de dibujar el composer. */
correosRouter.get('/estado', (_req, res) => {
  res.json({ conectado: Boolean(transporte()), desde: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? null });
});

/** Los últimos enviados (del equipo — coordinación, no secreto). */
correosRouter.get('/', ruta(async (_req, res) => {
  const filas = await ultimosCorreos(db);
  res.json({ correos: filas });
}));

correosRouter.post('/enviar', ruta(async (req, res) => {
  const { para, asunto, cuerpo, clave } = req.body ?? {};
  const destinatario = String(para ?? '').trim();
  if (!/.+@.+\..+/.test(destinatario) || !String(asunto ?? '').trim() || !String(cuerpo ?? '').trim()) {
    res.status(400).json({ ok: false, message: 'faltan destinatario válido, asunto o cuerpo' });
    return;
  }

  const smtp = transporte();
  if (!smtp) {
    res.status(503).json({
      ok: false,
      message: 'El canal de correo no está conectado: faltan SMTP_HOST/SMTP_USER/SMTP_PASS en el .env del server (la cuenta vive en mail.goberna.us).',
    });
    return;
  }

  const base = {
    vendedoraId: req.vendedoraId!,
    para: destinatario,
    asunto: String(asunto).trim().slice(0, 200),
    cuerpo: String(cuerpo).trim(),
    clave: clave ? String(clave) : null,
  };

  try {
    await smtp.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: destinatario,
      subject: base.asunto,
      text: base.cuerpo,
    });
    const fila = await anotarCorreoEnviado(db, base);
    res.json({ ok: true, correo: fila });
  } catch (err) {
    // El motivo crudo queda en la auditoría (`correos`) y en el log; a la pantalla
    // va un texto genérico — el crudo puede traer el diálogo del SMTP o, si lo que
    // falló fue la consulta, el SQL entero.
    const motivo = porQueFallo(err);
    console.error(`el correo a ${destinatario} no salió — ${motivo}`);
    await anotarCorreoFallido(db, base, motivo);
    res.status(502).json({ ok: false, message: 'El correo no salió. Volvé a intentar en un momento.' });
  }
}));
