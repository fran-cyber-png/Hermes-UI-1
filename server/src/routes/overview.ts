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
import { atribucionPorPais } from "../sdk/index.js";
import { creativos } from "../analisis/creativos.js";
import { comercial } from "../analisis/comercial.js";
import { cartera } from "../analisis/cartera.js";
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
  // Se calcula UNA vez y se corta: la pantalla muestra 9 creativos, no hace falta mandar los 129
  // con su copy entero (eran 128 KB de payload). El BFF manda lo que la pantalla necesita.
  const todosLosCreativos = snap ? creativos(snap.campanas, tasas ?? new Map()) : [];
  // La cadena snapshot → ventana → ventas → ROAS → explicación vive ahora en el SDK
  // (`governa.atribucion.roasPorPais`). Estaba escrita DOS veces en este archivo —acá y en el
  // handler `/atribucion`— y ya había empezado a divergir. El snapshot se le pasa porque esta ruta
  // ya lo tiene en la mano: volver a pedirlo sería pagar dos veces la parte cara (129 campañas en
  // jsonb) por prolijidad. La ventana sigue anclada a `snap.creadoAt`, no a `now()`.
  const atribucion = await atribucionPorPais(rango, snap);
  const roasPais = atribucion.disponible ? atribucion.roasPais : null;

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
          decisiones: detectar(snap.campanas, tasas ?? new Map()),
          campanasAnalizadas: snap.campanas.length,
          costo: snap.costo,
          // Los 24 con más inversión detrás, no los 129: la pantalla muestra 9.
          creativos: todosLosCreativos.slice(0, 24),
          creativosTotales: todosLosCreativos.length,
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


/**
 * La inteligencia comercial de Cerberus, que el ERP siempre supo y nadie miraba: la serie mensual
 * (el eje del tiempo que no teníamos), la latencia de Tesorería (lo que saca ventas de la ventana de
 * Meta), el mix de producto (qué se vende de verdad) y el embudo de estados (cuánto se reembolsa).
 */
overviewRouter.get("/comercial", async (_req, res) => {
  res.json(await comercial());
});


/**
 * La cartera y el cliente: la cobranza viva (que nadie medía), los medios de pago y su tasa de
 * rechazo, y los segmentos de valor — la semilla de las audiencias lookalike de Meta.
 */
overviewRouter.get("/cartera", async (_req, res) => {
  res.json(await cartera());
});


/**
 * LA ATRIBUCIÓN — ROAS / CAC por país.
 *
 * Este endpoint nació con el comentario "listo para Ivi (consultas especializadas)": una consulta
 * con forma de PREGUNTA, viviendo dentro del router de las PANTALLAS. Era el síntoma de que
 * faltaba el SDK, y de que su ausencia se estaba pagando en copias — esta lógica estaba duplicada
 * con el handler `/` de arriba.
 *
 * Ahora es un adaptador de una línea sobre `governa.atribucion.roasPorPais`. Se mantiene la ruta
 * porque Ivi la consume hoy; cuando migre al catálogo (iteración 2), esto se puede borrar.
 */
overviewRouter.get("/atribucion", async (_req, res) => {
  res.json(await atribucionPorPais("90d", await ultimoSnapshot("90d")));
});
