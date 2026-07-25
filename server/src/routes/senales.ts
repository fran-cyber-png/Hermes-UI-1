import { Router } from "express";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { consultarSenales } from "../senales/consultarSenales.js";
import { umbralDeEnv } from "../senales/enfriamiento.js";
import { etiquetasDeSenal, type EtiquetaAutomatica } from "../senales/etiquetasAutomaticas.js";

/**
 * LAS SEÑALES AUTOMÁTICAS de un puñado de conversaciones: ¿se cotizó? ¿se enfrió?
 *
 * Nace AUTENTICADO (`requiereVendedora` en la primera línea, patrón de #48): no
 * arrastra la deuda de #36. Es de solo lectura y no escribe NADA — las etiquetas
 * automáticas no tienen fila que escribir (ADR 0015).
 *
 * Se pide por lote (`?claves=a,b,c`) y no de a una: la ficha abre con una
 * conversación, pero la cola quiere pintar veinte de un saque, y veinte
 * requests para veinte píldoras es la forma más barata de hacer lenta una app.
 */
export const senalesRouter = Router();
senalesRouter.use(requiereVendedora);

/** El tope del lote. Más que esto no es una pantalla: es un reporte, y va por otro lado. */
const MAX_CLAVES = 200;

senalesRouter.get("/", async (req, res) => {
  const crudo = typeof req.query.claves === "string" ? req.query.claves : "";
  const claves = crudo
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (claves.length === 0) {
    res.status(400).json({ ok: false, message: "hace falta al menos una clave (?claves=conv:…)" });
    return;
  }
  if (claves.length > MAX_CLAVES) {
    res
      .status(400)
      .json({ ok: false, message: `demasiadas claves de una (máximo ${MAX_CLAVES})` });
    return;
  }

  const umbralDias = umbralDeEnv(process.env);
  const senales = await consultarSenales(db, { claves, umbralDias });

  // Las píldoras se arman ACÁ: el mapeo señal → etiqueta es una sola regla y
  // vive del lado del server, así el front no puede tener su propia versión.
  const conEtiquetas: Record<
    string,
    (typeof senales)[string] & { etiquetas: EtiquetaAutomatica[] }
  > = {};
  for (const [clave, s] of Object.entries(senales)) {
    conEtiquetas[clave] = { ...s, etiquetas: etiquetasDeSenal(s) };
  }

  res.json({ senales: conEtiquetas, umbralDias });
});
