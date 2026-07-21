import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { interactions } from "../db/schema.js";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";

export const personaRouter = Router();

/**
 * CONTACT MERGE — la idea que respond.io tiene en el centro de su producto:
 * la misma persona, con todo su historial, sin importar por dónde escribió.
 *
 * LÍMITE REAL DE META (no es una decisión nuestra): los IDs de usuario son
 * *scoped* por plataforma. La misma persona tiene un ID en Facebook y otro
 * distinto en Instagram — no hay forma de unirlos automáticamente. Solo se
 * pueden unificar cuando la persona nos deja un email o un teléfono.
 *
 * Lo que SÍ podemos, y es mucho: agrupar todo lo que una persona escribió
 * dentro de un mismo canal. Hay 1.312 personas que ya escribieron más de una
 * vez y hoy se ven como mensajes sueltos.
 */
/**
 * El hilo COMPLETO de una persona en un canal, en orden de conversación (ASC).
 *
 * Existe para el hilo de Messenger: la cola agrupa esos DMs por
 * (canal, persona_id) sin un interactionId único, así que `/:interactionId` no
 * alcanza para abrirlos. Mismos datos, otra llave. Va ANTES de `/:interactionId`
 * para que "conv" no caiga en el Number() de esa ruta.
 */
personaRouter.get("/conv/:canal/:personaId", async (req, res) => {
  const { canal, personaId } = req.params;

  const historial = await db.execute<{
    id: number;
    tipo: string;
    direccion: string;
    autor: string;
    persona_nombre: string | null;
    texto: string | null;
    occurred_at: string;
    status: string;
  }>(sql`
    SELECT id, tipo, direccion, autor, persona_nombre, texto, occurred_at, status
    FROM interactions
    WHERE canal = ${canal} AND persona_id = ${personaId}
    ORDER BY occurred_at ASC
    LIMIT 100
  `);

  const nombre = historial.find((h) => h.persona_nombre)?.persona_nombre ?? null;
  res.json({ historial, canal, nombre, total: historial.length });
});

personaRouter.get("/:interactionId", async (req, res) => {
  const id = Number(req.params.interactionId);

  const [actual] = await db.execute<{
    id: number;
    canal: string;
    persona_id: string | null;
    persona_nombre: string | null;
  }>(sql`SELECT id, canal, persona_id, persona_nombre FROM interactions WHERE id = ${id}`);

  if (!actual) {
    res.status(404).json({ type: "not_found" });
    return;
  }

  // Sin identidad no hay historial que juntar. Pasa en el 99% de los
  // comentarios de Facebook: Meta oculta quién comentó.
  if (!actual.persona_id) {
    res.json({ historial: [], anonima: true, canal: actual.canal });
    return;
  }

  const historial = await db.execute<{
    id: number;
    tipo: string;
    texto: string | null;
    contexto_texto: string | null;
    occurred_at: string;
    status: string;
  }>(sql`
    SELECT id, tipo, texto, contexto_texto, occurred_at, status
    FROM interactions
    WHERE canal = ${actual.canal} AND persona_id = ${actual.persona_id}
    ORDER BY occurred_at DESC
    LIMIT 25
  `);

  res.json({
    historial,
    anonima: false,
    canal: actual.canal,
    nombre: actual.persona_nombre,
    total: historial.length,
  });
});

/**
 * El link para ir a verlo en Facebook/Instagram.
 *
 * No se guarda en la ingesta (sería una llamada extra por cada una de las
 * 18.000 interacciones): se resuelve la primera vez que alguien lo pide, y se
 * cachea.
 */
/**
 * ¿Se le puede mandar un mensaje privado a esta persona?
 *
 * Meta cierra esa puerta a los 7 días del comentario. Medido sobre comentarios
 * reales de Goberna: 40% de los de 0-7 días admiten privado; de los de 8-30
 * días, CERO. Y dentro de la ventana también depende de la configuración de
 * privacidad de la persona.
 *
 * Por eso hay que preguntarlo ANTES de escribir: no tiene sentido redactar un
 * mensaje privado que Meta no va a dejar entregar.
 */
