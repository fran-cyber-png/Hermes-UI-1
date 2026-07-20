import type { Request, Response } from "express";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";

/**
 * Receptor de la WhatsApp Cloud API — la ACTIVACIÓN de la atribución de click-to-WhatsApp (docs/36 §2).
 *
 * Contexto: el negocio se pasó de lead-forms a WhatsApp (los lead-forms murieron el 19-may-2026). El
 * único puente de campaña para WhatsApp es el `referral` que Meta adjunta al PRIMER mensaje cuando la
 * persona llegó por un anuncio click-to-WhatsApp: trae `source_id` (el ad_id) y `ctwa_clid`. Sin esto,
 * la atribución se queda clavada en 0,5% para siempre.
 *
 * Este archivo captura ese referral. La cadena de atribución (teléfono → identidad → persona → venta)
 * la resuelve `governa.atribucion.porIdentidad` con la maquinaria de identidad que YA existe
 * (`ontologia.identidades` tiene 5.318 teléfonos). Guardamos el CRUDO primero (fuente de verdad),
 * idempotente por message id — mismo contrato que el webhook de Cerberus (`ruta.ts`).
 *
 * PREREQUISITOS que NO son código (los hace un operador en Meta Business — ver docs/36 / runbook):
 *  - una WhatsApp Business Account (WABA) + número en la Cloud API;
 *  - suscribir el webhook al campo `messages`, apuntando a `https://<backend-público>/webhook/whatsapp`;
 *  - `WHATSAPP_VERIFY_TOKEN` en el `.env` del backend (el mismo que se pone en Meta);
 *  - el backend accesible por HTTPS público (hoy es tailnet — falta exponer esta ruta).
 */

/** GET: verificación del webhook. Meta manda hub.challenge al suscribir; hay que devolverlo. */
export function verificarWhatsapp(req: Request, res: Response): void {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
  if (modo === "subscribe" && esperado && token === esperado) {
    res.status(200).send(typeof challenge === "string" ? challenge : "");
    return;
  }
  res.sendStatus(403); // falla cerrado
}

/**
 * POST: mensajes entrantes. Fast-ack (Meta reintenta si no ve 200 pronto): guardamos y respondemos.
 * El que importa para atribución es el que trae `referral` (click-to-WhatsApp) → source='meta_wa_ctwa';
 * el resto queda como 'meta_wa_msg' (identidad/actividad, sin campaña).
 */
export async function recibirWhatsapp(req: Request, res: Response): Promise<void> {
  const body = req.body;
  res.sendStatus(200); // ack primero; el crudo no debe hacer perder el ack

  try {
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field !== "messages") continue;
        const value = change.value ?? {};

        // Nombre de contacto por wa_id (viene aparte de los mensajes).
        const nombrePorWaId: Record<string, string | null> = {};
        for (const c of value.contacts ?? []) {
          if (c?.wa_id) nombrePorWaId[c.wa_id] = c?.profile?.name ?? null;
        }

        for (const m of value.messages ?? []) {
          if (!m?.id) continue;
          const esCtwa = !!m.referral; // solo los click-to-WhatsApp traen referral
          await db
            .insert(events)
            .values({
              source: esCtwa ? "meta_wa_ctwa" : "meta_wa_msg",
              externalId: m.id,
              occurredAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
              payload: {
                from: m.from, // wa_id = teléfono → puente a ontologia.identidades (tipo='telefono')
                nombre: nombrePorWaId[m.from] ?? null,
                texto: m.text?.body ?? null,
                phoneNumberId: value.metadata?.phone_number_id ?? null,
                // El oro de la atribución: source_id = ad_id del anuncio, + ctwa_clid del click.
                referral: m.referral ?? null,
              },
            })
            .onConflictDoNothing({ target: [events.source, events.externalId] });
        }
      }
    }
  } catch {
    // Ya respondimos 200. El crudo que sí entró queda; un fallo parcial no rompe el ack.
  }
}
