import { Router } from "express";
import { and, desc, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { pautaSnapshots } from "../db/operacion.js";
import { ultimoSnapshotConCampanas, type Snapshot } from "../pauta/snapshot.js";
import { cursoDeCampana } from "../pauta/curso.js";
import { rangoDe } from "../lib/rangos.js";
import type { CampaignInput, AdInput } from "../decisions/detectors.js";

export const pautaMaestroRouter = Router();

/**
 * Límites de rango para los snapshots históricos, compartidos con el maestro.
 * "hoy" y "mesPasado" son absolutos; el resto es una ventana hacia atrás.
 */
type RangoFiltro = "hoy" | "7d" | "30d" | "mes" | "mesPasado" | "todo";

const DIAS_HACIA_ATRAS: Record<Exclude<RangoFiltro, "hoy" | "mes" | "mesPasado">, number> = {
  "7d": 7,
  "30d": 30,
  todo: 3650,
};

/** Fecha mínima de snapshot a incluir, según el rango. `null` = no acotar. */
function rangoHasta(rangoQ: unknown, _orden: "asc" | "desc"): Date | null {
  const rango = (String(rangoQ ?? "todo") as RangoFiltro) in DIAS_HACIA_ATRAS ||
    ["hoy", "mes", "mesPasado", "todo"].includes(String(rangoQ ?? "todo"))
    ? (String(rangoQ ?? "todo") as RangoFiltro)
    : "todo";
  const ahora = new Date();

  if (rango === "todo") return null;
  if (rango === "hoy") {
    const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    return d;
  }
  if (rango === "mes") {
    return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  }
  if (rango === "mesPasado") {
    return new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  }
  const dias = DIAS_HACIA_ATRAS[rango as keyof typeof DIAS_HACIA_ATRAS];
  return new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
}

/**
 * El maestro filtra por rango de TIEMPO: acota las campañas del último snapshot
 * a las que tienen actividad (gasto o resultados) en la ventana pedida. Como el
 * snapshot ya trae los insights de la ventana, esto es un filtro sobre esos
 * números, no una llamada nueva a Meta.
 */
function recortarPorRango(campanas: CampaignInput[], rango: RangoFiltro): CampaignInput[] {
  if (rango === "todo") return campanas;
  if (rango === "mesPasado") {
    const ahora = new Date();
    const inicio = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const fin = new Date(ahora.getFullYear(), ahora.getMonth(), 0, 23, 59, 59);
    return campanas.filter((c) => (c.spend ?? 0) > 0 || (c.results ?? 0) > 0);
  }
  if (rango === "hoy") return campanas.filter((c) => (c.spend ?? 0) > 0 || (c.results ?? 0) > 0);
  const dias = DIAS_HACIA_ATRAS[rango as keyof typeof DIAS_HACIA_ATRAS] ?? 30;
  return campanas.filter((c) => (c.spend ?? 0) > 0 || (c.results ?? 0) > 0);
}

/**
 * EL MAESTRO DE PAUTAS — todas las campañas de todas las cuentas, en una tabla.
 *
 * Lee el último snapshot (Postgres, cero Meta) y lo aplana a una fila por
 * campaña. El "país" es la cuenta (`accountName`: "goberna chile", "Goberna
 * Bolivia"...) y el "curso" se deduce del nombre con una heurística
 * (`pauta/curso.ts`). Devuelve también la lista de cursos y países disponibles
 * para poblar los filtros sin que el frontend adivine.
 */
interface FilaPauta {
  id: string;
  nombre: string;
  pais: string;
  accountId: string;
  accountName: string;
  curso: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  moneda: string;
}

/** Lo que el snapshot sabe de fatiga por anuncio: la evidencia de un creativo quemado. */
interface AdDetalle {
  id: string;
  nombre: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  impresiones: number | null;
  alcance: number | null;
  frecuencia: number | null;
  fatiga: boolean;
  fatigaDeltaCtr: number | null;
  fatigaDeltaFrecuencia: number | null;
  diasConDatos: number | null;
  thumbnailUrl: string | null;
  body: string | null;
  title: string | null;
  reacciones: number | null;
  comentarios: number | null;
  compartidos: number | null;
  guardados: number | null;
  leads: number | null;
}

interface AdsetDetalle {
  id: string;
  nombre: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  publicosIncluidos: string[];
  publicosExcluidos: string[];
  ads: AdDetalle[];
}

interface PautaDetalle {
  id: string;
  nombre: string;
  pais: string;
  accountId: string;
  accountName: string;
  curso: string;
  estado: string;
  gasto: number;
  resultados: number | null;
  costoPorResultado: number | null;
  moneda: string;
  creadoAt: string | null;
  edadMinutos: number | null;
  adsets: AdsetDetalle[];
}

/** Deriva CPC, CPM, alcance e impresiones del anuncio a partir de lo que trae Meta. */
function metricasAd(ad: AdInput) {
  const gasto = ad.spend ?? 0;
  const impresiones = ad.impresiones ?? null;
  const clics = ad.clics ?? null;
  const frecuencia = ad.frecuencia ?? null;
  // CPM = gasto / impresiones × 1000. Sin impresiones, queda null (honesto).
  const cpm = impresiones && impresiones > 0 ? (gasto / impresiones) * 1000 : null;
  // CPC = gasto / clics. Sin clics, null.
  const cpc = clics && clics > 0 ? gasto / clics : null;
  // Alcance = impresiones / frecuencia (frecuencia = impresiones / alcance).
  const alcance = impresiones && frecuencia && frecuencia > 0 ? impresiones / frecuencia : null;
  return { cpm, cpc, alcance, impresiones };
}

/** Aplana una campaña del snapshot a su detalle completo (contexto + fatiga). */
function detalleDeCampana(camp: CampaignInput, snap: Snapshot): PautaDetalle {
  return {
    id: camp.id,
    nombre: camp.name,
    pais: camp.accountName,
    accountId: camp.accountId,
    accountName: camp.accountName,
    curso: cursoDeCampana(camp.name),
    estado: camp.status,
    gasto: camp.spend ?? 0,
    resultados: camp.results ?? null,
    costoPorResultado: camp.costPerResult ?? null,
    moneda: camp.currency,
    creadoAt: snap.creadoAt.toISOString(),
    edadMinutos: snap.edadMinutos,
    adsets: camp.adsets.map((a) => ({
      id: a.id,
      nombre: a.name,
      estado: a.status,
      gasto: a.spend ?? 0,
      resultados: a.results ?? null,
      costoPorResultado: a.costPerResult ?? null,
      publicosIncluidos: a.includedAudiences,
      publicosExcluidos: a.excludedAudiences,
      ads: a.ads.map((ad) => {
        const m = metricasAd(ad);
        return {
          id: ad.id,
          nombre: ad.name,
          estado: ad.status,
          gasto: ad.spend ?? 0,
          resultados: ad.results ?? null,
          costoPorResultado: ad.costPerResult ?? null,
          ctr: ad.ctr ?? null,
          cpc: m.cpc,
          cpm: m.cpm,
          impresiones: m.impresiones,
          alcance: m.alcance,
          frecuencia: ad.frecuencia ?? null,
          fatiga: ad.fatiga ?? false,
          fatigaDeltaCtr: ad.fatigaDeltaCtr ?? null,
          fatigaDeltaFrecuencia: ad.fatigaDeltaFrecuencia ?? null,
          diasConDatos: ad.diasConDatos ?? null,
          thumbnailUrl: ad.creative?.thumbnailUrl ?? null,
          body: ad.creative?.body ?? null,
          title: ad.creative?.title ?? null,
          reacciones: ad.reacciones ?? null,
          comentarios: ad.comentarios ?? null,
          compartidos: ad.compartidos ?? null,
          guardados: ad.guardados ?? null,
          leads: ad.leads ?? null,
        };
      }),
    })),
  };
}

/**
 * COMPARAR PAUTAS — selector de campañas + gráfico en el tiempo + diferencias.
 *
 * La serie de tiempo viene de los snapshots HISTÓRICOS que ya guarda el reloj
 * (cada 6 h), no de Meta en vivo: cero llamadas extra a la Graph API. Por cada
 * campaña seleccionada arma sus puntos (gasto/resultados/CPR) a lo largo de los
 * últimos ~60 snapshots. Y los detalles vienen del último snapshot con campañas.
 */
pautaMaestroRouter.get("/comparar", async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    res.json({ serie: [], detalles: [] });
    return;
  }

  const ult = await ultimoSnapshotConCampanas();
  if (!ult) {
    res.json({ serie: [], detalles: [] });
    return;
  }

  const campanasUlt = ult.campanas as CampaignInput[];
  const nombrePorId = new Map(campanasUlt.map((c) => [c.id, c.name]));
  const pedidas = ids.filter((id) => nombrePorId.has(id));

  // Serie histórica: snapshots desde el inicio del rango pedido (cada 6 h).
  const desde = rangoHasta(req.query.rango, "desc");
  const snaps = await db
    .select({ creadoAt: pautaSnapshots.creadoAt, campanas: pautaSnapshots.campanas })
    .from(pautaSnapshots)
    .where(desde ? gte(pautaSnapshots.creadoAt, desde) : undefined)
    .orderBy(desc(pautaSnapshots.creadoAt));

  // snaps viene nuevo→viejo; acumulamos y luego invertimos para dejarlo viejo→nuevo.
  const puntosPorId = new Map<string, { fecha: string; gasto: number; resultados: number | null; costoPorResultado: number | null }[]>();
  for (const id of pedidas) puntosPorId.set(id, []);

  for (const snap of snaps) {
    const campanas = snap.campanas as CampaignInput[];
    const fecha = snap.creadoAt.toISOString();
    for (const id of pedidas) {
      const c = campanas.find((x) => x.id === id);
      if (!c) continue;
      puntosPorId.get(id)!.push({
        fecha,
        gasto: c.spend ?? 0,
        resultados: c.results ?? null,
        costoPorResultado: c.costPerResult ?? null,
      });
    }
  }

  const serie = pedidas.map((id) => ({
    id,
    nombre: nombrePorId.get(id) ?? id,
    puntos: (puntosPorId.get(id) ?? []).reverse(),
  }));

  const detalles = pedidas.map((id) =>
    detalleDeCampana(campanasUlt.find((c) => c.id === id)!, ult),
  );

  res.json({ serie, detalles });
});

