import type { PautaDetalle, FilaAd, FilaAdset } from './types';

export interface AnalisisCampana {
  detalle: PautaDetalle;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  alcance: number | null;
  impresiones: number | null;
  frecuencia: number | null;
  quemados: number;
  anuncios: number;
  /** Score compuesto 0-100 (mayor = mejor). */
  score: number;
}

/**
 * Métricas derivadas de un detalle (CTR/frecuencia promedio, creativos quemados).
 * Replica la lógica de `resumen` que ya existía en PautaCompararPage.
 */
export function metricasDerivadas(d: PautaDetalle) {
  let anuncios = 0;
  let quemados = 0;
  const ctrs: number[] = [];
  const cpc: number[] = [];
  const cpm: number[] = [];
  const alc: number[] = [];
  const imp: number[] = [];
  const frecs: number[] = [];
  for (const a of d.adsets) {
    anuncios += a.ads.length;
    for (const ad of a.ads) {
      if (ad.fatiga) quemados += 1;
      if (ad.ctr != null) ctrs.push(ad.ctr);
      if (ad.cpc != null) cpc.push(ad.cpc);
      if (ad.cpm != null) cpm.push(ad.cpm);
      if (ad.alcance != null) alc.push(ad.alcance);
      if (ad.impresiones != null) imp.push(ad.impresiones);
      if (ad.frecuencia != null) frecs.push(ad.frecuencia);
    }
  }
  const prom = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    anuncios,
    quemados,
    ctr: prom(ctrs),
    cpc: prom(cpc),
    cpm: prom(cpm),
    alcance: alc.length ? alc.reduce((s, x) => s + x, 0) : null,
    impresiones: imp.length ? imp.reduce((s, x) => s + x, 0) : null,
    frecuencia: prom(frecs),
  };
}

/**
 * Score compuesto 0-100 normalizando resultados (a más es mejor), CPR (a menos
 * es mejor) y CTR (a más es mejor) contra el set seleccionado.
 */
export function analizarCampanas(detalles: PautaDetalle[]): AnalisisCampana[] {
  if (detalles.length === 0) return [];

  const metricas = detalles.map((d) => ({ d, ...metricasDerivadas(d) }));

  const resultados = metricas.map((m) => m.d.resultados ?? 0);
  const cprs = metricas.map((m) => m.d.costoPorResultado ?? Infinity);
  const ctrs = metricas.map((m) => m.ctr ?? 0);

  const norm = (v: number, min: number, max: number) =>
    max === min ? 0.5 : (v - min) / (max - min);

  return metricas
    .map((m) => {
      const sResultados = norm(m.d.resultados ?? 0, Math.min(...resultados), Math.max(...resultados));
      const sCpr = 1 - norm(m.d.costoPorResultado ?? Infinity, Math.min(...cprs), Math.max(...cprs));
      const sCtr = norm(m.ctr ?? 0, Math.min(...ctrs), Math.max(...ctrs));
      // Pesos: resultados 45%, CPR 35%, CTR 20%.
      const score = Math.round((sResultados * 0.45 + sCpr * 0.35 + sCtr * 0.2) * 100);
      return { detalle: m.d, ctr: m.ctr, cpc: m.cpc, cpm: m.cpm, alcance: m.alcance, impresiones: m.impresiones, frecuencia: m.frecuencia, quemados: m.quemados, anuncios: m.anuncios, score };
    })
    .sort((a, b) => b.score - a.score);
}

export type Verdict = 'escalar' | 'ok' | 'revisar' | 'desperdicia';

export interface Veredicto {
  tipo: Verdict;
  label: string;
  clase: string;
}

/** Veredicto de acción a partir de score + creativos quemados. */
export function veredicto(a: AnalisisCampana): Veredicto {
  if (a.score >= 75 && a.quemados === 0)
    return { tipo: 'escalar', label: 'Escalar', clase: 'bg-success/10 text-success' };
  if (a.quemados > 0 && a.score < 50)
    return { tipo: 'desperdicia', label: 'Desperdicia', clase: 'bg-destructive/10 text-destructive' };
  if (a.score < 50)
    return { tipo: 'revisar', label: 'Revisar', clase: 'bg-warning/10 text-warning' };
  return { tipo: 'ok', label: 'OK', clase: 'bg-primary/10 text-primary' };
}

