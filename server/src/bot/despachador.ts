import { eq, lt, isNull, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { botPendientes } from "../db/bot.js";
import type { ConfigBot } from "./config.js";
import type { ClienteAnthropic } from "./agente.js";
import { procesarConversacion } from "./orquestador.js";

let intervalo: ReturnType<typeof setInterval> | null = null;

export function arrancarDespachador(
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
): void {
  if (cfg.lineas.length === 0) return;
  if (intervalo) clearInterval(intervalo);

  intervalo = setInterval(() => {
    tick(cfg, clienteLLM).catch((err) => {
      console.error("[bot despachador] error en tick:", (err as Error).message);
    });
  }, 5000);

  console.info("[bot despachador] arrancado cada 5s");
}

export function detenerDespachador(): void {
  if (intervalo) {
    clearInterval(intervalo);
    intervalo = null;
  }
}

async function tick(cfg: ConfigBot, clienteLLM: ClienteAnthropic): Promise<void> {
  const ahora = new Date();

  const claims = await db.transaction(async (tx) => {
    const pendientes = await tx
      .select({ clave: botPendientes.clave, numeroPropio: botPendientes.numeroPropio })
      .from(botPendientes)
      .where(
        and(
          lt(botPendientes.procesarDesde, ahora),
          isNull(botPendientes.enProcesoDesde),
        ),
      )
      .limit(3)
      .for("update", { skipLocked: true });

    if (pendientes.length === 0) return [] as { clave: string; numeroPropio: string }[];

    for (const p of pendientes) {
      await tx
        .update(botPendientes)
        .set({ enProcesoDesde: ahora })
        .where(eq(botPendientes.clave, p.clave));
    }

    return pendientes;
  });

  for (const claim of claims) {
    await procesarConversacion(claim.clave, claim.numeroPropio, cfg, clienteLLM, ahora);
  }
}

export { notificarEntrante } from "./ingesta.js";