/**
 * HISTÓRICO PARA GRAFICAR — la serie de tiempo de TODAS las campañas, por rango.
 *
 * La gráfica de comparación necesita puntos aunque el reloj lleve poco tiempo
 * corriendo: este endpoint lee todos los snapshots guardados en el rango y los
 * aplana a un punto por campaña por snapshot. El frontend los usa para pintar
 * la evolución aunque el usuario no haya acumulado muchas revisiones todavía.
 */
pautaMaestroRouter.get("/snapshots", async (req, res) => {
  const desde = rangoHasta(req.query.rango, "asc");
  const snaps = await db
    .select({ creadoAt: pautaSnapshots.creadoAt, campanas: pautaSnapshots.campanas })
    .from(pautaSnapshots)
    .where(desde ? gte(pautaSnapshots.creadoAt, desde) : undefined)
    .orderBy(desc(pautaSnapshots.creadoAt));

  const puntos = snaps.map((s) => ({
    fecha: s.creadoAt.toISOString(),
    campanas: (s.campanas as CampaignInput[]).map((c) => ({
      id: c.id,
      nombre: c.name,
      gasto: c.spend ?? 0,
      resultados: c.results ?? null,
      costoPorResultado: c.costPerResult ?? null,
    })),
  }));

  res.json({ puntos });
});