personaRouter.get("/:interactionId/puede-privado", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  const id = Number(req.params.interactionId);

  const [inter] = await db.execute<{
    canal: string;
    tipo: string;
    page_id: string;
    external_id: string;
    dias: number;
    ventana_abierta: boolean;
    puede_privado: boolean | null;
  }>(sql`
    SELECT i.canal, i.tipo, i.page_id, e.external_id,
           extract(day FROM now() - i.occurred_at)::int          AS dias,
           (i.occurred_at > now() - interval '7 days')           AS ventana_abierta,
           i.puede_privado
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.id = ${id}
  `);

  if (!inter) {
    res.status(404).json({ type: "not_found" });
    return;
  }

  // En Instagram el mensaje privado ni siquiera está habilitado (App Review).
  if (inter.canal !== "facebook" || inter.tipo !== "comentario") {
    res.json({ puede: false, motivo: "instagram", dias: inter.dias });
    return;
  }

  // ATAJO QUE AHORRA 14.437 LLAMADAS: fuera de la ventana de 7 días la
  // respuesta es NO, siempre. No hace falta preguntarle a Meta.
  if (!inter.ventana_abierta) {
    res.json({ puede: false, motivo: "ventana-cerrada", dias: inter.dias });
    return;
  }

  // Cacheado de una consulta anterior.
  if (inter.puede_privado !== null) {
    res.json({
      puede: inter.puede_privado,
      motivo: inter.puede_privado ? null : "privacidad",
      dias: inter.dias,
      cacheado: true,
    });
    return;
  }

  // Solo aquí se le pregunta a Meta: dentro de la ventana también depende de la
  // configuración de privacidad de cada persona.
  try {
    const client = new MetaGraphClient(token!);
    const pages = await client.getAll("me/accounts", { fields: "id,access_token", limit: "100" });
    const pageToken = pages.find((p) => p.id === inter.page_id)?.access_token;
    if (!pageToken) throw new Error("sin acceso a la Página");

    const c = await new MetaGraphClient(pageToken).get(inter.external_id, {
      fields: "can_reply_privately",
    });
    const puede = Boolean(c.can_reply_privately);

    await db
      .update(interactions)
      .set({ puedePrivado: puede, puedePrivadoAt: new Date() })
      .where(eq(interactions.id, id));

    res.json({ puede, motivo: puede ? null : "privacidad", dias: inter.dias });
  } catch {
    res.json({ puede: false, motivo: "error", dias: inter.dias });
  }
});

personaRouter.get("/:interactionId/link", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  const id = Number(req.params.interactionId);

  const [inter] = await db.execute<{
    id: number;
    canal: string;
    page_id: string;
    permalink: string | null;
    external_id: string;
    contexto_id: string | null;
  }>(sql`
    SELECT i.id, i.canal, i.page_id, i.permalink, i.contexto_id, e.external_id
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.id = ${id}
  `);

  if (!inter) {
    res.status(404).json({ type: "not_found" });
    return;
  }
  if (inter.permalink) {
    res.json({ permalink: inter.permalink });
    return;
  }

  try {
    const client = new MetaGraphClient(token!);
    const pages = await client.getAll("me/accounts", { fields: "id,access_token", limit: "100" });
    const pageToken = pages.find((p) => p.id === inter.page_id)?.access_token;
    if (!pageToken) throw new Error("No tengo acceso a esa Página.");

    const pageClient = new MetaGraphClient(pageToken);
    let permalink: string | null = null;

    if (inter.canal === "instagram") {
      // En Instagram el comentario no tiene link propio: se linkea la publicación.
      const media = await pageClient.get(inter.contexto_id!, { fields: "permalink" });
      permalink = media.permalink ?? null;
    } else {
      const c = await pageClient.get(inter.external_id, { fields: "permalink_url" });
      permalink = c.permalink_url ?? null;
    }

    if (permalink) {
      await db.update(interactions).set({ permalink }).where(eq(interactions.id, id));
    }
    res.json({ permalink });
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    res.status(502).json({ type: "api_error", message });
  }
});
