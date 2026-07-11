/**
 * El rango de fechas del dashboard. UNA sola definición, para todos.
 *
 * Existe porque el home entero obedece a las mismas pastillas de fecha: lo que
 * entró, cuándo entró, y cuánto costó traerlo. Si cada endpoint interpretara
 * "90 días" a su manera, la pantalla volvería a contradecirse — que es
 * exactamente el problema que veníamos arrastrando.
 *
 * Se acota a propósito: nadie manda SQL ni fechas arbitrarias por la query.
 */
export type Rango = "7d" | "30d" | "90d" | "1y" | "todo";

const DIAS: Record<Rango, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  todo: null, // sin límite
};

export function rangoDe(q: unknown): Rango {
  const r = String(q ?? "todo");
  return r in DIAS ? (r as Rango) : "todo";
}

/** Días hacia atrás, o null si es "todo". */
export function diasDe(rango: Rango): number | null {
  return DIAS[rango];
}

/**
 * El rango traducido a lo que entiende Meta.
 *
 * Meta no tiene un preset de "últimos 365 días" (su `last_year` es el año
 * calendario anterior, que no es lo mismo). Así que para todo lo que no sea
 * "todo" se manda un `time_range` con fechas exactas, y se deja `date_preset`
 * solo para el histórico completo.
 */
export function paraMeta(rango: Rango): { date_preset: string } | { time_range: string } {
  const dias = diasDe(rango);
  if (dias === null) return { date_preset: "maximum" };

  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return { time_range: JSON.stringify({ since: iso(desde), until: iso(hasta) }) };
}
