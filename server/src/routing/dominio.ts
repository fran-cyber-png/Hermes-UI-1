/**
 * EL RUTEO POR CAMPAÑA — las reglas puras, sin base y sin red.
 *
 * Acá vive lo que decide; `repositorio.ts` lee, `meta.ts` pregunta y
 * `routes/routing.ts` cablea. La razón de siempre: la decisión que reparte un
 * lead tiene que poder interrogarse sin levantar Postgres ni llamar a Meta.
 */

/** El `effective_status` de Meta, traducido a lo que la pantalla necesita decir. */
export type EstadoCampana = "activa" | "pausada" | "desconocido";

/**
 * ⚠️ **Un estado que no conocemos NO es «pausada».** Meta tiene varios
 * (`ARCHIVED`, `IN_PROCESS`, `WITH_ISSUES`, `CAMPAIGN_PAUSED`…) y va a agregar
 * más. Mapear lo desconocido a «pausada» diría que una campaña que está gastando
 * plata no está corriendo — al revés, mapearlo a «activa» prometería tráfico que
 * no existe. Se dice **que no se sabe**, que es lo único cierto.
 *
 * `ACTIVE` es la única que afirma. Todo lo que Meta nombra explícitamente como
 * pausado (la campaña, su adset o el anuncio) se lee «pausada».
 */
export function leerEstado(effectiveStatus: string | null | undefined): EstadoCampana {
  const s = (effectiveStatus ?? "").trim().toUpperCase();
  if (s === "ACTIVE") return "activa";
  if (s === "PAUSED" || s.endsWith("_PAUSED")) return "pausada";
  return "desconocido";
}

/** Una campaña como se la ve en la pantalla de Routing. */
export interface CampanaEnRouting {
  campanaId: string;
  nombre: string;
  estado: EstadoCampana;
  /** Cuántos anuncios suyos trajeron gente en la ventana. */
  anuncios: number;
  /** Cuántas personas escribieron por ella en la ventana. */
  personas: number;
  /** La última vez que alguien llegó por esta campaña. ISO, o `null`. */
  ultima: string | null;
  /** A quién le cae. `null` = a la rueda, como siempre. */
  vendedoraId: string | null;
}

/**
 * EL ORDEN DE LA PANTALLA: primero lo que puede traer gente MAÑANA.
 *
 * Una campaña activa es una decisión que urge; una pausada ya no reparte nada y
 * está ahí para explicar de dónde salió lo que ya cayó. Dentro de cada grupo,
 * la que más gente trajo primero — y a igualdad, por nombre, para que dos
 * aperturas de la pantalla no muestren dos órdenes distintos.
 */
const PESO: Record<EstadoCampana, number> = { activa: 0, desconocido: 1, pausada: 2 };

export function ordenarCampanas(campanas: readonly CampanaEnRouting[]): CampanaEnRouting[] {
  return [...campanas].sort(
    (a, b) =>
      PESO[a.estado] - PESO[b.estado] ||
      b.personas - a.personas ||
      a.nombre.localeCompare(b.nombre, "es"),
  );
}

/**
 * A QUIÉN LE CAE UN LEAD QUE LLEGÓ POR ESTE ANUNCIO.
 *
 * 🔴 **Devuelve `null` en todos los casos dudosos, y `null` significa «que
 * decida la rueda»** — nunca «no asignar». Es la misma forma fail-open que el
 * resto del reparto: un lead que cae en la rueda está peor ruteado; un lead sin
 * dueño está perdido.
 *
 * Los tres caminos a `null`, y ninguno es un error:
 *   · el mensaje no vino de un anuncio (no hay `adId`);
 *   · el anuncio nunca se resolvió contra Meta (`campana_anuncio` no lo tiene),
 *     que es lo que pasa con un anuncio ESTRENADO HOY;
 *   · su campaña no tiene regla.
 */
export function aQuienLeCae(
  adId: string | null | undefined,
  campanaDelAnuncio: (adId: string) => string | undefined,
  duenoDeCampana: (campanaId: string) => string | undefined,
): string | null {
  const ad = (adId ?? "").trim();
  if (!ad) return null;
  const campana = campanaDelAnuncio(ad);
  if (!campana) return null;
  return duenoDeCampana(campana) ?? null;
}