export interface InsightResumen {
  mejorCampana: PautaDetalle | null;
  mejorCpa: PautaDetalle | null;
  mejorCtr: { detalle: PautaDetalle; ctr: number } | null;
  masLeads: PautaDetalle | null;
  peorCpa: PautaDetalle | null;
}

export function resumenInsights(detalles: PautaDetalle[]): InsightResumen {
  if (detalles.length === 0)
    return { mejorCampana: null, mejorCpa: null, mejorCtr: null, masLeads: null, peorCpa: null };

  const conCpr = detalles.filter((d) => d.costoPorResultado != null);
  const conResultados = detalles.filter((d) => (d.resultados ?? 0) > 0);

  const mejorCpa = conCpr.length
    ? conCpr.reduce((m, d) => ((d.costoPorResultado ?? 0) < (m.costoPorResultado ?? Infinity) ? d : m))
    : null;
  const peorCpa = conCpr.length
    ? conCpr.reduce((m, d) => ((d.costoPorResultado ?? 0) > (m.costoPorResultado ?? -Infinity) ? d : m))
    : null;
  const masLeads = conResultados.length
    ? conResultados.reduce((m, d) => ((d.resultados ?? 0) > (m.resultados ?? 0) ? d : m))
    : null;

  const ctrs = detalles
    .map((d) => ({ detalle: d, ctr: metricasDerivadas(d).ctr ?? 0 }))
    .filter((x) => x.ctr > 0);
  const mejorCtr = ctrs.length ? ctrs.reduce((m, x) => (x.ctr > m.ctr ? x : m)) : null;

  const analizadas = analizarCampanas(detalles);
  const mejorCampana = analizadas[0]?.detalle ?? null;

  return { mejorCampana, mejorCpa, mejorCtr, masLeads, peorCpa };
}

/**
 * Aplana TODOS los anuncios (creativos) de las campañas pedidas a una fila por
 * anuncio, con su campaña y conjunto padre para el contexto.
 */
export function aplanarAds(detalles: PautaDetalle[]): FilaAd[] {
  const filas: FilaAd[] = [];
  for (const d of detalles) {
    for (const a of d.adsets) {
      for (const ad of a.ads) {
        filas.push({
          id: ad.id,
          nombre: ad.nombre,
          campanaId: d.id,
          campanaNombre: d.nombre,
          adsetId: a.id,
          adsetNombre: a.nombre,
          estado: ad.estado,
          gasto: ad.gasto,
          resultados: ad.resultados,
          costoPorResultado: ad.costoPorResultado,
          ctr: ad.ctr,
          cpc: ad.cpc,
          cpm: ad.cpm,
          impresiones: ad.impresiones,
          alcance: ad.alcance,
          frecuencia: ad.frecuencia,
          fatiga: ad.fatiga,
          fatigaDeltaCtr: ad.fatigaDeltaCtr,
          fatigaDeltaFrecuencia: ad.fatigaDeltaFrecuencia,
          diasConDatos: ad.diasConDatos,
          thumbnailUrl: ad.thumbnailUrl,
          body: ad.body,
          title: ad.title,
          reacciones: ad.reacciones,
          comentarios: ad.comentarios,
          compartidos: ad.compartidos,
          guardados: ad.guardados,
          leads: ad.leads,
          moneda: d.moneda,
        });
      }
    }
  }
  return filas;
}

/** Aplana los conjuntos (adsets) de las campañas pedidas. */
export function aplanarAdsets(detalles: PautaDetalle[]): FilaAdset[] {
  const filas: FilaAdset[] = [];
  for (const d of detalles) {
    for (const a of d.adsets) {
      const ctrs = a.ads.map((ad) => ad.ctr).filter((x): x is number => x != null);
      const cpc = a.ads.map((ad) => ad.cpc).filter((x): x is number => x != null);
      filas.push({
        id: a.id,
        nombre: a.nombre,
        campanaId: d.id,
        campanaNombre: d.nombre,
        estado: a.estado,
        gasto: a.gasto,
        resultados: a.resultados,
        costoPorResultado: a.costoPorResultado,
        ctr: ctrs.length ? ctrs.reduce((s, x) => s + x, 0) / ctrs.length : null,
        cpc: cpc.length ? cpc.reduce((s, x) => s + x, 0) / cpc.length : null,
        frecuencia: null,
        moneda: d.moneda,
      });
    }
  }
  return filas;
}
