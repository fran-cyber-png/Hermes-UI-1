import { db } from "../db/client.js";
import { events, interactions } from "../db/schema.js";
import { MetaGraphClient, MetaGraphError } from "./metaClient.js";

/**
 * Captura comentarios y mensajes de Facebook e Instagram.
 *
 * Misma garantía que los leads: el evento crudo primero (fuente de verdad),
 * la proyección después. Idempotente por (source, externalId) — correrlo mil
 * veces nunca duplica ni pierde nada.
 */

export interface ResumenCanal {
  canal: string;
  tipo: string;
  encontrados: number;
  nuevos: number;
  error?: string;
}

/** Guarda una interacción: evento crudo + proyección. Devuelve si era nueva. */
async function guardar(
  source: string,
  raw: any,
  proyeccion: {
    externalId: string;
    canal: string;
    tipo: string;
    /** 'entrante' | 'saliente'. Sin esto no sabemos a quién le respondimos. */
    direccion?: string;
    /** 'persona' | 'pagina' | 'bot'. */
    autor?: string;
    personaId: string | null;
    personaNombre: string | null;
    texto: string | null;
    pageId: string;
    contextoId: string | null;
    contextoTexto: string | null;
    occurredAt: Date;
  },
): Promise<boolean> {
  const [event] = await db
    .insert(events)
    .values({
      source,
      externalId: proyeccion.externalId,
      occurredAt: proyeccion.occurredAt,
      payload: raw,
    })
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  if (!event) return false; // ya lo teníamos

  await db
    .insert(interactions)
    .values({ eventId: event.id, ...proyeccion })
    .onConflictDoNothing({ target: interactions.externalId });

  return true;
}

/** Comentarios en las publicaciones de una Página de Facebook. */
async function comentariosFacebook(client: MetaGraphClient, pageId: string): Promise<ResumenCanal> {
  try {
    const posts = await client.getAll(`${pageId}/posts`, {
      fields: "id,message,created_time,comments.limit(50){id,from,message,created_time}",
      limit: "25",
    });

    let encontrados = 0;
    let nuevos = 0;

    for (const post of posts) {
      // Sigue la paginación anidada: sin esto, todo post con más de 50 comentarios se
      // truncaba en silencio. 112 de nuestros 1.873 posts tocan ese tope.
      const comentarios = await client.getAllNested(post.comments);

      for (const c of comentarios) {
        encontrados += 1;
        const esNuevo = await guardar("meta_comment_fb", { ...c, post_id: post.id }, {
          externalId: c.id,
          canal: "facebook",
          tipo: "comentario",
          personaId: c.from?.id ?? null,
          // Meta oculta el nombre de quien comenta salvo que la app tenga
          // permisos avanzados. Sin nombre igual sirve: el comentario existe.
          personaNombre: c.from?.name ?? null,
          texto: c.message ?? null,
          pageId,
          contextoId: post.id,
          contextoTexto: post.message?.slice(0, 200) ?? null,
          occurredAt: new Date(c.created_time),
        });
        if (esNuevo) nuevos += 1;
      }
    }

    return { canal: "facebook", tipo: "comentario", encontrados, nuevos };
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    return { canal: "facebook", tipo: "comentario", encontrados: 0, nuevos: 0, error: message };
  }
}

