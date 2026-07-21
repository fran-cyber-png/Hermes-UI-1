import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { whatsapp } from '../whatsapp/wiring.js';
import { proyectarMensaje } from '../whatsapp/proyectar.js';
import { repositorioDrizzle } from '../whatsapp/repositorioDrizzle.js';
import { resolverAnuncio } from '../meta/anuncio.js';
import { RUTA_MEDIA, nombreSeguro } from '../whatsapp/mediaDir.js';
import type { MediaSaliente } from '../whatsapp/transporte.js';

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
  // El adjunto vive en el crudo del evento (payload->media): el JOIN lo trae sin
  // columna nueva — el event store haciendo su trabajo.
  const mensajes = await db.execute(sql`
    SELECT i.id, i.direccion, i.autor, i.texto, i.occurred_at, i.external_id,
           e.payload->'media' AS media
    FROM interactions i
    LEFT JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono}
    ORDER BY i.occurred_at ASC
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

/**
 * Servir un adjunto ya descargado. El nombre se valida contra una lista blanca
 * de caracteres: nada de `..`, nada de rutas — un nombre de archivo o un 404.
 */
whatsappRouter.get('/media/:archivo', (req, res) => {
  const archivo = req.params.archivo;
  if (!/^[A-Za-z0-9._-]+$/.test(archivo) || archivo.includes('..')) {
    res.status(400).json({ ok: false, message: 'nombre de archivo inválido' });
    return;
  }
  const ruta = join(RUTA_MEDIA, archivo);
  if (!existsSync(ruta)) {
    res.status(404).json({ ok: false, message: 'ese archivo no está (¿media vieja de antes de los adjuntos?)' });
    return;
  }
  res.sendFile(ruta);
});

/**
 * Enviar un adjunto (imagen, video, audio o documento). El cuerpo es el archivo
 * CRUDO (Content-Type = su mime); los metadatos van en la query. Pasa por la
 * MISMA puerta que el texto: EnvioControlado, con vendedora y auditoría.
 */
whatsappRouter.post(
  '/enviar-media',
  requiereVendedora,
  express.raw({ type: () => true, limit: '64mb' }),
  async (req, res) => {
    const { telefono, numeroPropio, referencia, caption, nombre } = req.query as Record<string, string | undefined>;
    const mime = req.headers['content-type'] ?? 'application/octet-stream';
    const bytes = req.body as Buffer;

    if (!bytes?.length) {
      res.status(400).json({ ok: false, message: 'el cuerpo tiene que ser el archivo crudo' });
      return;
    }

    const clase: MediaSaliente['clase'] = mime.startsWith('image/')
      ? 'imagen'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'documento';

    // Se guarda primero: el archivo enviado también es parte de la conversación.
    const archivo = nombreSeguro(`out-${Date.now()}-${nombre || 'archivo'}`);
    await writeFile(join(RUTA_MEDIA, archivo), bytes);

    const media: MediaSaliente = {
      ruta: join(RUTA_MEDIA, archivo),
      clase,
      mime,
      nombre: nombre || null,
      texto: caption || null,
    };

    const r = await whatsapp().envio.enviarMedia({
      vendedoraId: req.vendedoraId!,
      numeroPropio: String(numeroPropio ?? ''),
      telefono: String(telefono ?? ''),
      referencia: String(referencia ?? ''),
      media,
    });

    if (!r.ok) {
      res.status(409).json({ ok: false, message: r.motivo });
      return;
    }

    const proy = proyectarMensaje({
      idExterno: r.idExterno,
      numeroPropio: String(numeroPropio),
      telefono: String(telefono),
      esMio: true,
      esGrupo: false,
      ocurridoEn: r.ocurridoEn,
      nombreVisible: null,
      texto: caption || null,
      clase: 'multimedia',
      media: { clase, archivo, mime, nombre: nombre || null },
    });
    if ('evento' in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);

    res.json({ ok: true, idExterno: r.idExterno });
  },
);
