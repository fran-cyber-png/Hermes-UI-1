/**
 * LOS ESTADOS DE UNA VENTA — la fuente única.
 *
 * Esto es lo que `lazo/evento.ts:62` viene pidiendo desde siempre con `Ver ESTADOS_COMPRA`:
 * un símbolo que nunca se escribió. Hasta hoy la verdad vivía repartida en cuatro lugares que
 * no se hablaban entre sí:
 *
 *   · ontologia/proyectar.ts:53   `semanticoVenta()` — el mapa a semántica
 *   · lazo/evento.ts:53-58        `NUNCA_FUE_COMPRA` / `SE_ARREPINTIO` — qué se le manda a Meta
 *   · db/canonico.ts:92-96        el mismo mapa, en un comentario
 *   · docs/02-CERBERUS.md:56      los nombres de Cerberus
 *
 * Es exactamente el patrón que `db/canonico.ts:4-21` documenta como causa de un bug real: la
 * lógica "venta → USD" divergió entre dos lugares y se perdieron 2.306 ventas en silencio. Este
 * mapa decide qué ventas ve Meta. Si diverge, el negocio deja de existir para el algoritmo.
 *
 * ── POR QUÉ ESTE MÓDULO NO CONFÍA EN LA DOCUMENTACIÓN ──
 * Los tres textos que describían estos estados se contradecían, así que se le preguntó a los
 * datos. Contra el espejo de Cerberus (6.727 ventas, 2024-01-06 → 2026-07-12):
 *
 *   estado 1 → 6.448    estado 5 →     3
 *   estado 2 →   126    estado 6 →     2
 *   estado 3 →    22    estado 7 →    95
 *   estado 4 →    13    estado 8 →    18
 *
 * Tres cosas que ninguna de las fuentes tenía bien:
 *
 *  1. **Son OCHO estados, no siete.** `docs/02-CERBERUS.md:56` enumera 1..7 y omite el 8
 *     (Reembolsado), que tiene 18 ventas reales entre 2025-12-01 y 2026-04-14.
 *
 *  2. **El estado 9 NO EXISTE.** `proyectar.ts:54` (`estado === 1 || estado === 9`) y
 *     `canonico.ts:92` ("9 Pagado por crédito") lo manejan, pero cero ventas lo tienen. Se sigue
 *     mapeando por defensa —quitarlo rompería el día que aparezca— pero queda marcado como no
 *     observado, para que nadie lo cite como un hecho.
 *
 *  3. **El código se corroboró a sí mismo.** `lazo/evento.ts:56` afirma que retirados +
 *     reembolsados son "el 1,6% de las ventas". Medido: (95 + 18) / 6.727 = 1,68%. Ese comentario
 *     no era una estimación: era verdad.
 *
 * Los conteos de arriba son de una fecha y envejecen. Por eso la Tool `governa.ventas.estados()`
 * los vuelve a contar en vivo contra el espejo en cada llamada, en vez de repetir este comentario.
 * Acá vive el MAPA, que es estable; allá vive la EVIDENCIA, que no.
 */

/**
 * La semántica de negocio, que es lo que el resto del sistema realmente pregunta. El número de
 * Cerberus es un detalle de implementación de Cerberus; esto es lo que significa.
 */
export type SemanticaVenta = "cobrada" | "en_proceso" | "anulada" | "reembolsada" | "otro";

export type EstadoVenta = {
  /** El entero que guarda Cerberus en `tb_venta.estado`. */
  codigo: number;
  /** El nombre de Cerberus. Fuente: `docs/02-CERBERUS.md:56`, salvo el 8 y el 9 (ver abajo). */
  nombre: string;
  semantica: SemanticaVenta;
  /**
   * ¿Se vio alguna vez en el espejo de Cerberus?
   *
   * `false` no significa "imposible": significa "nadie lo observó todavía". La diferencia importa
   * — este proyecto ya se dio la regla de que "no se midió" y "es cero" no pueden verse igual
   * (`canales/verdad.ts:41-47`).
   */
  observado: boolean;
};

/**
 * EL MAPA. Ordenado por código.
 *
 * El 8 no está en la documentación de Cerberus pero sí en los datos y en `lazo/evento.ts:57`.
 * El 9 está en el código (`proyectar.ts:54`, `canonico.ts:92`) pero no en los datos ni en la doc.
 */
export const ESTADOS_COMPRA: readonly EstadoVenta[] = [
  { codigo: 1, nombre: "Pagado", semantica: "cobrada", observado: true },
  { codigo: 2, nombre: "Pendiente", semantica: "en_proceso", observado: true },
  { codigo: 3, nombre: "No Validado", semantica: "otro", observado: true },
  { codigo: 4, nombre: "Anulado", semantica: "anulada", observado: true },
  { codigo: 5, nombre: "Cotización", semantica: "anulada", observado: true },
  { codigo: 6, nombre: "Preventa", semantica: "otro", observado: true },
  { codigo: 7, nombre: "Retirado", semantica: "reembolsada", observado: true },
  { codigo: 8, nombre: "Reembolsado", semantica: "reembolsada", observado: true },
  // No observado. Se mapea por defensa, no porque se sepa que existe.
  { codigo: 9, nombre: "Pagado por crédito", semantica: "cobrada", observado: false },
] as const;

const POR_CODIGO = new Map(ESTADOS_COMPRA.map((e) => [e.codigo, e]));

/** El estado, o `null` si Cerberus mandó un código que nadie modeló. */
export function estadoDe(codigo: number | null): EstadoVenta | null {
  return codigo == null ? null : (POR_CODIGO.get(codigo) ?? null);
}

/**
 * La semántica de un código. Un código desconocido cae en `"otro"`, no revienta: Cerberus es un
 * sistema vivo y puede agregar un estado mañana sin avisarnos. Preferimos clasificarlo como
 * desconocido antes que perder la venta entera.
 */
export function semanticaDe(codigo: number | null): SemanticaVenta {
  return estadoDe(codigo)?.semantica ?? "otro";
}

/** ¿Cuenta como venta real? Es el filtro más usado del sistema (`canonico.ts:99`). */
export function esCobrada(codigo: number | null): boolean {
  return semanticaDe(codigo) === "cobrada";
}

/**
 * NUNCA FUE UNA COMPRA — anulada (4) o solo una cotización (5).
 *
 * No hubo intención de comprar, así que no hay nada que contarle a Meta.
 */
export const NUNCA_FUE_COMPRA: ReadonlySet<number> = new Set(
  ESTADOS_COMPRA.filter((e) => e.semantica === "anulada").map((e) => e.codigo),
);

/**
 * COMPRÓ Y SE ARREPINTIÓ — retirada (7) o reembolsada (8). El 1,68% de las ventas.
 *
 * Meta no tiene forma limpia de retractar un `Purchase` ya enviado, así que la única defensa es
 * no mandarlo. Ver `lazo/evento.ts:50-52`.
 */
export const SE_ARREPINTIO: ReadonlySet<number> = new Set(
  ESTADOS_COMPRA.filter((e) => e.semantica === "reembolsada").map((e) => e.codigo),
);
