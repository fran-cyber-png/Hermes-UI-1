import type { Decision } from "./types.js";

/**
 * Los detectores son funciones PURAS sobre una estructura ya traída de Meta.
 * No hacen llamadas a la API — importa, porque la cuenta tiene un rate limit
 * ajustado y correr una llamada por regla la tumbaría.
 *
 * Cada uno devuelve solo lo que tiene plata en juego. Un hallazgo sin impacto
 * en dinero no es una decisión: es ruido.
 */

/** El creativo de un anuncio: cómo se ve y qué dice. Opcional — Meta no siempre lo devuelve. */
export interface CreativeInput {
  thumbnailUrl: string | null;
  body: string | null;
  title: string | null;
  objectType: string | null;
  /** El post real detrás del anuncio: la llave para unir comentarios con creativos (RG-005). */
  storyId: string | null;
}

export interface AdInput {
  id: string;
  name: string;
  status: string;
  spend: number;
  results: number | null;
  costPerResult: number | null;
  creative?: CreativeInput | null;
  /** ¿Está quemado? Frecuencia sube Y CTR baja sobre ≥14 días (ver `pauta/fatiga.ts`). */
  fatiga?: boolean;
  ctr?: number | null;
  frecuencia?: number | null;
  diasConDatos?: number;
}

export interface AdsetInput {
  id: string;
  name: string;
  status: string;
  spend: number;
  results: number | null;
  costPerResult: number | null;
  includedAudiences: string[];
  excludedAudiences: string[];
  ads: AdInput[];
}

export interface CampaignInput {
  id: string;
  name: string;
  status: string;
  spend: number;
  results: number | null;
  costPerResult: number | null;
  accountId: string;
  accountName: string;
  currency: string;
  adsets: AdsetInput[];
}

/** Debajo de esto, el gasto es tan chico que mover algo no cambia nada. */
const GASTO_MINIMO_RELEVANTE = 20;

const activo = (s: string) => s === "ACTIVE";

const ctx = (c: CampaignInput) => ({
  campaignId: c.id,
  campaignName: c.name,
  accountId: c.accountId,
  accountName: c.accountName,
  moneda: c.currency,
});

/**
 * El presupuesto está donde no rinde.
 *
 * Es el detector que encontró la fuga real: el conjunto "ABRIL" se llevaba el
 * 78% del gasto a $1.24/resultado, mientras "MAYO" traía resultados a $0.62 con
 * el 10%. La plata en juego = los resultados que se pierden por esa diferencia.
 */
export function presupuestoMalRepartido(c: CampaignInput): Decision[] {
  const conDatos = c.adsets.filter(
    (a) => activo(a.status) && a.costPerResult !== null && a.costPerResult > 0 && a.spend >= GASTO_MINIMO_RELEVANTE,
  );
  if (conDatos.length < 2) return [];

  const mejor = conDatos.reduce((m, a) => (a.costPerResult! < m.costPerResult! ? a : m));
  const caros = conDatos.filter((a) => a.id !== mejor.id && a.costPerResult! >= mejor.costPerResult! * 1.5);
  if (caros.length === 0) return [];

  return caros.map((caro) => {
    // Los resultados que ese gasto daría si rindiera como el mejor conjunto.
    const resultadosSiFueraElMejor = caro.spend / mejor.costPerResult!;
    const resultadosActuales = caro.spend / caro.costPerResult!;
    const resultadosPerdidos = Math.round(resultadosSiFueraElMejor - resultadosActuales);
    // La plata desperdiciada: lo que costaría de más conseguir esos resultados.
    const plataEnJuego = caro.spend - resultadosActuales * mejor.costPerResult!;
    const veces = (caro.costPerResult! / mejor.costPerResult!).toFixed(1);

    return {
      id: `presupuesto:${caro.id}`,
      detector: "presupuesto-mal-repartido",
      nivel: "conjunto",
      titulo: `«${caro.name}» cuesta ${veces}× más que tu mejor conjunto`,
      detalle:
        `Gastó ${caro.spend.toFixed(2)} a ${caro.costPerResult!.toFixed(2)} por resultado, ` +
        `mientras «${mejor.name}» los trae a ${mejor.costPerResult!.toFixed(2)}. ` +
        `Con esa misma plata, moviéndola al que rinde, tendrías ~${resultadosPerdidos} resultados más.`,
      plataEnJuego,
      ...ctx(c),
      accion: {
        tipo: "mover-presupuesto",
        descripcion: `Mover presupuesto de «${caro.name}» a «${mejor.name}»`,
        antes: { conjunto: caro.name, costoPorResultado: caro.costPerResult },
        despues: { conjunto: mejor.name, costoPorResultado: mejor.costPerResult },
        objetivos: [caro.id, mejor.id],
      },
    };
  });
}

/**
 * Le estás pagando a Meta por mostrarle el anuncio a gente que ya se inscribió.
 *
 * Confirmado con datos reales: los 3 conjuntos de OSINT incluyen 14 públicos y
 * excluyen CERO — aunque la cuenta tiene públicos de exclusión ya creados.
 */