/** Conversaciones de Messenger. */
async function mensajesMessenger(client: MetaGraphClient, pageId: string): Promise<ResumenCanal> {
  try {
    const convs = await client.getAll(`${pageId}/conversations`, {
      fields: "id,participants,updated_time,messages.limit(25){id,from,message,created_time}",
      limit: "25",
    });

    let encontrados = 0;
    let nuevos = 0;

    for (const conv of convs) {
      for (const m of conv.messages?.data ?? []) {
        // ANTES esto hacía `if (m.from?.id === pageId) continue` — o sea, TIRABA nuestras
        // propias respuestas. Consecuencia: la base no sabía a quién le habíamos contestado,
        // y "N personas esperando respuesta" era indemostrable con nuestros propios datos.
        // Ahora se guardan las dos mitades de la conversación. Una conversación a medias no
        // es una conversación: es una acusación sin pruebas.
        const esDeLaPagina = m.from?.id === pageId;

        encontrados += 1;
        const esNuevo = await guardar("meta_message_fb", { ...m, conversation_id: conv.id }, {
          externalId: m.id,
          canal: "facebook",
          tipo: "mensaje",
          direccion: esDeLaPagina ? "saliente" : "entrante",
          // Hoy todo lo saliente es humano. El día que se prenda un bot, esto se marca 'bot'
          // y recién ahí se puede medir si vende mejor o peor que una persona.
          autor: esDeLaPagina ? "pagina" : "persona",
          personaId: esDeLaPagina ? null : (m.from?.id ?? null),
          personaNombre: esDeLaPagina ? null : (m.from?.name ?? null),
          texto: m.message ?? null,
          pageId,
          contextoId: conv.id,
          contextoTexto: null,
          occurredAt: new Date(m.created_time),
        });
        if (esNuevo) nuevos += 1;
      }
    }

    return { canal: "facebook", tipo: "mensaje", encontrados, nuevos };
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    return { canal: "facebook", tipo: "mensaje", encontrados: 0, nuevos: 0, error: message };
  }
}

/** Comentarios en las publicaciones de Instagram. */
async function comentariosInstagram(
  client: MetaGraphClient,
  igId: string,
  pageId: string,
): Promise<ResumenCanal> {
  try {
    const media = await client.getAll(`${igId}/media`, {
      fields: "id,caption,timestamp,comments.limit(50){id,from,text,timestamp,username}",
      limit: "25",
    });

    let encontrados = 0;
    let nuevos = 0;

    for (const m of media) {
      // Mismo truncamiento que en Facebook: `comments.limit(50)` sin seguir la paginación
      // anidada corta en silencio los posts más comentados — justo los que más importan.
      const comentarios = await client.getAllNested(m.comments);

      for (const c of comentarios) {
        encontrados += 1;
        const esNuevo = await guardar("meta_comment_ig", { ...c, media_id: m.id }, {
          externalId: c.id,
          canal: "instagram",
          tipo: "comentario",
          personaId: c.from?.id ?? null,
          // En Instagram el @usuario suele ser lo único que da Meta — y alcanza
          // para responderle.
          personaNombre: c.username ?? c.from?.username ?? null,
          texto: c.text ?? null,
          pageId,
          contextoId: m.id,
          contextoTexto: m.caption?.slice(0, 200) ?? null,
          occurredAt: new Date(c.timestamp),
        });
        if (esNuevo) nuevos += 1;
      }
    }

    return { canal: "instagram", tipo: "comentario", encontrados, nuevos };
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    return { canal: "instagram", tipo: "comentario", encontrados: 0, nuevos: 0, error: message };
  }
}

/** Recorre todas las Páginas y captura lo que cada canal permita hoy. */
export async function ingestarInteracciones(token: string) {
  const client = new MetaGraphClient(token);
  const pages = await client.getAll("me/accounts", {
    fields: "id,name,access_token,instagram_business_account",
    limit: "100",
  });

  const resumenes: (ResumenCanal & { pagina: string })[] = [];

  for (const page of pages) {
    const pageClient = new MetaGraphClient(page.access_token);

    const tareas = [
      comentariosFacebook(pageClient, page.id),
      mensajesMessenger(pageClient, page.id),
    ];
    const igId = page.instagram_business_account?.id;
    if (igId) tareas.push(comentariosInstagram(pageClient, igId, page.id));

    for (const r of await Promise.all(tareas)) {
      // Solo se reportan las páginas donde efectivamente hay algo o falló algo.
      if (r.encontrados > 0 || r.error) resumenes.push({ ...r, pagina: page.name });
    }
  }

  return resumenes;
}
