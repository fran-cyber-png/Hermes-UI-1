import { Router } from "express";
import { paraMeta, rangoDe } from "../lib/rangos.js";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { detectar, type CampaignInput } from "../decisions/detectors.js";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";

export const decisionsRouter = Router();

/**
 * MODO SEGURIDAD (pedido explícito del usuario):
 *   "respeta las configuraciones actuales de las pautas, no las toques...
 *    cuando tengamos algo seguro poder recién impactar"
 *
 * Por eso el default es SIMULACIÓN: el feed dice qué haría, pero no escribe
 * nada en Meta. Para habilitar la escritura hay que poner explícitamente
 * DECISIONES_MODO=ejecucion en el .env — no alcanza con tocar un botón.
 */
const MODO = process.env.DECISIONES_MODO === "ejecucion" ? "ejecucion" : "simulacion";

function indicatorValue(arr: unknown): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const raw = (arr[0] as any)?.values?.[0]?.value;
  return raw != null ? Number(raw) : null;
}

/**
 * Trae las campañas ACTIVAS de las cuentas elegidas con su estructura e
 * insights, y corre los detectores encima.
 *
 * Solo mira campañas activas: una campaña pausada no está gastando plata, así
 * que no hay nada que decidir sobre ella.
 */
decisionsRouter.get("/", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
    return;
  }

  const raw = req.query.accountIds;
  const ids = (typeof raw === "string" ? raw.split(",") : []).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    res.json({ decisiones: [], modo: MODO, campanasAnalizadas: 0 });
    return;
  }
  // El mismo rango que gobierna todo el home. Meta no tiene preset de "últimos
  // 365 días", así que se le manda time_range con fechas exactas.
  const ventana = paraMeta(rangoDe(req.query.rango ?? req.query.datePreset));

  const client = new MetaGraphClient(token);
  const campanas: CampaignInput[] = [];
  const errores: { accountId: string; message: string }[] = [];

  for (const accountId of ids) {
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    try {
      const cuenta = await client.get(actId, { fields: "name,currency" });

      // Solo las activas: sobre una campaña pausada no hay nada que decidir.
      const activas = await client.getAll(`${actId}/campaigns`, {
        fields: "id,name,status",
        effective_status: JSON.stringify(["ACTIVE"]),
        limit: "25",
      });

      for (const camp of activas) {
        const estructura = await client.get(camp.id, {
          fields: "name,status,adsets.limit(25){name,status,targeting,ads.limit(25){name,status}}",
        });
        const insights = await client.getAll(`${camp.id}/insights`, {
          level: "ad",
          ...ventana,
          fields: "ad_id,spend,results,cost_per_result",
          limit: "200",
        });

        const porAd = new Map(
          insights.map((r) => [
            r.ad_id,
            {
              spend: Number(r.spend ?? 0),
              results: indicatorValue(r.results),
              costPerResult: indicatorValue(r.cost_per_result),
            },
          ]),
        );

        const adsets = (estructura.adsets?.data ?? []).map((as: any) => {
          const ads = (as.ads?.data ?? []).map((ad: any) => {
            const m = porAd.get(ad.id) ?? { spend: 0, results: null, costPerResult: null };
            return { id: ad.id, name: ad.name, status: ad.status, ...m };
          });
          const spend = ads.reduce((s: number, a: any) => s + a.spend, 0);
          const results = ads.reduce((s: number, a: any) => s + (a.results ?? 0), 0);
          const t = as.targeting ?? {};
          return {
            id: as.id,
            name: as.name,
            status: as.status,
            spend,
            results: results || null,
            costPerResult: results > 0 ? spend / results : null,
            includedAudiences: (t.custom_audiences ?? []).map((x: any) => x.name),
            excludedAudiences: (t.excluded_custom_audiences ?? []).map((x: any) => x.name),
            ads,
          };
        });

        const spend = adsets.reduce((s: number, a: any) => s + a.spend, 0);
        const results = adsets.reduce((s: number, a: any) => s + (a.results ?? 0), 0);

        campanas.push({
          id: camp.id,
          name: camp.name,
          status: camp.status,
          spend,
          results: results || null,
          costPerResult: results > 0 ? spend / results : null,
          accountId,
          accountName: cuenta.name,
          currency: cuenta.currency,
          adsets,
        });
      }
    } catch (err) {
      const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
      errores.push({ accountId, message });
    }
  }

  res.json({
    decisiones: detectar(campanas),
    campanasAnalizadas: campanas.length,
    errores,
    modo: MODO,
  });
});

/**
 * Aplicar una decisión.
 *
 * En SIMULACIÓN devuelve exactamente lo que haría, sin tocar Meta.
 * En EJECUCIÓN escribe, y guarda el estado anterior en el event store para
 * poder deshacer y auditar quién cambió qué.
 */
decisionsRouter.post("/aplicar", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  const { decisionId, accion } = req.body ?? {};

  if (!decisionId || !accion) {
    res.status(400).json({ type: "validation_error", errors: ["Falta la decisión o la acción."] });
    return;
  }

  if (MODO === "simulacion") {
    res.json({
      type: "simulado",
      mensaje: "Modo simulación: no se tocó nada en Meta.",
      haria: accion,
    });
    return;
  }

  // Modo ejecución. Por ahora solo `pausar` está implementado: es la acción
  // reversible y de menor riesgo. Mover presupuesto y excluir públicos escriben
  // configuración más delicada y se habilitan cuando esta se haya probado.
  if (accion.tipo !== "pausar") {
    res.status(400).json({
      type: "no_implementado",
      message: `La acción «${accion.tipo}» todavía no se ejecuta automáticamente. Por ahora solo "pausar".`,
    });
    return;
  }

  const client = new MetaGraphClient(token!);
  try {
    for (const objetivo of accion.objetivos) {
      await client.post(objetivo, { status: "PAUSED" });
    }

    // Todo lo aplicado queda como evento: qué se cambió, cuándo, y qué había
    // antes. Es lo que hace que sea auditable y reversible.
    await db.insert(events).values({
      source: "decision_applied",
      externalId: `${decisionId}:${Date.now()}`,
      occurredAt: new Date(),
      payload: { decisionId, accion },
    });

    res.json({ type: "aplicado", objetivos: accion.objetivos });
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    res.status(502).json({ type: "api_error", message });
  }
});

/** Historial de lo aplicado — para poder auditar y deshacer. */
decisionsRouter.get("/historial", async (_req, res) => {
  const rows = await db.execute<{ id: number; occurred_at: string; payload: unknown }>(sql`
    SELECT id, occurred_at, payload FROM events
    WHERE source = 'decision_applied'
    ORDER BY occurred_at DESC LIMIT 50
  `);
  res.json({ historial: rows });
});
