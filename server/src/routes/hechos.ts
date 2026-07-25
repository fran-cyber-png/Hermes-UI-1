import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { hechos as tabla } from "../db/schema.js";
import { requiereVendedora } from "../auth/sesion.js";
import { MOMENTOS_DE_VENTA, momentoDeVenta } from "../sugerencias/estado.js";
import { estadoDeLaVenta } from "../sugerencias/consultarSugerencias.js";
import { elegirHechos } from "../hechos/elegir.js";
import { leerCatalogo } from "../hechos/repositorio.js";

/**
 * LOS DATOS RECOMENDADOS — `GET /api/hechos?clave=…`.
 *
 * La munición de una línea que cierra ventas y casi nunca se dice (#153). Solo
 * lee y **no manda nada**: la vendedora toca un chip, el texto cae en la caja,
 * y ella decide. Poner texto en el composer no es enviar (la regla de #45).
 *
 * Independiente de las plantillas **a propósito**: hoy en producción no hay ni
 * una secuencia cargada, así que si esto colgara del mismo endpoint que las dos
 * respuestas, el bloque no existiría justo donde más falta hace.
 *
 * El catálogo se edita acá mismo (`POST` / `PUT` / `DELETE`): lo que cierra
 * ventas cambia, y cambiarlo no puede costar un deploy.
 */
export const hechosRouter = Router();
hechosRouter.use(requiereVendedora);

const Hecho = z.object({
  clave: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "la clave va en minúsculas, sin espacios: «acceso-un-anio»"),
  rotulo: z.string().trim().min(2).max(30),
  texto: z.string().trim().min(5).max(600),
  momentos: z.array(z.enum(MOMENTOS_DE_VENTA)).default([]),
  orden: z.number().int().min(0).max(999).default(100),
  activo: z.boolean().default(true),
});

/** El catálogo entero — para editarlo. */
hechosRouter.get("/catalogo", async (_req, res) => {
  const c = await leerCatalogo(db);
  res.json(c);
});

/** Los que corresponden a ESTA conversación, ya filtrados por el momento de la venta. */
hechosRouter.get("/", async (req, res) => {
  const clave = typeof req.query.clave === "string" ? req.query.clave : "";
  if (!clave.startsWith("conv:")) {
    res
      .status(400)
      .json({ ok: false, message: "hace falta la clave de una conversación (?clave=conv:…)" });
    return;
  }

  const estado = await estadoDeLaVenta(db, { clave });
  const momento = momentoDeVenta(estado);
  const catalogo = await leerCatalogo(db);

  res.json({
    momento,
    // Viaja el estado igual que en `/api/sugerencias`: el panel lo usa para
    // explicar POR QUÉ le está ofreciendo estas frases y no otras.
    estado,
    hechos: elegirHechos(catalogo.hechos, momento),
    editable: catalogo.editable,
    origen: catalogo.origen,
  });
});

hechosRouter.post("/", async (req, res) => {
  const p = Hecho.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ ok: false, errores: p.error.issues.map((i) => i.message) });
    return;
  }
  try {
    const [fila] = await db.insert(tabla).values(p.data).returning();
    res.status(201).json({ ok: true, hecho: fila });
  } catch {
    res.status(409).json({ ok: false, message: "ya hay un dato con esa clave, o falta el db:push" });
  }
});

hechosRouter.put("/:clave", async (req, res) => {
  const p = Hecho.partial().safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ ok: false, errores: p.error.issues.map((i) => i.message) });
    return;
  }
  try {
    const [fila] = await db
      .update(tabla)
      .set({ ...p.data, actualizadoAt: new Date() })
      .where(eq(tabla.clave, req.params.clave))
      .returning();
    if (!fila) {
      res.status(404).json({ ok: false, message: "no existe ese dato" });
      return;
    }
    res.json({ ok: true, hecho: fila });
  } catch {
    res.status(503).json({ ok: false, message: "la tabla de datos recomendados no está: falta el db:push" });
  }
});

/**
 * Borrar es APAGAR. La frase que dejó de funcionar sirve de historia, y un
 * borrado físico haría que el catálogo no se pueda auditar contra las ventas.
 */
hechosRouter.delete("/:clave", async (req, res) => {
  try {
    const [fila] = await db
      .update(tabla)
      .set({ activo: false, actualizadoAt: new Date() })
      .where(eq(tabla.clave, req.params.clave))
      .returning();
    if (!fila) {
      res.status(404).json({ ok: false, message: "no existe ese dato" });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, message: "la tabla de datos recomendados no está: falta el db:push" });
  }
});
