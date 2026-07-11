import { Router } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { rangoDe } from "../lib/rangos.js";
import { costoPorLead } from "./costoPorLead.js";

export const leadsRouter = Router();

/**
 * Lo que costó traer los leads que tenemos. Cruza nuestra base con el gasto
 * real de Meta, en la ventana exacta en que llegaron.
 */
leadsRouter.get("/costo", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
    return;
  }
  try {
    res.json(await costoPorLead(token, rangoDe(req.query.rango)));
  } catch (err) {
    res.status(502).json({ type: "api_error", message: (err as Error).message });
  }
});

/**
 * El Pulso: el estado del sistema nervioso ahora mismo.
 * La cifra que importa no es "cuántos leads" — es cuántos siguen esperando
 * respuesta, y hace cuánto. Eso es el dato enfriándose, medido.
 */
leadsRouter.get("/stats", async (_req, res) => {
  const [totals] = await db.execute<{
    total: number;
    sin_atender: number;
    contactables: number;
    dias_promedio: number | null;
    mas_viejo_dias: number | null;
  }>(sql`
    SELECT
      count(*)::int                                                       AS total,
      count(*) FILTER (WHERE status = 'nuevo')::int                       AS sin_atender,
      count(*) FILTER (WHERE email IS NOT NULL AND phone IS NOT NULL)::int AS contactables,
      round(avg(extract(epoch FROM (now() - created_time)) / 86400))::int AS dias_promedio,
      round(max(extract(epoch FROM (now() - created_time)) / 86400))::int AS mas_viejo_dias
    FROM leads
  `);

  const porCampana = await db.execute<{ campana: string; leads: number; dias_promedio: number }>(sql`
    SELECT
      coalesce(campaign_name, '(orgánico)')                               AS campana,
      count(*)::int                                                       AS leads,
      round(avg(extract(epoch FROM (now() - created_time)) / 86400))::int AS dias_promedio
    FROM leads GROUP BY 1 ORDER BY 2 DESC
  `);

  const porPais = await db.execute<{ pais: string; leads: number }>(sql`
    SELECT coalesce(country, '—') AS pais, count(*)::int AS leads
    FROM leads GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `);

  const porDia = await db.execute<{ dia: string; leads: number }>(sql`
    SELECT created_time::date::text AS dia, count(*)::int AS leads
    FROM leads GROUP BY 1 ORDER BY 1
  `);

  // El campo custom que definió quien armó el formulario. No está garantizado
  // que exista — por eso se lee del jsonb y no de una columna.
  const porPerfil = await db.execute<{ perfil: string; leads: number }>(sql`
    SELECT coalesce(custom_fields->>'¿cuál_es_tu_cargo?', '—') AS perfil, count(*)::int AS leads
    FROM leads GROUP BY 1 ORDER BY 2 DESC LIMIT 8
  `);

  res.json({ totals, porCampana, porPais, porDia, porPerfil });
});

leadsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const filters = [];
  if (q) {
    filters.push(
      or(ilike(leads.fullName, `%${q}%`), ilike(leads.email, `%${q}%`), ilike(leads.campaignName, `%${q}%`)),
    );
  }
  if (status) filters.push(eq(leads.status, status));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [count]] = await Promise.all([
    db.select().from(leads).where(where).orderBy(desc(leads.createdTime)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where),
  ]);

  res.json({ leads: rows, total: count.n });
});
