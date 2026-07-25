import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { consultarCola } from "../cola/consultarCola.js";
import { PinLleno, upsertEstado } from "../cola/estado.js";
import { ETAPAS } from "../gestiones/registrarGestion.js";

/**
 * LA COLA UNIFICADA — la ruta es una cáscara fina. Todo el SQL vive en el seam
 * `cola/consultarCola.ts`, que recibe `db` inyectado y por eso SÍ se testea
 * contra la base (harness #33). Ver ese archivo para el porqué de cada cosa.
 *
 * `?etapa=` (#89): filtra por ETAPA EFECTIVA (ADR 0013) — la carga por columna
 * del tablero. Solo acepta las etapas canónicas; cualquier otra cosa es un 400,
 * no un filtro silenciosamente ignorado.
 *
 * `?tab=` / `?categoria=` (#49): el eje personal de la cola potenciada. Va DETRÁS
 * del perímetro (`auth/perimetro.ts`): `req.vendedoraId` ya está puesto acá, y el
 * pin/favorita/no-leído son POR VENDEDORA (el pin de A no lo ve B).
 *
 * `?precio=1`: el recorte del Pipeline rediseñado — solo las que ya tienen un
 * precio encima (la cotización de hecho). El nombre real y el curso del
 * formulario NO son opt-in: viajan siempre, en la misma pasada del listado
 * (`cola/cursoSql.ts`), así que no hay ningún `?lead=1` que pedir.
 */
export const conversacionesRouter = Router();

conversacionesRouter.get("/", async (req, res) => {
  const etapa = typeof req.query.etapa === "string" ? req.query.etapa : "";
  if (etapa && !(ETAPAS as readonly string[]).includes(etapa)) {
    res.status(400).json({ ok: false, message: `etapa inválida (${ETAPAS.join(" | ")})` });
    return;
  }
  try {
    const r = await consultarCola(db, {
      canal: typeof req.query.canal === "string" ? req.query.canal : "",
      intencion: typeof req.query.intencion === "string" ? req.query.intencion : "",
      etapa,
      tab: typeof req.query.tab === "string" ? req.query.tab : "",
      categoria: typeof req.query.categoria === "string" ? req.query.categoria : "",
      precio: req.query.precio === "1",
      vendedoraId: req.vendedoraId,
      limit: Number(req.query.limit) || 40,
      offset: Number(req.query.offset) || 0,
    });
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

/**
 * El estado personal de una conversación (pin / favorita / leído). Upsert por
 * (vendedora, clave). `leido:true` avanza el cursor al último mensaje visible;
 * `leido:false` lo deja justo antes del último entrante (vuelve a «sin leer»).
 * Fijar con el tope lleno → 409 con mensaje.
 */
const estadoSchema = z
  .object({
    clave: z.string().min(1),
    fijada: z.boolean().optional(),
    favorita: z.boolean().optional(),
    leido: z.boolean().optional(),
  })
  .refine((v) => v.fijada !== undefined || v.favorita !== undefined || v.leido !== undefined, {
    message: "no hay nada que cambiar (fijada, favorita o leido)",
  });

conversacionesRouter.put("/estado", async (req, res) => {
  const parsed = estadoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "cambio de estado inválido" });
    return;
  }
  try {
    await upsertEstado(db, req.vendedoraId!, parsed.data);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof PinLleno) {
      res.status(409).json({ ok: false, message: e.message });
      return;
    }
    res.status(500).json({ ok: false, message: (e as Error).message });
  }
});
