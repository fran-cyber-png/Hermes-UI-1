import { Router } from "express";
import { db } from "../db/client.js";
import { consultarCola } from "../cola/consultarCola.js";

/**
 * LA COLA UNIFICADA — la ruta es una cáscara fina. Todo el SQL vive en el seam
 * `cola/consultarCola.ts`, que recibe `db` inyectado y por eso SÍ se testea
 * contra la base (harness #33). Ver ese archivo para el porqué de cada cosa.
 */
export const conversacionesRouter = Router();

conversacionesRouter.get("/", async (req, res) => {
  try {
    const r = await consultarCola(db, {
      canal: typeof req.query.canal === "string" ? req.query.canal : "",
      intencion: typeof req.query.intencion === "string" ? req.query.intencion : "",
      limit: Number(req.query.limit) || 40,
      offset: Number(req.query.offset) || 0,
    });
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});
