import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { ruta } from "../lib/ruta.js";
import { MOMENTOS_DE_VENTA, momentoDeVenta } from "../sugerencias/estado.js";
import { estadoDeLaVenta } from "../sugerencias/consultarSugerencias.js";
import { TOPE_HECHOS, elegirHechos, vistaPreviaPorMomento } from "../hechos/elegir.js";
import { leerCatalogo, leerCatalogoParaEditar } from "../hechos/repositorio.js";
import { actualizarHecho, apagarHecho, crearHecho } from "../hechos/editarCatalogo.js";

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

/**
 * EL CATÁLOGO ENTERO, PARA EDITARLO — con lo apagado y con el recorte hecho.
 *
 * Trae tres cosas que la pantalla no puede deducir sola:
 *
 *   · `hechos` incluye los **apagados** (`activo: false`), o no habría forma de
 *     volver a prender uno: «borrar es apagar», y `leerCatalogo` filtra.
 *   · `vistaPrevia` dice, por momento, **qué claves llegan a verse**. Se calcula
 *     con la MISMA función que recorta en el panel; si el navegador la
 *     reimplementara, la pantalla podría afirmar «esto se ve» mientras la
 *     vendedora no lo ve, y nada fallaría (la lección de #37).
 *   · `tope` es el número con el que se recortó, para poder decirlo en pantalla
 *     en vez de que la vendedora lo adivine contando.
 *
 * El recorte se corre sobre los ACTIVOS: un dato apagado no compite por el
 * lugar, y mostrarlo compitiendo sería mentir sobre lo que pasaría al prenderlo.
 */
hechosRouter.get("/catalogo", ruta(async (_req, res) => {
  const c = await leerCatalogoParaEditar(db);
  res.json({
    ...c,
    tope: TOPE_HECHOS,
    vistaPrevia: vistaPreviaPorMomento(
      c.hechos.filter((h) => h.activo),
      TOPE_HECHOS,
    ),
  });
}));

/** Los que corresponden a ESTA conversación, ya filtrados por el momento de la venta. */
hechosRouter.get("/", ruta(async (req, res) => {
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
}));

hechosRouter.post("/", ruta(async (req, res) => {
  const p = Hecho.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ ok: false, errores: p.error.issues.map((i) => i.message) });
    return;
  }
  try {
    const fila = await crearHecho(db, p.data);
    res.status(201).json({ ok: true, hecho: fila });
  } catch {
    res.status(409).json({ ok: false, message: "ya hay un dato con esa clave, o falta el db:push" });
  }
}));

hechosRouter.put("/:clave", ruta(async (req, res) => {
  const p = Hecho.partial().safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ ok: false, errores: p.error.issues.map((i) => i.message) });
    return;
  }
  try {
    const fila = await actualizarHecho(db, req.params.clave, p.data);
    if (!fila) {
      res.status(404).json({ ok: false, message: "no existe ese dato" });
      return;
    }
    res.json({ ok: true, hecho: fila });
  } catch {
    res.status(503).json({ ok: false, message: "la tabla de datos recomendados no está: falta el db:push" });
  }
}));

/** Borrar es APAGAR — el porqué vive con la escritura, en `apagarHecho`. */
hechosRouter.delete("/:clave", ruta(async (req, res) => {
  try {
    const fila = await apagarHecho(db, req.params.clave);
    if (!fila) {
      res.status(404).json({ ok: false, message: "no existe ese dato" });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, message: "la tabla de datos recomendados no está: falta el db:push" });
  }
}));
