import { Router } from "express";
import { cuentasConfiguradas, guardarCuentas, refrescarPauta } from "../pauta/snapshot.js";

export const configRouter = Router();

/**
 * La selección de cuentas publicitarias.
 *
 * Vivía en el localStorage de un navegador. Eso tenía dos problemas:
 *   1. Dos personas del equipo veían cosas distintas y no lo sabían.
 *   2. El job de fondo no tiene localStorage — no podía saber qué cuentas revisar.
 *
 * Es configuración compartida del equipo, no una preferencia de UI. Va a la base.
 */

configRouter.get("/cuentas-pauta", async (_req, res) => {
  res.json({ cuentas: await cuentasConfiguradas() });
});

configRouter.put("/cuentas-pauta", async (req, res) => {
  const ids = Array.isArray(req.body?.cuentas) ? req.body.cuentas.map(String) : null;
  if (!ids) {
    res.status(400).json({ type: "validation_error", message: "Falta el arreglo `cuentas`." });
    return;
  }

  const antes = await cuentasConfiguradas();
  await guardarCuentas(ids);

  // Si cambiaron las cuentas, el snapshot viejo dejó de aplicar: revisaba otra cosa.
  // Se refresca en segundo plano — la respuesta no espera.
  const cambio = antes.length !== ids.length || antes.some((c) => !ids.includes(c));
  if (cambio) {
    void refrescarPauta("90d").catch((err) => {
      console.error("[pauta] falló el refresco tras cambiar cuentas:", (err as Error).message);
    });
  }

  res.json({ cuentas: ids, refrescando: cambio });
});
