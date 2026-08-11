/**
 * POR QUÉ FALLÓ, EN UNA LÍNEA — para los `catch` que hoy loguean `err.message`.
 *
 * 🔴 **`err.message` de una consulta de drizzle NO dice por qué falló: dice el
 * SQL.** postgres.js arma el mensaje como `Failed query:\n<el SQL entero>\nparams:
 * …` y guarda la causa real —`relation "x" does not exist`, un timeout, la
 * conexión cortada— adentro de `err.cause`. Medido en producción el 11-ago-2026:
 * el webhook de WhatsApp escupió **96 «no se pudo aplicar el recibo» en una
 * hora**, cada uno con veinte líneas de SQL, y **ninguno decía qué había pasado**.
 * Hubo que reproducir la consulta a mano para descartar que fuera un bug suyo.
 *
 * Devuelve la causa primero y el SQL recortado después: lo que se busca al leer
 * un log es qué se rompió, y recién entonces dónde.
 */
export function porQueFallo(err: unknown): string {
  const e = err as { message?: unknown; cause?: unknown } | null;
  const causa = (e?.cause as { message?: unknown } | undefined)?.message;
  const propio = typeof e?.message === "string" ? e.message : String(err);

  // Sin causa anidada el mensaje propio ya es la explicación (un `throw new
  // Error("...")` nuestro, por ejemplo): se devuelve tal cual, en una línea.
  if (typeof causa !== "string" || !causa.trim()) return unaLinea(propio, 300);

  return `${unaLinea(causa, 200)} · consulta: ${unaLinea(propio.replace(/^Failed query:/, ""), 160)}`;
}

/** Un log de varias líneas se pierde entre las demás: journald las intercala. */
function unaLinea(texto: string, tope: number): string {
  const plano = texto.replace(/\s+/g, " ").trim();
  return plano.length > tope ? `${plano.slice(0, tope)}…` : plano;
}
