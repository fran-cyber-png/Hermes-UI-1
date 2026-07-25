import { Router } from "express";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { enlazarClaves, revocarEnlace } from "../identidad/enlazar.js";
import { buscarContactos, resumenUnificado } from "../identidad/unificado.js";

/**
 * «ES LA MISMA PERSONA QUE…» — la unificación de contactos (issue #58, ADR 0017).
 *
 * Tres verbos y nada más: ver el grupo, enlazar, deshacer. Todo detrás de `requiereVendedora`
 * porque cruza datos de varias cuentas: quién enlazó a quién sale del TOKEN, nunca del body —
 * un enlace es una afirmación con nombre y apellido, y no se puede suplantar.
 *
 * La clave viaja por QUERY, no por path: `conv:whatsapp:519…:519…` tiene dos puntos y un
 * `:clave` de Express lo cortaría en pedazos.
 */
export const enlacesRouter = Router();

enlacesRouter.use(requiereVendedora);

/** El buscador del «Es la misma persona que…»: contactos por nombre o por teléfono. */
enlacesRouter.get("/buscar", async (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ contactos: await buscarContactos(db, q) });
});

/** El grupo unificado de una conversación. No escribe nada: leer no enlaza. */
enlacesRouter.get("/", async (req, res) => {
  const clave = String(req.query.clave ?? "");
  if (!clave) {
    res.status(400).json({ type: "validation_error", motivo: "falta la clave" });
    return;
  }
  res.json(await resumenUnificado(db, clave));
});

/**
 * Crear el enlace. Idempotente: repetirlo devuelve `yaEstaban: true` y no escribe.
 *
 * Los motivos de rechazo salen con su código, no con un 500 mudo: la vendedora tiene que
 * poder leer por qué Hermes no la dejó (se enlazó consigo misma, el grupo ya es demasiado
 * grande, la identidad está vetada).
 */
enlacesRouter.post("/", async (req, res) => {
  const claveA = String(req.body?.claveA ?? "");
  const claveB = String(req.body?.claveB ?? "");
  if (!claveA || !claveB) {
    res.status(400).json({ type: "validation_error", motivo: "faltan las dos claves" });
    return;
  }

  const r = await enlazarClaves(db, { claveA, claveB, vendedoraId: req.vendedoraId! });
  if (!r.ok) {
    // El motivo viaja en `type`, que es la llave que el cliente de la app ya lee (`ErrorApi.tipo`).
    res.status(r.motivo === "conflicto" ? 409 : 400).json({ ok: false, type: r.motivo });
    return;
  }
  res.json({ ok: true, personaId: r.personaId, yaEstaban: r.yaEstaban });
});

/** Deshacer: saca esa conversación del grupo. Revoca, no borra — el rastro queda. */
enlacesRouter.delete("/", async (req, res) => {
  const clave = String(req.query.clave ?? "");
  if (!clave) {
    res.status(400).json({ type: "validation_error", motivo: "falta la clave" });
    return;
  }

  const r = await revocarEnlace(db, { clave, vendedoraId: req.vendedoraId! });
  if (!r.ok) {
    res.status(400).json({ ok: false, type: r.motivo });
    return;
  }
  res.json({ ok: true, revocadas: r.revocadas });
});
