import { Router } from "express";
import { catalogo, invocar, listar } from "../sdk/index.js";

/**
 * EL SDK, POR RED.
 *
 * Esto NO es un BFF. La diferencia importa y es la razón de que este router exista:
 *
 *   · `/api/overview` tiene la forma de la PANTALLA. Devuelve 62 KB —24 creativos con su copy,
 *     15 filas crudas de la bandeja— porque eso es lo que la home necesita en una sola llamada.
 *   · `/api/sdk` tiene la forma de la PREGUNTA. Devuelve lo que se pidió y nada más.
 *
 * Hoy Ivi consume el primero para preguntar "¿cuánto vendimos en junio?", y su catálogo de qué
 * pedir vive escrito a mano en Python, en otro host (`goberna-kos/ivi/data_planner.py:12-52`).
 * Cada vez que la home cambia de forma, el contexto del modelo cambia sin que nadie lo decida.
 * Este router es el contrato que corta eso — Ivi lo consume en la iteración 2.
 *
 * Consumidores del catálogo, por orden de llegada:
 *   1. `kos cq verify`   — hoy
 *   2. Ivi               — iteración 2
 *   3. Un servidor MCP   — iteración 3, adaptador sobre `catalogo()`
 *   4. Tool calling      — cuando Qwen lo soporte bien. El contrato ya está.
 */
export const sdkRouter = Router();

/**
 * El catálogo: qué puede responder el sistema, con el JSON Schema de cada entrada.
 *
 * Desde el cierre del issue #36 esto vive detrás del perímetro (`auth/perimetro.ts`):
 * exige el Bearer de una vendedora, como todo /api. Los consumidores máquina (kos,
 * Ivi, MCP) necesitan una credencial de servicio que todavía no existe — cuando se
 * conecten, esa credencial se diseña aparte; abrir esto de nuevo NO es la opción.
 */
sdkRouter.get("/catalogo", (_req, res) => {
  res.json(catalogo());
});

/** Los nombres nada más, para un chequeo rápido de vida. */
sdkRouter.get("/herramientas", (_req, res) => {
  res.json({ herramientas: listar() });
});

/**
 * Invocar una Herramienta.
 *
 * POST aunque casi todas leen: la entrada es un objeto con schema, y meterlo en la query string
 * obligaría a serializarlo a mano de los dos lados. El `idempotente` del catálogo dice cuáles se
 * pueden repetir sin consecuencia — que es lo que un GET realmente comunica.
 *
 * El código HTTP sale del motivo, no de un try/catch: el registro nunca lanza, devuelve un
 * `Resultado` discriminado. Un fracaso es un hecho del sistema y se reporta como tal.
 */
sdkRouter.post("/invocar/:nombre", async (req, res) => {
  const r = await invocar(req.params.nombre, req.body);

  if (r.ok) {
    res.json({ ok: true, salida: r.salida, ms: r.ms });
    return;
  }

  const codigo = { no_existe: 404, entrada_invalida: 400, fallo_ejecucion: 500 }[r.motivo];
  res.status(codigo).json({ ok: false, motivo: r.motivo, detalle: r.detalle, ms: r.ms });
});
