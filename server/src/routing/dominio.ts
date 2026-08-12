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
  /**
   * LOS CABLES: a quiénes les puede caer. Vacío = a la rueda general.
   *
   * ⚠️ Es un ARREGLO y no un nombre, y por eso el orden importa poco pero la
   * estabilidad sí: viene ordenado para que dos aperturas de la pantalla no
   * dibujen los cables al revés.
   */
  vendedoras: string[];
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
 * A QUIÉNES LES PUEDE CAER UN LEAD QUE LLEGÓ POR ESTE ANUNCIO.
 *
 * 🔴 **Devuelve un CONJUNTO, y el conjunto ES una rueda.** Con un cable es
 * asignación directa; con tres, round-robin por carga entre esas tres. Por eso
 * «una o varias vendedoras» y «una rueda propia por campaña» no son dos
 * features: son esta función devolviendo uno o más nombres.
 *
 * 🔴 **Vacío significa «que decida la rueda general»** — nunca «no asignar». Es
 * la misma forma fail-open del resto del reparto: un lead mal ruteado está peor
 * atendido, un lead sin dueño está perdido.
 *
 * Los tres caminos al vacío, y ninguno es un error:
 *   · el mensaje no vino de un anuncio (no hay `adId`);
 *   · el anuncio nunca se resolvió contra Meta (`campana_anuncio` no lo tiene),
 *     que es lo que pasa con un anuncio ESTRENADO HOY;
 *   · su campaña no tiene ningún cable.
 */
export function aQuienesLesCae(
  adId: string | null | undefined,
  campanaDelAnuncio: (adId: string) => string | undefined,
  cablesDeCampana: (campanaId: string) => readonly string[] | undefined,
): string[] {
  const ad = (adId ?? "").trim();
  if (!ad) return [];
  const campana = campanaDelAnuncio(ad);
  if (!campana) return [];
  return [...(cablesDeCampana(campana) ?? [])];
}

/**
 * ¿SE PUEDE RUTEAR ESTA CAMPAÑA DESDE ESTA LÍNEA?
 *
 * Solo si alguno de sus adsets manda gente a esta línea. Medido el 12-ago-2026:
 * de 17 adsets activos, **uno** apunta a la línea que Hermes atiende — los otros
 * mandan a siete números que el CRM no ve. Ofrecer un cable ahí sería ofrecer un
 * cable que no puede llevar nada: el lead entra por otro teléfono y este server
 * nunca se entera.
 *
 * ⚠️ Se compara sobre DÍGITOS ya normalizados de los dos lados (Meta manda el
 * número con separadores y Hermes lo guarda pelado). Sin eso no matchea ninguna
 * y la pantalla diría «no hay campañas» sobre una cuenta con diecisiete vivas.
 */
export function llegaALaLinea(numerosDeLaCampana: readonly string[], linea: string): boolean {
  const l = linea.replace(/[^0-9]/g, "");
  return l !== "" && numerosDeLaCampana.some((n) => n.replace(/[^0-9]/g, "") === l);
}
