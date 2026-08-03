import type { Request, Response } from "express";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { gestorWhatsappSiActivo } from "../whatsapp/wiring.js";
import { TransporteCloudApi } from "../whatsapp/transporteCloudApi.js";
import { notificarEntrante } from "../bot/ingesta.js";
import { configDesdeEnv } from "../bot/config.js";
import { claveDeLlamada } from "./llamadas.js";

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
 *  - para LLAMADAS, suscribir además el campo `calls` — y ese orden no es opcional: Meta
 *    RECHAZA habilitar el calling en el número mientras la app no esté suscrita (error 138018,
 *    «technical pre-requisites are not met»). Primero el webhook, después el switch;
 *  - `WHATSAPP_VERIFY_TOKEN` en el `.env` del backend (el mismo que se pone en Meta);
 *  - el backend accesible por HTTPS público (hoy es tailnet — falta exponer esta ruta).
 *
 * SPIKE (30-jul-2026): además de guardar el crudo para atribución, si hay un
 * `TransporteCloudApi` activo (número de PRUEBA, `WHATSAPP_TRANSPORTE=cloud-api`)
 * y el `phone_number_id` del payload es el suyo, este archivo también le entrega
 * el mensaje — así aparece como conversación real en Hermes, no solo en `events`.
 * Ver `whatsapp/transporteCloudApi.ts`.
 */

/**
 * Guarda el CRUDO de cada evento de llamada. No interpreta nada todavía: hoy no hay con qué
 * atender una llamada (falta WebRTC o SIP), así que lo único honesto es dejar el rastro para
 * poder mirarlo después. Cuando exista el audio, la lógica se cuelga de acá.
 */
async function guardarLlamadas(value: Record<string, any>): Promise<void> {
  for (const c of value.calls ?? []) {
    if (!c?.id) continue; // sin id no hay idempotencia posible; mejor perderlo que duplicarlo
    console.log(
      `[webhook whatsapp] llamada evento=${c.event ?? "?"} direccion=${c.direction ?? "?"} ` +
        `de=${c.from ?? "?"} estado=${c.status ?? "-"} id=${c.id}`,
    );
    await db
      .insert(events)
      .values({
        source: "meta_wa_call",
        externalId: claveDeLlamada(c),
        occurredAt: c.timestamp ? new Date(Number(c.timestamp) * 1000) : new Date(),
        payload: { ...c, phoneNumberId: value.metadata?.phone_number_id ?? null },
      })
      .onConflictDoNothing({ target: [events.source, events.externalId] });
  }
}

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
        // LAS LLAMADAS VIENEN EN SU PROPIO CAMPO (`calls`), y hasta el 3-ago-2026 este bucle
        // las tiraba junto con todo lo que no fuera `messages`: una llamada entrante no dejaba
        // rastro en NINGÚN lado —ni en `events`, ni en la cola, ni en un log—, así que era
        // indistinguible de que Meta no la hubiera mandado. Guardar el crudo es lo primero.
        if (change?.field === "calls") {
          await guardarLlamadas(change.value ?? {});
          continue;
        }

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
                // La RESPUESTA al pedido de permiso de llamada llega acá dentro, no en `calls`:
                // es un mensaje interactivo del usuario. Sin esto, un «sí, llamame» se guardaba
                // como una fila con `texto: null` — indistinguible de un mensaje vacío.
                interactive: m.interactive ?? null,
              },
            })
            .onConflictDoNothing({ target: [events.source, events.externalId] });
        }

        // SPIKE cloud-api (30-jul-2026): si hay un transporte Cloud API activo Y
        // este `value` es DE ese número (mismo phone_number_id), también se lo
        // entregamos — así aparece como conversación real en Hermes y no solo
        // en `events` (que es atribución cruda, no la cola). Ver transporteCloudApi.ts.
        const linea = gestorWhatsappSiActivo()
          ?.todos()
          .find((l) => l.transporte instanceof TransporteCloudApi);
        if (
          linea &&
          linea.transporte instanceof TransporteCloudApi &&
          value.metadata?.phone_number_id === linea.transporte.phoneNumberId
        ) {
          await linea.transporte.recibirEntrante(value).catch((err: unknown) => {
            console.error("[webhook whatsapp] cloud-api recibirEntrante falló:", (err as Error).message);
          });

          // Notificar al despachador del bot (si la línea está habilitada)
          const cfgBot = configDesdeEnv();
          const numeroLinea = linea.numero;
          if (cfgBot.lineas.includes(numeroLinea)) {
            for (const m of value.messages ?? []) {
              if (!m?.id || !m?.from) continue;
              const clave = `conv:whatsapp:${m.from}:${numeroLinea}`;
              notificarEntrante(clave, numeroLinea, new Date(), cfgBot).catch((err) =>
                console.error("[bot] notificarEntrante falló:", (err as Error).message),
              );
            }
          }
        }
      }
    }
  } catch {
    // Ya respondimos 200. El crudo que sí entró queda; un fallo parcial no rompe el ack.
  }
}
