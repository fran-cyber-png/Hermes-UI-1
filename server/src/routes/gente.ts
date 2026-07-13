import { Router } from "express";
import { buscarPersonas, persona360 } from "../canales/persona360.js";

/**
 * LA GENTE — la persona canónica del grafo (no la interacción suelta de Meta).
 *
 * `/api/gente/buscar?q=` encuentra personas por nombre o contacto; `/api/gente/:id` devuelve su 360:
 * la historia entera —compras, pagos, el lazo— en una línea de tiempo, con inferencias.
 */
export const genteRouter = Router();

genteRouter.get("/buscar", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json({ personas: [] });
    return;
  }
  res.json({ personas: await buscarPersonas(q) });
});

genteRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ type: "validation_error" });
    return;
  }
  const p = await persona360(id);
  if (!p) {
    res.status(404).json({ type: "not_found" });
    return;
  }
  res.json(p);
});
