import { MetaGraphClient } from "../meta/metaClient.js";
import type { AdInput, CampaignInput } from "../decisions/detectors.js";

/**
 * LA FATIGA DEL CREATIVO — cuándo un anuncio se quemó y sigue gastando.
 *
 * Portado de `goberna-dashboard/core/services/creative_perf.py`. La señal no es "el CTR bajó" ni "la
 * frecuencia subió" por separado —cualquiera de las dos sola tiene mil explicaciones—: es que la
 * FRECUENCIA SUBE **y** el CTR BAJA al mismo tiempo. Traducido: al mismo público se le muestra el
 * anuncio cada vez más, y cada vez responde menos. Eso es un creativo agotado quemando presupuesto.
 *
 * La condición doble evita los falsos positivos. El piso de 14 días también: con menos, la mitad
 * contra mitad es ruido, no tendencia.
 *
 * ── Por qué se pide aparte ──
 * Necesita la serie DIARIA por anuncio (`time_increment: 1`), que el snapshot normal no trae. Se pide
 * solo para los anuncios que gastaron —los únicos que pueden estar quemándose— y en una ventana corta.
 */

/** Sin al menos dos semanas, partir la serie a la mitad no dice nada. */
const MIN_DIAS = 14;
const CUENTAS_EN_PARALELO = 4;

/**
 * ── EL UMBRAL MÍNIMO DE EFECTO — lo que separa una señal de una moneda al aire ──
 *
 * Sin esto, la condición era `freqFin > freqIni && ctrFin < ctrIni`: CUALQUIER diferencia, por
 * infinitesimal que fuera, marcaba el creativo como quemado. Una frecuencia que pasa de 1,2000 a
 * 1,2001 y un CTR que baja de 2,5000 a 2,4999 daban QUEMADO.
 *
 * Y como las dos comparaciones son casi independientes y casi simétricas, la probabilidad de que
 * un creativo PERFECTAMENTE ESTABLE diera positivo por puro ruido era ~25% (½ × ½). Uno de cada
 * cuatro. Pausar un creativo sano cuesta plata igual que dejar corriendo uno quemado.
 *
 * Ahora el cambio tiene que ser MATERIAL en las dos direcciones a la vez.
 */
const SUBE_FRECUENCIA = 0.1; // +10% relativo: se le muestra notoriamente más al mismo público
const CAE_CTR = 0.15; // −15% relativo: y responde notoriamente menos

export type PuntoSerie = { fecha: string; frecuencia: number | null; ctr: number | null };

/**
 * El veredicto, con sus números a la vista. No es un booleano suelto: si el sistema dice «este
 * creativo está quemado», tiene que poder mostrar CUÁNTO subió la frecuencia y CUÁNTO cayó el CTR.
 */
export type Fatiga = {
  quemado: boolean;
  /** Variación relativa de la frecuencia entre la primera y la segunda mitad. +0.18 = subió 18%. */
  deltaFrecuencia: number;
  /** Variación relativa del CTR. −0.32 = cayó 32%. */
  deltaCtr: number;
};