export function sinExclusiones(c: CampaignInput): Decision[] {
  return c.adsets
    .filter(
      (a) =>
        activo(a.status) &&
        a.includedAudiences.length > 0 &&
        a.excludedAudiences.length === 0 &&
        a.spend >= GASTO_MINIMO_RELEVANTE,
    )
    .map((a) => ({
      id: `exclusiones:${a.id}`,
      detector: "sin-exclusiones" as const,
      nivel: "conjunto" as const,
      titulo: `«${a.name}» no excluye a nadie`,
      detalle:
        `Incluye ${a.includedAudiences.length} públicos y no excluye a ninguno. ` +
        `Le estás pagando a Meta por volver a mostrarle el anuncio a gente que ya se inscribió o ya compró.`,
      // No se puede saber exactamente cuánto se desperdicia sin cruzar los
      // públicos, así que se usa una estimación conservadora del gasto del
      // conjunto. Es una señal de orden de magnitud, no una cifra exacta.
      plataEnJuego: a.spend * 0.15,
      ...ctx(c),
      accion: {
        tipo: "excluir-publicos" as const,
        descripcion: `Excluir a quienes ya convirtieron en «${a.name}»`,
        antes: { excluidos: 0 },
        objetivos: [a.id],
      },
    }));
}

/** Un anuncio muy por encima del promedio de su campaña: candidato a pausar. */
export function anuncioCaro(c: CampaignInput): Decision[] {
  if (c.costPerResult === null || c.costPerResult === 0) return [];
  const promedio = c.costPerResult;

  return c.adsets
    .filter((a) => activo(a.status))
    .flatMap((a) => a.ads)
    .filter(
      (ad) =>
        activo(ad.status) &&
        ad.costPerResult !== null &&
        ad.costPerResult >= promedio * 1.5 &&
        ad.spend >= GASTO_MINIMO_RELEVANTE,
    )
    .map((ad) => {
      const veces = (ad.costPerResult! / promedio).toFixed(1);
      // Lo que se ahorraría si ese gasto rindiera como el promedio.
      const plataEnJuego = ad.spend - (ad.results ?? 0) * promedio;
      return {
        id: `caro:${ad.id}`,
        detector: "anuncio-caro" as const,
        nivel: "anuncio" as const,
        titulo: `El anuncio «${ad.name}» cuesta ${veces}× el promedio`,
        detalle:
          `Gastó ${ad.spend.toFixed(2)} y cada resultado te sale ${ad.costPerResult!.toFixed(2)}, ` +
          `contra ${promedio.toFixed(2)} del promedio de la campaña.`,
        plataEnJuego,
        ...ctx(c),
        accion: {
          tipo: "pausar" as const,
          descripcion: `Pausar el anuncio «${ad.name}»`,
          antes: { status: ad.status },
          despues: { status: "PAUSED" },
          objetivos: [ad.id],
        },
      };
    });
}

/** Gastó plata y no trajo nada. */
export function gastoSinResultados(c: CampaignInput): Decision[] {
  return c.adsets
    .filter((a) => activo(a.status))
    .flatMap((a) => a.ads)
    .filter((ad) => activo(ad.status) && ad.spend >= GASTO_MINIMO_RELEVANTE && (ad.results ?? 0) === 0)
    .map((ad) => ({
      id: `sin-resultados:${ad.id}`,
      detector: "gasto-sin-resultados" as const,
      nivel: "anuncio" as const,
      titulo: `«${ad.name}» gastó ${ad.spend.toFixed(2)} y no trajo ningún resultado`,
      detalle: `Está activo y consumiendo presupuesto sin devolver nada.`,
      plataEnJuego: ad.spend,
      ...ctx(c),
      accion: {
        tipo: "pausar" as const,
        descripcion: `Pausar el anuncio «${ad.name}»`,
        antes: { status: ad.status },
        despues: { status: "PAUSED" },
        objetivos: [ad.id],
      },
    }));
}

/** Lo que mejor rinde está recibiendo migajas. La otra cara de la fuga. */
export function ganadorSinEscalar(c: CampaignInput): Decision[] {
  const conDatos = c.adsets.filter(
    (a) => activo(a.status) && a.costPerResult !== null && a.costPerResult > 0 && a.spend > 0,
  );
  if (conDatos.length < 2 || c.spend === 0) return [];

  const mejor = conDatos.reduce((m, a) => (a.costPerResult! < m.costPerResult! ? a : m));
  const participacion = mejor.spend / c.spend;
  if (participacion >= 0.25) return [];

  // Si le diéramos el gasto promedio, cuántos resultados más traería.
  const gastoPromedio = c.spend / conDatos.length;
  const extra = Math.round((gastoPromedio - mejor.spend) / mejor.costPerResult!);
  if (extra <= 0) return [];

  return [
    {
      id: `escalar:${mejor.id}`,
      detector: "ganador-sin-escalar",
      nivel: "conjunto",
      titulo: `Tu conjunto más barato solo recibe el ${Math.round(participacion * 100)}% del presupuesto`,
      detalle:
        `«${mejor.name}» trae resultados a ${mejor.costPerResult!.toFixed(2)} — el más barato de la campaña — ` +
        `pero apenas gastó ${mejor.spend.toFixed(2)}. Con presupuesto parejo traería ~${extra} resultados más.`,
      plataEnJuego: extra * mejor.costPerResult!,
      ...ctx(c),
      accion: {
        tipo: "subir-presupuesto",
        descripcion: `Subirle el presupuesto a «${mejor.name}»`,
        antes: { gasto: mejor.spend },
        despues: { gasto: gastoPromedio },
        objetivos: [mejor.id],
      },
    },
  ];
}

/** Corre todos los detectores y ordena por plata en juego. */
export function detectar(campanas: CampaignInput[]): Decision[] {
  const todas = campanas.flatMap((c) => [
    ...presupuestoMalRepartido(c),
    ...sinExclusiones(c),
    ...anuncioCaro(c),
    ...gastoSinResultados(c),
    ...ganadorSinEscalar(c),
  ]);

  // El orden del feed: lo que más plata cuesta, primero.
  return todas.sort((a, b) => b.plataEnJuego - a.plataEnJuego);
}
