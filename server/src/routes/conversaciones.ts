import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { consultarCola } from "../cola/consultarCola.js";
import { PinLleno, upsertEstado } from "../cola/estado.js";
import { ETAPAS } from "../gestiones/registrarGestion.js";
import { normalizarTelefono } from "../whatsapp/identidadWa.js";

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
 *
 * `?linea=` (#50): recorta a UN número propio de Goberna. Se normaliza acá con
 * `normalizarTelefono` —el mismo normalizador que usan el gestor y la orden de
 * envío— para que `+51 941 654 039` y `51941654039` sean la misma línea.
 *
 * Dos «no existe» distintos, y se responden distinto: lo que **no es un
 * teléfono** es un 400 (ver abajo), y un teléfono **válido que no tiene nada**
 * es una cola vacía — la respuesta honesta a «mostrame lo de esta línea» cuando
 * esa línea todavía no habló con nadie, que es justo el día uno de un número
 * recién vinculado.
 */
export const conversacionesRouter = Router();

conversacionesRouter.get("/", async (req, res) => {
  const etapa = typeof req.query.etapa === "string" ? req.query.etapa : "";
  if (etapa && !(ETAPAS as readonly string[]).includes(etapa)) {
    res.status(400).json({ ok: false, message: `etapa inválida (${ETAPAS.join(" | ")})` });
    return;
  }

  // Un `?linea=` que no es un teléfono es un 400, NO una línea vacía que se cae
  // sola. Si cayera, el filtro desaparecería y la cola mostraría TODAS las
  // líneas: quien pidió ver solo lo de Walter estaría mirando lo de todos, sin
  // un solo síntoma en pantalla. Un filtro que no filtra tiene que romper.
  const lineaCruda = typeof req.query.linea === "string" ? req.query.linea.trim() : "";
  const lineaNormalizada = lineaCruda ? normalizarTelefono(lineaCruda) : "";
  if (lineaCruda && !lineaNormalizada) {
    res.status(400).json({ ok: false, message: `línea inválida (${lineaCruda}): se espera un teléfono` });
    return;
  }
  // Después de la guarda solo quedan dos casos: sin filtro (`""`) o un número ya
  // canónico. El `?? ""` es para el tipo, no para un caso que pueda pasar.
  const linea = lineaNormalizada ?? "";
  try {
    const r = await consultarCola(db, {
      canal: typeof req.query.canal === "string" ? req.query.canal : "",
      intencion: typeof req.query.intencion === "string" ? req.query.intencion : "",
      etapa,
      tab: typeof req.query.tab === "string" ? req.query.tab : "",
      categoria: typeof req.query.categoria === "string" ? req.query.categoria : "",
      precio: req.query.precio === "1",
      linea,
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
