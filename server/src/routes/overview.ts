import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { detectar } from "../decisions/detectors.js";
import { ultimoSnapshot } from "../pauta/snapshot.js";
import { estadoDeCanales } from "../canales/consultas.js";
import { relojDeTesoreria } from "../canales/tesoreria.js";
import { lazoDetalle } from "../canales/lazoDetalle.js";
import { salud } from "../canales/salud.js";
import { ventasPorPais } from "../analisis/ventasPorPais.js";
import { roasPorPais } from "../analisis/roasPais.js";
import { creativos } from "../analisis/creativos.js";
import { tasasDeCambio } from "../analisis/tasas.js";
import { leadColdnessStats } from "../meta/leadsIngestor.js";
import { estadoDelLazo, flujoPorDia, loAccionable, loCerrado, loQuePreguntan } from "../canales/verdad.js";

export const overviewRouter = Router();

/**
 * EL BFF — Backend For Frontend.
 *
 * Una sola llamada que devuelve todo lo que la pantalla necesita, con la forma de la PANTALLA
 * y no de la base.
 *
 * ── Lo que reemplaza ──
 * La home hacía CUATRO llamadas al montar, cada una desde un componente distinto, sin caché
 * entre ellas:
 *
 *   GET /api/interactions/canales   → SQL, ~324 ms (Seq Scan sobre 94.371 filas)
 *   GET /api/leads/costo            → llamaba a Meta en vivo
 *   GET /api/interactions           → SQL, ~358 ms (Seq Scan)
 *   GET /api/decisions              → 866 llamadas a Meta. 2 a 4 minutos.
 *
 * Y `/api/decisions` se pedía TAMBIÉN desde la pantalla de campañas, sin compartir nada: abrías
 * la home, ibas a campañas, y pagabas la cuenta dos veces.
 *
 * Ahora: una llamada, solo Postgres, milisegundos. Meta se consulta por detrás, en un job.
 *
 * ── La regla ──
 * NINGUNA PANTALLA LLAMA A META. NUNCA.
 * Si un endpoint del camino de render necesita la Graph API, el diseño está mal.
 */

const RANGOS = ["7d", "30d", "90d", "1y", "todo"] as const;
type Rango = (typeof RANGOS)[number];

function rangoDe(q: unknown): Rango {
  const v = typeof q === "string" ? q : "";
  return (RANGOS as readonly string[]).includes(v) ? (v as Rango) : "90d";
}

/**
 * El corte de fecha para el rango. `todo` no corta nada.
 *
 * Devuelve un string ISO, no un `Date`: el driver `postgres` no bindea objetos Date en
 * consultas crudas — falla en runtime, no en compilación.
 */
