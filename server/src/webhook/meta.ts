import type { Request, Response } from "express";
import { db } from "../db/client.js";
import { guardarInteraccion } from "../meta/proyectarInteraccion.js";
import { interpretar } from "./metaPayload.js";

/**
 * EL CABLEADO del webhook de Meta. La TRADUCCIÓN vive aparte, en
 * `metaPayload.ts`, y no por prolijidad: acá adentro se importa `db`, así que un
 * test de los payloads reales de Meta —el eco, el `verb: 'remove'`, el
 * comentario de IG sin hora— exigiría `DATABASE_URL` para verificar una función
 * que no toca la base. El porqué de cada decisión está en ese archivo.
 */

/**
 * GET: la verificación de Meta al suscribir. Mismo `WHATSAPP_VERIFY_TOKEN` que
 * el webhook de WhatsApp — es la MISMA app de Meta, y tener dos tokens para la
 * misma app sería un secreto más que mantener sin nada que gane. Falla cerrado.
 */
export function verificarMeta(req: Request, res: Response): void {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
  if (modo === "subscribe" && esperado && token === esperado) {
    res.status(200).send(typeof challenge === "string" ? challenge : "");
    return;
  }
  res.sendStatus(403);
}

/**
 * POST: **ack primero**. Meta reintenta si no ve un 200 pronto y desactiva la
 * suscripción tras fallar seguido — perder un comentario por tardar en escribir
 * es peor que escribirlo un segundo después. Mismo contrato que
 * `recibirWhatsapp` y que el webhook de Cerberus.
 */
export async function recibirMeta(req: Request, res: Response): Promise<void> {
  const body = req.body;
  res.sendStatus(200);

  try {
    const items = interpretar(body);
    if (items.length === 0) return;

    let nuevos = 0;
    for (const item of items) {
      // De a uno y con su propio try: un payload raro en el tercer comentario no
      // puede llevarse puestos los dos que ya se entendieron.
      try {
        if (await guardarInteraccion(item, db)) nuevos += 1;
      } catch (err) {
        console.error(
          `[webhook-meta] no se pudo guardar ${item.source}/${item.proyeccion.externalId}`,
          err,
        );
      }
    }
    console.log(`[webhook-meta] ${items.length} interacciones, ${nuevos} nuevas`);
  } catch (err) {
    // Ya respondimos 200: acá solo queda dejar rastro. Un throw sin capturar
    // sería un unhandledRejection que tumba el proceso de las vendedoras.
    console.error("[webhook-meta] error procesando el body", err);
  }
}
