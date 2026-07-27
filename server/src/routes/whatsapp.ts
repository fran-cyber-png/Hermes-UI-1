import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { Router } from 'express';
import { sql, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { fotosPerfil } from '../db/schema.js';
import { requiereVendedora } from '../auth/sesion.js';
import { whatsapp } from '../whatsapp/wiring.js';
import { enviarMediaYProyectar, enviarTextoYProyectar } from '../whatsapp/enviarYProyectar.js';
import { resolverAnuncio } from '../meta/anuncio.js';
import { RUTA_MEDIA, nombreSeguro } from '../whatsapp/mediaDir.js';
import { normalizarTelefono } from '../whatsapp/identidadWa.js';
import { FotoNoDisponibleError, type FotoPerfil, type MediaSaliente } from '../whatsapp/transporte.js';
import { cancelarPorRespuestaHumana, faltaEsquema } from '../autorespuesta/repositorio.js';
import { procedenciaDelComposer, type LeerPasoDeSecuencia } from '../procedencia/desdeElComposer.js';
import { obtenerPlantilla } from '../plantillas/repositorio.js';

/**
 * LA CONVERSACIÓN NATIVA DE WHATSAPP dentro de Hermes: ver el hilo y responder,
 * sin salir de la app. Todo envío pasa por `EnvioControlado` (la única puerta):
 * la ruta no llama nunca a `enviarTexto` directo.
 */
export const whatsappRouter = Router();

/**
 * El hilo, con la MARCA DE AUTOMÁTICO en cada burbuja (#125, ADR 0015).
 *
 * El adjunto vive en el crudo del evento (`payload->media`): el JOIN lo trae sin
 * columna nueva — el event store haciendo su trabajo. Lo automático sale de la
 * auditoría de envíos (`envios_wa.automatico`), atada al mensaje por el id que
 * devolvió WhatsApp: la vendedora tiene que poder ver de un vistazo qué salió
 * sin que nadie apretara enviar.
 *
 * Como el `db:push` de esa columna es MANUAL, la consulta degrada: si la columna
 * todavía no está, el hilo se sirve igual (sin marca) en vez de tirar 500.
 */
async function hiloDe(telefono: string, conMarca = true) {
  const marca = conMarca
    ? sql`COALESCE(ew.automatico, false) AS automatico, arp.aprobada_por AS aprobada_por`
    : sql`false AS automatico, NULL::text AS aprobada_por`;
  const join = conMarca
    ? sql`LEFT JOIN envios_wa ew
            ON ew.id_externo IS NOT NULL
           AND ('wa:' || ew.id_externo) = i.external_id
           AND ew.automatico
          -- QUIÉN LO APROBÓ (ADR 0016). Un automático que una persona miró y
          -- autorizó no es lo mismo que uno que salió solo, y la vendedora que
          -- abre el chat tres días después tiene que poder distinguirlos: si no,
          -- el modo supervisado es invisible justo donde importa.
          LEFT JOIN auto_respuestas_pendientes arp
            ON arp.id_externo IS NOT NULL
           AND ('wa:' || arp.id_externo) = i.external_id`
    : sql``;

  try {
    return await db.execute(sql`
      SELECT i.id, i.direccion, i.autor, i.texto, i.occurred_at, i.external_id,
             e.payload->'media' AS media,
             e.payload->'origen' AS origen,
             ${marca}
      FROM interactions i
      LEFT JOIN events e ON e.id = i.event_id
      ${join}
      WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono}
      ORDER BY i.occurred_at ASC
      LIMIT 200
    `);
  } catch (e) {
    if (conMarca && faltaEsquema(e)) {
      console.warn('[whatsapp] `envios_wa.automatico` no existe: sirvo el hilo sin la marca. Corré `npm run db:push` (ADR 0015).');
      return hiloDe(telefono, false);
    }
    throw e;
  }
}

/**
 * El contenido AUTORAL de un paso, leído de la MISMA fila que lee
 * `POST /api/plantillas/:id/enviar-paso`: el texto guardado (con sus
 * `{nombre}`/`{precio}` sin resolver) y el archivo adjunto.
 *
 * Es lo que le falta al cuerpo que manda el navegador, y por eso la versión no
 * se puede calcular con lo que él declara. El porqué, medido, está en
 * `procedencia/desdeElComposer.ts`.
 *
 * **Degrada, pero RUIDOSO.** No poder leer el paso no puede tumbar un envío —la
 * vendedora aprieta Enviar, no «versionar»—, así que devuelve `null` y el envío
 * sale con `pieza_version` en «no sabemos». Pero se avisa: perder la versión en
 * silencio es cómo se acumulan meses de filas que después no cruzan con nada, y
 * es el modo de fallo exacto que este frente existe para no repetir.
 */
function leerPasoDeSecuencia(vendedoraId: string): LeerPasoDeSecuencia {
  return async (plantillaId, orden) => {
    const plantilla = await obtenerPlantilla(db, vendedoraId, plantillaId).catch((e: unknown) => {
      console.error(`[procedencia] no se pudo leer la plantilla ${plantillaId}: el envío sale sin versión de pieza`, e);
      return null;
    });
    const paso = plantilla?.pasos.find((p) => p.orden === orden);
    // `null` = no se pudo determinar el contenido, que es un dato y no un hueco.
    if (!paso) {
      if (plantilla) {
        console.warn(`[procedencia] la plantilla ${plantillaId} no tiene el paso ${orden}: el envío sale sin versión de pieza`);
      }
      return null;
    }
    return { texto: paso.texto, archivo: paso.media?.archivo ?? null };
  };
}

/** El estado de la sesión, para el banner (conectado / sin-vincular / baneado…). */
whatsappRouter.get('/sesion', (_req, res) => {
  res.json(whatsapp().transporte.estado());
});

/** El hilo completo de una conversación, en orden cronológico + de dónde vino el lead. */
whatsappRouter.get('/conversacion/:telefono', async (req, res) => {
  const telefono = req.params.telefono.replace(/\D/g, '');
  const mensajes = await hiloDe(telefono);

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

  // Mandar y persistir el saliente van juntos (`enviarYProyectar.ts`): un envío
  // que sale y no queda en el hilo es un mensaje fantasma, y la vendedora lo
  // manda de nuevo. Las plantillas-secuencia usan la MISMA función.
  const r = await enviarTextoYProyectar({
    vendedoraId: req.vendedoraId!,
    numeroPropio: String(numeroPropio ?? ''),
    telefono: String(telefono ?? ''),
    texto: String(texto ?? ''),
    referencia: String(referencia ?? ''),
    procedencia: await procedenciaDelComposer(req.body?.pieza, leerPasoDeSecuencia(req.vendedoraId!)),
  });

  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo });
    return;
  }

  // La persona ganó de mano a la máquina: si había una auto-respuesta en cola
  // para esta conversación, se cancela (#125). Va acá, en el momento exacto en
  // que deja de hacer falta, y no rompe el envío si el esquema no está.
  // (La proyección del saliente ya la hizo `enviarTextoYProyectar`.)
  await cancelarPorRespuestaHumana(db, String(referencia ?? ''));

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
 * La FOTO DE PERFIL de un contacto de WhatsApp, cacheada. Detrás de auth: la foto
 * es PII. On-demand — se trae al abrir el contacto, una vez, y se guarda en disco
 * como la media. `archivo` null en cache = ya preguntamos y no tiene → 404 sin
 * volver a molestar a WhatsApp hasta que caduque (una semana). El front cae a las
 * iniciales ante cualquier 404/error.
 *
 * Ese cache de negativo SOLO es válido si de verdad preguntamos. Si el transporte
 * no pudo (`FotoNoDisponibleError`: sesión no conectada, típicamente justo tras un
 * restart del server mientras whatsmeow reconecta) se responde 503 y NO se
 * guarda nada — de lo contrario cada restart envenenaría la caché por 7 días
 * para cualquier contacto consultado en ese hueco (hallazgo de la revisión del
 * PR #75).
 */
const FOTO_FRESCA_MS = 7 * 24 * 60 * 60 * 1000;

whatsappRouter.get('/foto/:telefono', requiereVendedora, async (req, res) => {
  const telefono = normalizarTelefono(req.params.telefono);
  if (!telefono) {
    res.status(400).json({ ok: false, message: 'teléfono inválido' });
    return;
  }

  const [cache] = await db.select().from(fotosPerfil).where(eq(fotosPerfil.telefono, telefono));
  const fresca = cache && Date.now() - cache.actualizadoAt.getTime() < FOTO_FRESCA_MS;

  if (fresca) {
    if (!cache.archivo) {
      res.status(404).end(); // ya sabíamos que no tiene foto
      return;
    }
    const ruta = join(RUTA_MEDIA, cache.archivo);
    if (existsSync(ruta)) {
      res.sendFile(ruta);
      return;
    }
    // el archivo se perdió del disco: caemos a re-traer abajo.
  }

  const transporte = whatsapp().transporte;
  let foto: FotoPerfil | null;
  try {
    foto = transporte.fotoDePerfil ? await transporte.fotoDePerfil(telefono) : null;
  } catch (err) {
    if (err instanceof FotoNoDisponibleError) {
      // No pudimos preguntar (sesión no conectada / falla de conexión): 503, sin
      // tocar la caché. Un negativo acá sería «no tiene foto» durante 7 días
      // sobre un contacto que ni siquiera llegamos a consultar.
      res.status(503).json({ ok: false, message: 'no se pudo consultar la foto ahora mismo, reintentá en un momento' });
      return;
    }
    throw err;
  }

  const guardar = (fotoId: string | null, archivo: string | null, mime: string | null) =>
    db
      .insert(fotosPerfil)
      .values({ telefono, fotoId, archivo, mime, actualizadoAt: new Date() })
      .onConflictDoUpdate({
        target: fotosPerfil.telefono,
        set: { fotoId, archivo, mime, actualizadoAt: new Date() },
      });

  if (!foto) {
    await guardar(null, null, null); // cachear "no tiene foto"
    res.status(404).end();
    return;
  }

  const archivo = `pfp-${telefono}.${foto.mime.includes('png') ? 'png' : 'jpg'}`;
  await writeFile(join(RUTA_MEDIA, archivo), foto.bytes);
  await guardar(foto.id, archivo, foto.mime);

  res.setHeader('content-type', foto.mime);
  res.setHeader('cache-control', 'private, max-age=3600');
  res.send(foto.bytes);
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

    const r = await enviarMediaYProyectar({
      vendedoraId: req.vendedoraId!,
      numeroPropio: String(numeroPropio ?? ''),
      telefono: String(telefono ?? ''),
      referencia: String(referencia ?? ''),
      media,
      archivo,
    });

    if (!r.ok) {
      res.status(409).json({ ok: false, message: r.motivo });
      return;
    }

    // Mandar un adjunto también es responder: cancela la automática en cola.
    // (La proyección del saliente ya la hizo `enviarMediaYProyectar`.)
    await cancelarPorRespuestaHumana(db, String(referencia ?? ''));

    res.json({ ok: true, idExterno: r.idExterno });
  },
);
