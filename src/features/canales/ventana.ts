/**
 * CÓMO SE DIBUJA LA VENTANA DE CONVERSACIÓN — puro, fuera del JSX.
 *
 * El server manda el INSTANTE del cierre (`ventana_cierra`, de `cola/ventana.ts`)
 * y acá se decide qué se lee. Vive afuera del componente por el motivo de
 * siempre: un `if` adentro del JSX no se puede interrogar sobre el caso que
 * todavía no pasó —el minuto antes del cierre, el server viejo que no manda el
 * campo— y esos son justo los que importan.
 *
 * ── LA SEÑAL ES POSITIVA, Y ESO DECIDE EL DISEÑO ──────────────────────────
 * Una ventana CERRADA no dibuja nada. No es un olvido: el plazo es duro solo en
 * la línea de la Cloud API; en las tres líneas whatsmeow de las vendedoras Meta
 * no rechaza nada. Una píldora que dijera «cerrada» sería falsa en tres de
 * cuatro líneas, y lo que se pierde con esa mentira es una venta que nadie
 * intenta. Se dice a quién SÍ se le puede hablar, nunca a quién no.
 *
 * ── EL ORO ────────────────────────────────────────────────────────────────
 * Acá el oro SÍ corresponde, y es de los pocos lugares: en esta app significa
 * **tiempo que se acaba** y nada más (`src/index.css`). Una ventana con menos de
 * `UMBRAL_ORO_MS` es exactamente eso. Arriba de ese umbral va en tinta neutra —
 * si todo lo abierto fuera dorado, el oro dejaría de querer decir «ahora».
 */

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** Debajo de esto la ventana se dibuja en oro: queda menos de una mañana. */
export const UMBRAL_ORO_MS = 3 * HORA;

export interface LecturaVentana {
  /** Lo que se lee en la píldora: «45 min», «6 h», «3 d». */
  texto: string;
  /** Queda poco: se pinta en oro. */
  urgente: boolean;
  /** El texto largo del `title`, que es donde se explica el plazo. */
  ayuda: string;
}

/**
 * Cuánto falta, en criollo. **Redondea para ABAJO** a propósito: con 6 h 50 min
 * dice «6 h». Un redondeo para arriba prometería tiempo que no hay, y el error
 * que importa acá es el que llega tarde. Nunca dice «0 min» — el último minuto
 * sigue siendo un minuto.
 */
export function cuantoFalta(ms: number): string {
  if (ms >= DIA) return `${Math.floor(ms / DIA)} d`;
  if (ms >= HORA) return `${Math.floor(ms / HORA)} h`;
  return `${Math.max(1, Math.floor(ms / MINUTO))} min`;
}

/**
 * QUÉ DICE LA PÍLDORA, o `null` si no se dibuja nada.
 *
 * `null` en los tres casos que se ven igual en pantalla y son distintos abajo, y
 * está bien que se vean igual: **la ausencia de señal no afirma nada**.
 *   · la ventana está cerrada (se dice a quién sí, no a quién no);
 *   · esta conversación no tiene ventana (un comentario de un canal sin plazo);
 *   · el server no manda el campo todavía (N4 va solo, N5 es un botón: hay una
 *     ventana de deploy donde el front nuevo habla con el server viejo).
 */
export function lecturaDeVentana(
  ventanaCierra: string | null | undefined,
  ahora: Date,
): LecturaVentana | null {
  if (!ventanaCierra) return null;

  const cierra = new Date(ventanaCierra).getTime();
  // Una fecha que no se puede leer no inventa una cuenta regresiva.
  if (Number.isNaN(cierra)) return null;

  const falta = cierra - ahora.getTime();
  if (falta <= 0) return null;

  return {
    texto: cuantoFalta(falta),
    urgente: falta < UMBRAL_ORO_MS,
    ayuda: `Se le puede escribir: la ventana cierra en ${cuantoFalta(falta)}`,
  };
}
