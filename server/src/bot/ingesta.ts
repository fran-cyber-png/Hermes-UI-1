import { db } from "../db/client.js";
import { botPendientes } from "../db/bot.js";
import type { ConfigBot } from "./config.js";

/**
 * El webhook llama a esto DESPUÉS de guardar el crudo y entregar al transporte.
 * Solo hace upsert de bot_pendientes con la ventana de debounce.
 * Si la línea no está en la config, no hace nada.
 */
export async function notificarEntrante(
  clave: string,
  numeroPropio: string,
  ahora: Date,
  cfg: ConfigBot,
): Promise<void> {
  if (!cfg.lineas.includes(numeroPropio)) return;

  const procesarDesde = new Date(ahora.getTime() + cfg.bufferSegundos * 1000);

  await db
    .insert(botPendientes)
    .values({
      clave,
      numeroPropio,
      ultimoEntranteEn: ahora,
      procesarDesde,
      creadoEn: ahora,
    })
    .onConflictDoUpdate({
      target: botPendientes.clave,
      set: {
        ultimoEntranteEn: ahora,
        procesarDesde,
        enProcesoDesde: null,
      },
    });
}