function promedio(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/**
 * ¿Está quemado? Se parte la serie en dos mitades y se comparan sus promedios: hay fatiga cuando la
 * frecuencia SUBE y el CTR BAJA — las dos, y las dos de forma MATERIAL (ver los umbrales arriba).
 *
 * Devuelve `null` cuando no se puede saber: serie corta, o sin datos de frecuencia/CTR. `null` no
 * es «está sano» — es «no lo sé», y la pantalla tiene que decir eso y no un booleano tranquilizador.
 *
 * Una honestidad sobre la métrica: con `time_increment: 1`, la `frequency` que devuelve Meta es la
 * del DÍA (impresiones/alcance dentro de ese día), no la acumulada de la campaña. Que suba significa
 * que al mismo público se le repite más veces por día — es señal de saturación, pero más débil que
 * la frecuencia acumulada. Por eso el peso real de la decisión lo carga la CAÍDA DEL CTR, con el
 * umbral más exigente de los dos.
 */
export function evaluarFatiga(serie: PuntoSerie[]): Fatiga | null {
  if (!serie || serie.length < MIN_DIAS) return null;

  const orden = [...serie].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const mitad = Math.floor(orden.length / 2);
  const primera = orden.slice(0, mitad);
  const segunda = orden.slice(mitad);

  const freqIni = promedio(primera.map((d) => d.frecuencia));
  const freqFin = promedio(segunda.map((d) => d.frecuencia));
  const ctrIni = promedio(primera.map((d) => d.ctr));
  const ctrFin = promedio(segunda.map((d) => d.ctr));

  if (freqIni == null || freqFin == null || ctrIni == null || ctrFin == null) return null;
  // Sin base no hay variación relativa que calcular (y dividir por cero inventaría un infinito).
  if (freqIni <= 0 || ctrIni <= 0) return null;

  const deltaFrecuencia = (freqFin - freqIni) / freqIni;
  const deltaCtr = (ctrFin - ctrIni) / ctrIni;

  return {
    quemado: deltaFrecuencia >= SUBE_FRECUENCIA && deltaCtr <= -CAE_CTR,
    deltaFrecuencia,
    deltaCtr,
  };
}

/** Azúcar para el camino de decisión: `null` (no lo sé) cuenta como «no está quemado». */
export function hayFatiga(serie: PuntoSerie[]): boolean {
  return evaluarFatiga(serie)?.quemado ?? false;
}

type Ventana = Record<string, string>;

/**
 * Trae la serie diaria de los anuncios que gastaron y les cuelga la fatiga, el CTR y la frecuencia.
 * Muta los anuncios en su lugar. Un fallo no tumba la corrida: los creativos son un plus.
 */
export async function adjuntarFatiga(
  token: string,
  cuentas: string[],
  campanas: CampaignInput[],
  ventana: Ventana,
): Promise<number> {
  // Solo los anuncios con gasto: son los únicos que pueden estar quemando plata.
  const porId = new Map<string, AdInput>();
  for (const camp of campanas) {
    for (const adset of camp.adsets) {
      for (const ad of adset.ads) if (ad.spend > 0) porId.set(ad.id, ad);
    }
  }
  if (porId.size === 0) return 0;

  const client = new MetaGraphClient(token);
  const series = new Map<string, PuntoSerie[]>();

  for (let i = 0; i < cuentas.length; i += CUENTAS_EN_PARALELO) {
    const tanda = cuentas.slice(i, i + CUENTAS_EN_PARALELO);
    await Promise.all(
      tanda.map(async (cuenta) => {
        const actId = cuenta.startsWith("act_") ? cuenta : `act_${cuenta}`;
        try {
          const filas = await client.getAll(`${actId}/insights`, {
            level: "ad",
            time_increment: "1", // la serie DÍA a DÍA: sin esto no hay tendencia que medir
            ...ventana,
            fields: "ad_id,frequency,ctr,impressions,clicks",
            limit: "500",
          });
          for (const f of filas as any[]) {
            if (!porId.has(f.ad_id)) continue; // no gastó: no interesa
            const lista = series.get(f.ad_id) ?? [];
            lista.push({
              fecha: String(f.date_start ?? ""),
              frecuencia: f.frequency != null ? Number(f.frequency) : null,
              ctr: f.ctr != null ? Number(f.ctr) : null,
            });
            series.set(f.ad_id, lista);
          }
        } catch {
          // Una cuenta que falla no tumba la corrida: esos anuncios quedan sin fatiga, no revientan.
        }
      }),
    );
  }

  let marcados = 0;
  for (const [id, serie] of series) {
    const ad = porId.get(id);
    if (!ad) continue;
    ad.diasConDatos = serie.length;
    ad.ctr = promedio(serie.map((s) => s.ctr));
    ad.frecuencia = promedio(serie.map((s) => s.frecuencia));

    // El veredicto viene con sus números: la pantalla muestra POR QUÉ está quemado
    // («el CTR cayó 32% mientras la frecuencia subía 18%»), no un sello sin evidencia.
    const f = evaluarFatiga(serie);
    ad.fatiga = f?.quemado ?? false;
    ad.fatigaDeltaCtr = f?.deltaCtr ?? null;
    ad.fatigaDeltaFrecuencia = f?.deltaFrecuencia ?? null;
    if (ad.fatiga) marcados += 1;
  }
  return marcados;
}
