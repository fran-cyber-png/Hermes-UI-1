import { Router } from "express";
import { db } from "../db/client.js";
import {
  interaccionAResponder,
  paginaDeLaInteraccion,
  registrarBorrado,
  registrarRespuesta,
  ultimaRespuestaPublicada,
} from "../responder/repositorioDeRespuestas.js";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";

export const responderRouter = Router();

/**
 * Responder a un comentario. Es la jugada que ManyChat convirtió en un negocio:
 *
 *   alguien comenta "info" → le respondés el comentario en público
 *                          → y le mandás un DM privado con lo que pidió
 *
 * Goberna tiene 5.522 comentarios en Facebook pidiendo información y ninguno
 * fue respondido.
 *
 * DELIBERADAMENTE NO HAY ENVÍO AUTOMÁTICO. Una persona escribe el mensaje y una
 * persona aprieta enviar. Automatizar 5.522 mensajes sin haber probado uno solo
 * es la forma más rápida de que Meta te marque como spam y te limite la Página.
 */

/** Devuelve el token de la Página dueña de esa interacción. */
async function tokenDePagina(token: string, pageId: string): Promise<string | null> {
  const client = new MetaGraphClient(token);
  const pages = await client.getAll("me/accounts", { fields: "id,access_token", limit: "100" });
  return pages.find((p) => p.id === pageId)?.access_token ?? null;
}

responderRouter.post("/:id", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
    return;
  }

  const interactionId = Number(req.params.id);
  // El público y el privado son mensajes DISTINTOS, no el mismo texto repetido.
  // Es el patrón que funciona: el comentario público es corto y remite al
  // privado ("te escribimos por mensaje"); el privado lleva la información real.
  const { mensajePublico, mensajePrivado } = req.body ?? {};

  const publico = Boolean(mensajePublico?.trim());
  const privado = Boolean(mensajePrivado?.trim());

  if (!publico && !privado) {
    // `errores`, como el 409 de abajo: una sola key para el detalle, la que lee ErrorApi.
    res.status(400).json({ type: "validation_error", errores: ["Escribe al menos un mensaje."] });
    return;
  }

  const inter = await interaccionAResponder(db, interactionId);

  if (!inter) {
    res.status(404).json({ type: "not_found", message: "No encontré esa interacción." });
    return;
  }
  if (inter.tipo !== "comentario") {
    res.status(400).json({
      type: "no_soportado",
      message: "Por ahora solo se puede responder a comentarios. Los mensajes de Messenger vienen después.",
    });
    return;
  }

  const pageToken = await tokenDePagina(token, inter.page_id);
  if (!pageToken) {
    res.status(400).json({ type: "api_error", message: "No tengo acceso a la Página de ese comentario." });
    return;
  }

  const client = new MetaGraphClient(pageToken);
  const commentId = inter.external_id;
  const resultado: { publico?: string; privado?: string; errores: string[] } = { errores: [] };

  /**
   * EL ORDEN IMPORTA, y lo aprendimos rompiéndolo.
   *
   * La primera versión publicaba el comentario ("te enviamos la info por
   * privado") ANTES de intentar el privado. El privado falló y quedó una
   * promesa falsa, pública, bajo la marca del cliente.
   *
   * Ahora: PRIMERO el privado. Si el usuario pidió los dos y el privado falla,
   * NO se publica nada — porque el texto público casi siempre lo referencia.
   * Mejor no responder que mentir en público.
   */
  if (privado) {
    try {
      const r = await client.post(`${commentId}/private_replies`, { message: mensajePrivado });
      resultado.privado = r.id;
    } catch (err) {
      const e = err instanceof MetaGraphError ? err.message : (err as Error).message;
      resultado.errores.push(`Mensaje privado: ${e}`);
    }
  }

  const privadoFallo = privado && !resultado.privado;
  if (publico && privadoFallo) {
    res.status(409).json({
      type: "abortado",
      message:
        "No se publicó nada. El mensaje privado falló, y el comentario público lo daba por hecho — publicarlo sería mentirle a esa persona.",
      errores: resultado.errores,
    });
    return;
  }

  if (publico) {
    try {
      const r = await client.post(`${commentId}/comments`, { message: mensajePublico });
      resultado.publico = r.id;
    } catch (err) {
      const e = err instanceof MetaGraphError ? err.message : (err as Error).message;
      resultado.errores.push(`Respuesta pública: ${e}`);
    }
  }

  const algoSalioBien = resultado.publico || resultado.privado;
  if (algoSalioBien) {
    await registrarRespuesta(db, "comentario", interactionId, {
      mensajePublico,
      mensajePrivado,
      resultado,
    });
  }

  res.json({
    type: algoSalioBien ? "enviado" : "error",
    ...resultado,
  });
});

/**
 * Borrar una respuesta que publicamos.
 *
 * Esto es lo que hace que responder sea seguro: si el mensaje sale mal, se
 * puede sacar. Lo probamos en serio — fue así como limpiamos un comentario
 * publicado por error.
 *
 * Solo borra respuestas NUESTRAS (las que están registradas en el event store).
 * Nunca borra el comentario de la persona: eso sería censurar a un cliente.
 */
responderRouter.delete("/:id", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  const interactionId = Number(req.params.id);

  const evento = await ultimaRespuestaPublicada(db, interactionId);

  if (!evento?.payload?.resultado?.publico) {
    res.status(404).json({ type: "not_found", message: "No hay una respuesta publicada para borrar." });
    return;
  }

  const inter = await paginaDeLaInteraccion(db, interactionId);

  const pageToken = await tokenDePagina(token!, inter.page_id);
  if (!pageToken) {
    res.status(400).json({ type: "api_error", message: "No tengo acceso a esa Página." });
    return;
  }

  try {
    const client = new MetaGraphClient(pageToken);
    // El DELETE de la Graph API va como POST con ?method=delete.
    await client.post(evento.payload.resultado.publico, { method: "delete" });

    await registrarBorrado(db, interactionId, evento.payload.resultado.publico);

    res.json({ type: "borrado" });
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    res.status(502).json({ type: "api_error", message });
  }
});
