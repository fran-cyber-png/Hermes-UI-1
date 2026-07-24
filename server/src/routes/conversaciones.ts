import { Router } from "express";
import { db } from "../db/client.js";
import { consultarCola } from "../cola/consultarCola.js";
import { ETAPAS } from "../gestiones/registrarGestion.js";

/**
 * LA COLA UNIFICADA — la ruta es una cáscara fina. Todo el SQL vive en el seam
 * `cola/consultarCola.ts`, que recibe `db` inyectado y por eso SÍ se testea
 * contra la base (harness #33). Ver ese archivo para el porqué de cada cosa.
 *
 * `?etapa=` (#89): filtra por ETAPA EFECTIVA (ADR 0013) — la carga por columna
 * del tablero. Solo acepta las etapas canónicas; cualquier otra cosa es un 400,
 * no un filtro silenciosamente ignorado.
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
      limit: Number(req.query.limit) || 40,
      offset: Number(req.query.offset) || 0,
    });
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});
