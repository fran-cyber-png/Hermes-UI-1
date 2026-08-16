import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { ruta } from "../lib/ruta.js";
import { configDesdeEnv } from "../bot/config.js";
import {
  fijarFrenoLinea,
  fijarModoLinea,
  leerEstadoLinea,
} from "../bot/estadoLinea.js";
import {
  DESCRIPCION_MODO,
  MODOS_BOT,
  modoValido,
  type ModoBot,
} from "../bot/modo.js";

/**
 * EL KILL-SWITCH DEL BOT — apagar tiene que costar un click, no un deploy.
 *
 * ── Por qué esta ruta no existía y por qué es lo primero del plan ────────
 *
 * El bot vive en producción en modo `automatico` y su modo salía de `BOT_MODO`
 * en el `.env`. Frenarlo costaba `ssh` + editar un archivo + `systemctl restart`
 * — con el server abajo para las tres vendedoras mientras tanto. La tabla
 * `bot_estado` (modo y freno POR LÍNEA) estaba creada desde el primer día y
 * **nadie la leía**.
 *
 * Es exactamente el agujero que la auto-respuesta ya había cerrado en ADR 0015
 * con `PUT /api/autorespuesta/modo`, y esta ruta es su gemela deliberada: mismo
 * verbo, mismo vocabulario de modos, misma regla de permisos.
 *
 * ── Cualquier vendedora puede apagarlo ──────────────────────────────────
 *
 * `requiereVendedora`, sin rol especial. Frenar una máquina que le está
 * escribiendo a leads reales no es un permiso que haya que pedir: la que ve el
 * problema es la que está mirando la conversación.
 *
 * ── El freno es OTRA cosa que el modo ───────────────────────────────────
 *
 * `modo` es la política («¿esta línea manda?»). `frenado` es la parada de
 * emergencia y **no toca el modo**, para que al soltarlo la línea vuelva a
 * donde estaba y nadie tenga que acordarse de en qué modo estaba antes.
 */
export const botRouter = Router();

const cuerpoModo = z.object({
  modo: z.enum(MODOS_BOT),
  motivo: z.string().trim().max(300).optional(),
});

const cuerpoFreno = z.object({
  frenado: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});

/** La línea sobre la que se opera: la del path, o la única habilitada. */
function lineaDe(param: string | undefined): { numero: string } | { error: string } {
  const cfg = configDesdeEnv();
  if (param) {
    const numero = param.replace(/\D/g, "");
    if (!numero) return { error: "numero_invalido" };
    return { numero };
  }
  // Sin línea en el path se opera sobre la única habilitada. Con dos o más NO
  // se elige por descarte: apagar la línea equivocada es peor que un 400.
  if (cfg.lineas.length === 1) return { numero: cfg.lineas[0]! };
  if (cfg.lineas.length === 0) return { error: "sin_lineas_habilitadas" };
  return { error: "hay_varias_lineas_indica_cual" };
}

/**
 * El estado de la línea, con **las dos fuentes a la vista**: lo que dice la base
 * y lo que dice el entorno. Un endpoint que devolviera solo el efectivo dejaría
 * sin explicar por qué está en ese modo, que es justo lo que se pregunta a las
 * 2 de la mañana.
 */
botRouter.get("/estado", requiereVendedora, ruta(async (req, res) => {
  const linea = lineaDe(req.query.numero as string | undefined);
  if ("error" in linea) return res.status(400).json({ error: linea.error });

  const cfg = configDesdeEnv();
  const estado = await leerEstadoLinea(db, linea.numero);
  const modoDelEntorno = modoValido(cfg.modo);

  res.json({
    numero: linea.numero,
    habilitada: cfg.lineas.includes(linea.numero),
    modoEfectivo: estado.modo ?? modoDelEntorno,
    modoDeLaBase: estado.modo,
    modoDelEntorno,
    frenado: estado.frenadoMotivo !== null,
    frenadoMotivo: estado.frenadoMotivo,
    modos: MODOS_BOT.map((m) => ({ modo: m, descripcion: DESCRIPCION_MODO[m] })),
  });
}));

botRouter.put("/modo", requiereVendedora, ruta(async (req, res) => {
  const parseo = cuerpoModo.safeParse(req.body);
  if (!parseo.success) {
    return res.status(400).json({ error: "modo_invalido", validos: MODOS_BOT });
  }
  const linea = lineaDe(req.query.numero as string | undefined);
  if ("error" in linea) return res.status(400).json({ error: linea.error });

  const modo: ModoBot = parseo.data.modo;
  const quien = req.vendedoraId ?? "desconocida";
  const ok = await fijarModoLinea(db, linea.numero, modo, quien);

  if (!ok) {
    // Un 200 acá sería decirle a la vendedora «ya está apagado» sobre un bot que
    // sigue mandando. En un interruptor, el falso OK es el peor error posible.
    return res.status(503).json({
      error: "sin_tabla",
      detalle: "`bot_estado` no está disponible: el modo no se pudo guardar.",
    });
  }

  console.warn(`[bot] modo de ${linea.numero} → ${modo} (por ${quien})`);
  res.json({ numero: linea.numero, modo, descripcion: DESCRIPCION_MODO[modo] });
}));

botRouter.put("/freno", requiereVendedora, ruta(async (req, res) => {
  const parseo = cuerpoFreno.safeParse(req.body);
  if (!parseo.success) return res.status(400).json({ error: "cuerpo_invalido" });

  const linea = lineaDe(req.query.numero as string | undefined);
  if ("error" in linea) return res.status(400).json({ error: linea.error });

  const quien = req.vendedoraId ?? "desconocida";
  const motivo = parseo.data.frenado
    ? parseo.data.motivo?.trim() || `frenado a mano por ${quien}`
    : null;

  const ok = await fijarFrenoLinea(db, linea.numero, motivo, quien);
  if (!ok) {
    return res.status(503).json({
      error: "sin_tabla",
      detalle: "`bot_estado` no está disponible: el freno no se pudo guardar.",
    });
  }

  console.warn(
    `[bot] ${linea.numero} ${motivo ? `FRENADO: ${motivo}` : "sin freno"} (por ${quien})`,
  );
  res.json({ numero: linea.numero, frenado: motivo !== null, motivo });
}));
