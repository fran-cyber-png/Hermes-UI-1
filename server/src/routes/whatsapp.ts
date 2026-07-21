import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { whatsapp } from '../whatsapp/wiring.js';
import { proyectarMensaje } from '../whatsapp/proyectar.js';
import { repositorioDrizzle } from '../whatsapp/repositorioDrizzle.js';

/**
 * LA CONVERSACIÓN NATIVA DE WHATSAPP dentro de Hermes: ver el hilo y responder,
 * sin salir de la app. Todo envío pasa por `EnvioControlado` (la única puerta):
 * la ruta no llama nunca a `enviarTexto` directo.
 */
export const whatsappRouter = Router();

/** El estado de la sesión, para el banner (conectado / sin-vincular / baneado…). */
whatsappRouter.get('/sesion', (_req, res) => {
  res.json(whatsapp().transporte.estado());
});

/** El hilo completo de una conversación, en orden cronológico. */
whatsappRouter.get('/conversacion/:telefono', async (req, res) => {
  const telefono = req.params.telefono.replace(/\D/g, '');
  const mensajes = await db.execute(sql`
    SELECT id, direccion, autor, texto, occurred_at, external_id
    FROM interactions
    WHERE canal = 'whatsapp' AND persona_id = ${telefono}
    ORDER BY occurred_at ASC
    LIMIT 200
  `);
  res.json({ telefono, mensajes });
});

/**
 * Marcar leído al abrir (ticks azules — decisión de Estephano). Es la única
 * "automatización", y es la que un humano espera al abrir un chat.
 */
whatsappRouter.post('/leido/:telefono', requiereVendedora, async (req, res) => {
  const telefono = req.params.telefono.replace(/\D/g, '');
  const filas = await db.execute<{ external_id: string }>(sql`
    SELECT external_id FROM interactions
    WHERE canal = 'whatsapp' AND persona_id = ${telefono} AND direccion = 'entrante'
    ORDER BY occurred_at DESC LIMIT 50
  `);
  // El external_id se guarda prefijado 'wa:'; el transporte quiere el id crudo.
  const ids = filas.map((f) => f.external_id.replace(/^wa:/, ''));
  try {
    await whatsapp().transporte.marcarLeido(telefono, ids);
  } catch {
    // Marcar leído es cortesía: si falla, no rompe la apertura del chat.
  }
  res.json({ ok: true });
});

/**
 * Responder. La ÚNICA vía de salida: pasa por `EnvioControlado`, que exige la
 * vendedora (del token), audita, y frena si la sesión está baneada.
 */
whatsappRouter.post('/enviar', requiereVendedora, async (req, res) => {
  const { numeroPropio, telefono, texto, referencia } = req.body ?? {};

  const r = await whatsapp().envio.enviar({
    vendedoraId: req.vendedoraId!,
    numeroPropio: String(numeroPropio ?? ''),
    telefono: String(telefono ?? ''),
    texto: String(texto ?? ''),
    referencia: String(referencia ?? ''),
  });

  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo });
    return;
  }

  // Persistimos el saliente (idempotente) para que aparezca en el hilo aunque el
  // transporte no haga eco. D10: SOLO con el idExterno del envío real.
  const proy = proyectarMensaje({
    idExterno: r.idExterno,
    numeroPropio: String(numeroPropio),
    telefono: String(telefono),
    esMio: true,
    esGrupo: false,
    ocurridoEn: r.ocurridoEn,
    nombreVisible: null,
    texto: String(texto),
    clase: 'texto',
  });
  if ('evento' in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);

  res.json({ ok: true, idExterno: r.idExterno });
});