pautaMaestroRouter.get("/:campaignId", async (req, res) => {
  const { campaignId } = req.params;
  const snap = await ultimoSnapshotConCampanas();

  if (!snap) {
    res.json({ detalle: null });
    return;
  }

  const camp = (snap.campanas as CampaignInput[]).find((c) => c.id === campaignId);
  if (!camp) {
    res.json({ detalle: null });
    return;
  }

  const detalle = detalleDeCampana(camp, snap);

  res.json({ detalle });
});

pautaMaestroRouter.get("/", async (req, res) => {
  const snap = await ultimoSnapshotConCampanas();

  if (!snap) {
    res.json({ creadoAt: null, edadMinutos: null, campanas: [], cursos: [], paises: [] });
    return;
  }

  const rangoQ = String(req.query.rango ?? "todo");
  // El maestro usa sus propios rangos de UI; mapeamos los de Meta a los nuestros.
  const rango: RangoFiltro =
    rangoQ === "90d" || rangoQ === "1y" ? "30d" : ((rangoQ as RangoFiltro) in DIAS_HACIA_ATRAS || ["hoy", "mes", "mesPasado", "todo"].includes(rangoQ) ? (rangoQ as RangoFiltro) : "todo");
  const campanasBase = snap.campanas as CampaignInput[];

  // El rango acota por la VENTANA de los insights del snapshot (gasto/resultados
  // son de esa ventana). "todo" = sin acotar. Cortamos en el rango pedido.
  const recorte = recortarPorRango(campanasBase, rango);
  const campanas: FilaPauta[] = recorte
    .map((c) => ({
      id: c.id,
      nombre: c.name,
      pais: c.accountName,
      accountId: c.accountId,
      accountName: c.accountName,
      curso: cursoDeCampana(c.name),
      estado: c.status,
      gasto: c.spend ?? 0,
      resultados: c.results ?? null,
      costoPorResultado: c.costPerResult ?? null,
      moneda: c.currency,
    }))
    .sort((a, b) =>
      a.pais.localeCompare(b.pais) || a.curso.localeCompare(b.curso) || a.nombre.localeCompare(b.nombre),
    );

  const cursos = [...new Set(campanas.map((c) => c.curso))].sort();
  const paises = [...new Set(campanas.map((c) => c.pais))].sort();

  res.json({
    creadoAt: snap.creadoAt,
    edadMinutos: snap.edadMinutos,
    campanas,
    cursos,
    paises,
  });
});
