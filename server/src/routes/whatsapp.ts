import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { whatsapp } from '../whatsapp/wiring.js';
import { proyectarMensaje } from '../whatsapp/proyectar.js';
import { repositorioDrizzle } from '../whatsapp/repositorioDrizzle.js';
import { resolverAnuncio } from '../meta/anuncio.js';

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

/** El hilo completo de una conversación, en orden cronológico + de dónde vino el lead. */
whatsappRouter.get('/conversacion/:telefono', async (req, res) => {
  const telefono = req.params.telefono.replace(/\D/g, '');
  const mensajes = await db.execute(sql`
    SELECT id, direccion, autor, texto, occurred_at, external_id
    FROM interactions
    WHERE canal = 'whatsapp' AND persona_id = ${telefono}
    ORDER BY occurred_at ASC
    LIMIT 200
  `);

  // La captura del embudo: si algún mensaje trajo el origen (anuncio/landing), se
  // devuelve — enriquecido con el nombre del anuncio y la campaña si vino de Meta.
  const [fila] = await db.execute<{ origen: { fuente: string; adId?: string; ref?: string } | null }>(sql`
    SELECT e.payload->'origen' AS origen
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono}
      AND e.payload->>'origen' IS NOT NULL AND e.payload->>'origen' <> 'null'
    ORDER BY i.occurred_at ASC LIMIT 1
  `);

  let origen = fila?.origen ?? null;
  if (origen?.fuente === 'anuncio' && origen.adId) {
    const anuncio = await resolverAnuncio(origen.adId);
    origen = { ...origen, ...(anuncio ? { anuncio: anuncio.anuncio, campana: anuncio.campana } : {}) };
  }

  res.json({ telefono, mensajes, origen });
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
