import { tasasDeCambio } from "../analisis/tasas.js";
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { detectar } from "../decisions/detectors.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { refrescarPauta, ultimoSnapshot } from "../pauta/snapshot.js";

export const decisionsRouter = Router();

/**
 * MODO SEGURIDAD (pedido explícito del usuario):
 *   "respeta las configuraciones actuales de las pautas, no las toques...
 *    cuando tengamos algo seguro poder recién impactar"
 *
 * Por eso el default es SIMULACIÓN: el feed dice qué haría, pero no escribe
 * nada en Meta. Para habilitar la escritura hay que poner explícitamente
 * DECISIONES_MODO=ejecucion en el .env — no alcanza con tocar un botón.
 */
const MODO = process.env.DECISIONES_MODO === "ejecucion" ? "ejecucion" : "simulacion";

/** El rango pedido, normalizado. Los snapshots se guardan por rango. */
function rangoDe(q: unknown): string {
  const v = typeof q === "string" ? q : "";
  return ["7d", "30d", "90d", "1y", "todo"].includes(v) ? v : "90d";
}

/**
 * Las decisiones. LEE POSTGRES. No llama a Meta.
 *
 * Antes esto hacía 866 llamadas secuenciales a la Graph API (24 cuentas × 2, más 409 campañas
 * × 2) y tardaba entre 2 y 4 minutos — al MONTAR dos pantallas distintas, sin caché entre ellas.
 * Abrías la home, ibas a campañas, y pagabas la cuenta dos veces.
 *
 * Ahora Meta se consulta por detrás (`pauta/snapshot.ts`) y esto lee el resultado. Los detectores
 * (`decisions/detectors.ts`) ya eran funciones puras: no hubo que tocarlos, solo cambiar de dónde
 * vienen los datos.
 *
 * La card deja de mentir: en vez de fingir que está "en vivo", dice su edad — "revisado hace 2 h".
 */
decisionsRouter.get(
  "/",
  ruta(async (req, res) => {
    const rango = rangoDe(req.query.rango ?? req.query.datePreset);
    const snap = await ultimoSnapshot(rango);

    if (!snap) {
      // Ninguna revisión LIMPIA para este rango todavía (nunca se corrió, o todas fallaron).
      // No es un error: es que falta una revisión que termine bien.
      res.json({
        decisiones: [],
        campanasAnalizadas: 0,
        errores: [],
        modo: MODO,
        snapshot: null,
      });
      return;
    }

    // Las tasas del negocio: sin ellas no se puede comparar plata entre cuentas de monedas distintas.
    const tasas = await tasasDeCambio();
    res.json({
      decisiones: detectar(snap.campanas, tasas),
      campanasAnalizadas: snap.campanas.length,
      errores: snap.errores,
      modo: MODO,
      snapshot: {
        creadoAt: snap.creadoAt,
        edadMinutos: snap.edadMinutos,
        cuentas: snap.cuentas.length,
      },
    });
  }),
);

/**
 * "Revisar ahora". Dispara la recolección contra Meta y espera el resultado.
 *
 * Es el ÚNICO endpoint de esta ruta que habla con Meta, y solo cuando alguien lo pide
 * explícitamente. Nunca al cargar una pantalla.
 */
decisionsRouter.post("/refrescar", ruta(async (req, res) => {
  const rango = rangoDe(req.body?.rango ?? req.query.rango);
  try {
    const snap = await refrescarPauta(rango);
    if (!snap) {
      res.status(400).json({
        type: "sin_cuentas",
        message: "No hay cuentas publicitarias configuradas para revisar.",
      });
      return;
    }
    const tasas = await tasasDeCambio();
    res.json({
      decisiones: detectar(snap.campanas, tasas),
      campanasAnalizadas: snap.campanas.length,
      errores: snap.errores,
      modo: MODO,
      snapshot: { creadoAt: snap.creadoAt, edadMinutos: 0, cuentas: snap.cuentas.length },
    });
  } catch (err) {
    console.error(`POST /api/decisions/refrescar falló — ${porQueFallo(err)}`);
    res.status(502).json({ type: "meta_error", message: "No se pudo completar la operación." });
  }
}));

/**
 * Aplicar una decisión.
 *
 * En SIMULACIÓN devuelve exactamente lo que haría, sin tocar Meta.
 * En EJECUCIÓN escribe, y guarda el estado anterior en el event store para
 * poder deshacer y auditar quién cambió qué.
 */
decisionsRouter.post("/aplicar", ruta(async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  const { decisionId, accion } = req.body ?? {};

  if (!decisionId || !accion) {
    res.status(400).json({ type: "validation_error", errors: ["Falta la decisión o la acción."] });
    return;
  }

  if (MODO === "simulacion") {
    res.json({
      type: "simulado",
      mensaje: "Modo simulación: no se tocó nada en Meta.",
      haria: accion,
    });
    return;
  }

  // Modo ejecución. Por ahora solo `pausar` está implementado: es la acción
  // reversible y de menor riesgo. Mover presupuesto y excluir públicos escriben
  // configuración más delicada y se habilitan cuando esta se haya probado.
  if (accion.tipo !== "pausar") {
    res.status(400).json({
      type: "no_implementado",
      message: `La acción «${accion.tipo}» todavía no se ejecuta automáticamente. Por ahora solo "pausar".`,
    });
    return;
  }

  const client = new MetaGraphClient(token!);
  try {
    for (const objetivo of accion.objetivos) {
      await client.post(objetivo, { status: "PAUSED" });
    }

    // Todo lo aplicado queda como evento: qué se cambió, cuándo, y qué había
    // antes. Es lo que hace que sea auditable y reversible.
    await db.insert(events).values({
      source: "decision_applied",
      externalId: `${decisionId}:${Date.now()}`,
      occurredAt: new Date(),
      payload: { decisionId, accion },
    });

    res.json({ type: "aplicado", objetivos: accion.objetivos });
  } catch (err) {
    console.error(`POST /api/decisions/aplicar falló — ${porQueFallo(err)}`);
    // Lo que dice Meta al rechazar SÍ sale: es la explicación de por qué no se
    // pudo pausar, y la pantalla la muestra. Lo que no sale es el error crudo de
    // cualquier otra cosa — ahí `message` es el SQL, no la causa.
    const message = err instanceof MetaGraphError ? err.message : "No se pudo completar la operación.";
    res.status(502).json({ type: "api_error", message });
  }
}));

/** Historial de lo aplicado — para poder auditar y deshacer. */
decisionsRouter.get(
  "/historial",
  ruta(async (_req, res) => {
    const rows = await db.execute<{ id: number; occurred_at: string; payload: unknown }>(sql`
    SELECT id, occurred_at, payload FROM events
    WHERE source = 'decision_applied'
    ORDER BY occurred_at DESC LIMIT 50
  `);
    res.json({ historial: rows });
  }),
);