function desdeDe(rango: Rango): string | null {
  if (rango === "todo") return null;
  const dias = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[rango];
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

overviewRouter.get("/", async (req, res) => {
  const rango = rangoDe(req.query.rango);

  // Todo a Postgres, todo en paralelo. Cero llamadas a Meta.
  const [canales, bandeja, snap, lazo, accionable, cerrado, preguntas, flujo, ventas, leadsStats] =
    await Promise.all([
      estadoDeCanales(rango),
      bandejaDe(),
      ultimoSnapshot(rango),
      estadoDelLazo(),
      loAccionable(),
      loCerrado(),
      loQuePreguntan(),
      flujoPorDia(desdeDe(rango)),
      // La estación COMPRA del embudo: ventas reales por país del cliente, en USD, desde el
      // espejo de Cerberus. Ya estaba calculada (analisis/ventasPorPais); faltaba que llegara
      // a la pantalla. No mira la ventana de fechas: es el acumulado real del negocio.
      ventasPorPais(),
      // La estación LEAD: formularios sin contactar, ACUMULADO. Un lead viejo sin contactar
      // sigue siendo un lead — filtrarlo por rango lo mostraría en cero y escondería trabajo real.
      leadColdnessStats(),
    ]);

  // ── ROAS por país y creativos: solo cuando la pauta se revisó. Necesitan las tasas del negocio
  // para convertir el gasto de Meta a USD. Si no hay snapshot, ni se piden (pauta viene en null). ──
  const tasas = snap ? await tasasDeCambio() : null;
  // El ROAS compara ventas y gasto del MISMO intervalo, anclado al momento en que se TOMÓ el snapshot
  // (no a "ahora"). El gasto de Meta quedó congelado en ese instante; si las ventas se recalcularan a
  // now, un snapshot viejo dividiría ventas de esta semana por el gasto de otra — un ROAS fabricado.
  const dias = { "7d": 7, "30d": 30, "90d": 90, "1y": 365, todo: null }[rango];
  const hastaVentana = snap ? snap.creadoAt.toISOString() : null;
  const desdeVentana =
    snap && dias ? new Date(snap.creadoAt.getTime() - dias * 86_400_000).toISOString() : null;
  const ventasVentana = snap?.gasto ? await ventasPorPais(desdeVentana, hastaVentana) : null;
  const roasPais = snap?.gasto && ventasVentana ? roasPorPais(snap.gasto, ventasVentana) : null;

  res.json({
    rango,

    // ── Los cuatro números que la home debería haber mostrado siempre ──
    lazo,        // ¿Meta sabe que vendimos? Es la razón de ser del sistema.
    accionable,  // Lo que una persona puede trabajar HOY. Decenas, no 94.371.
    cerrado,     // Lo que Meta cerró. No es deuda: es audiencia.
    preguntas,   // Qué pregunta la gente. El dato que le sirve al creativo.
    flujo,       // El gráfico: la puerta cerrándose, día por día.

    canales,
    bandeja,
    ventas, // La estación COMPRA: [{ pais, ventasUsd, ventas }], ordenado por plata.
    // El ROAS real por país: ventas (cliente) × gasto (audiencia), con el cerebro de decisiones.
    // null hasta que la pauta se revise y traiga el gasto por país desde Meta.
    roasPais,
    // La estación LEAD, acumulada (no por rango): total y cuántos siguen sin contactar.
    leads: { total: leadsStats.total, sinContactar: leadsStats.sin_atender },

    // Del snapshot. Si nunca se corrió, `pauta` viene en null y la pantalla dice "falta revisar"
    // en vez de mostrar un cero que parece un dato.
    pauta: snap
      ? {
          decisiones: detectar(snap.campanas),
          campanasAnalizadas: snap.campanas.length,
          costo: snap.costo,
          // Los creativos rankeados por plata: miniatura, copy, costo por resultado y veredicto.
          creativos: creativos(snap.campanas, tasas ?? new Map()),
          errores: snap.errores,
          // La card dice su EDAD en vez de fingir que está en vivo.
          revisadoAt: snap.creadoAt,
          edadMinutos: snap.edadMinutos,
        }
      : null,
  });
});

/** Las últimas que se pueden trabajar: dentro de ventana y sin atender. */
async function bandejaDe() {
  const filas = await db.execute(sql`
    SELECT id, canal, tipo, persona_nombre, texto, contexto_texto, occurred_at, status
    FROM interactions
    WHERE status = 'nuevo'
      AND direccion = 'entrante'
      -- Solo lo accionable: un comentario fuera de la ventana de 7 días de Meta no se puede
      -- responder en privado, así que no es trabajo — es archivo.
      AND (tipo = 'mensaje' OR occurred_at > now() - interval '7 days')
    ORDER BY occurred_at DESC
    LIMIT 15
  `);
  return filas as unknown as Record<string, unknown>[];
}


/**
 * EL RELOJ DE TESORERÍA — la pantalla que recupera el 17%.
 *
 * Cerberus ordena su bandeja por `-fecha_pago` (lo más reciente primero), sin columna de
 * antigüedad y sin ninguna alerta. Un pago viejo queda enterrado y no vuelve a subir nunca.
 * Ahí está el p90 de 10 días contra la ventana de 7 de Meta.
 *
 * Esto lo da vuelta: lo más viejo arriba, con el reloj corriendo al lado.
 * Solo LEE el espejo. La confirmación sigue ocurriendo en Cerberus, donde debe.
 */
overviewRouter.get("/tesoreria", async (_req, res) => {
  res.json(await relojDeTesoreria());
});


/**
 * El detalle del lazo — para monitorear el envío. Muestra por qué cada venta va o no va, si el
 * último envío fue de prueba o real, y las que Meta rechazó con el error a la vista.
 */
overviewRouter.get("/lazo", async (_req, res) => {
  res.json(await lazoDetalle());
});


/**
 * El tablero de salud: qué fluye, qué falta, qué sigue. Para que cualquiera entienda el estado
 * del sistema sin saber nada. Cada pieza con su semáforo y su edad; "lo que sigue" sale de los
 * gaps abiertos, no inventado.
 */
overviewRouter.get("/salud", async (_req, res) => {
  res.json(await salud());
});
