import { z } from "zod";

/**
 * CON QUÉ SE RECORTAN 72.923 CONTACTOS — el vocabulario, puro.
 *
 * Vive separado del SQL a propósito: lo que un filtro SIGNIFICA se puede
 * interrogar sin levantar una base, y es lo único que el front y el server
 * comparten. El SQL que lo aplica es una implementación (`consultarPadron.ts`);
 * esto es el contrato.
 *
 * ── Por qué estos y no cuarenta ──
 * `icarus.contacts` tiene 46 columnas y casi todas se pueden filtrar. Se
 * publican las que un supervisor usa para ARMAR UN LOTE que le va a dar a una
 * persona, que es la única pregunta que esta pantalla responde. Las demás se
 * pueden mirar en la ficha; ninguna arma un lote.
 *
 * Los valores medidos en producción el 4-ago-2026 (72.923 filas) están al lado
 * de cada uno: un filtro que parte el universo en 61.324 y 7 no es un filtro,
 * es un rótulo, y conviene saberlo antes de dibujarlo.
 */

/**
 * `stage` — dónde quedó esa persona. Medido:
 *   contacted 61.324 · delivered 5.801 · sold 4.774 · interested 666 ·
 *   new 140 · follow_up 136 · recontact 46 · resold 28 · lost 7 · client 1
 *
 * ⚠️ **La lista NO se cierra con un enum.** `stage` lo escribe icarus, que es
 * otro repo y otro equipo: un valor nuevo del otro lado no puede volverse un 400
 * acá. Se valida que sea un texto corto y se pasa; lo que no existe devuelve
 * cero filas, que es la respuesta correcta y no un error. Es el mismo criterio
 * que `TIPO_IVI` (ADR 0021): vocabulario publicado, schema abierto.
 */
export const ETAPAS_CONOCIDAS = [
  "new",
  "contacted",
  "interested",
  "follow_up",
  "recontact",
  "delivered",
  "sold",
  "resold",
  "lost",
  "client",
] as const;

/** `buyer_tier` — prospect 39.306 · single 6.784 · repeat 2.544 · vip 460 · sin dato 23.829. */
export const NIVELES_CONOCIDOS = ["prospect", "single", "repeat", "vip"] as const;

/** Cómo se ordena. Cerrado a propósito: cada uno es una columna con índice o un orden estable. */
export const ORDENES = ["recientes", "antiguos", "mas_gastaron", "nombre"] as const;
export type Orden = (typeof ORDENES)[number];

/**
 * El tope de una página.
 *
 * 200 no es una cifra estética: es lo que entra en una tabla que alguien va a
 * MIRAR antes de repartirla. Más que eso no se revisa, se acepta — y aceptar un
 * lote sin mirarlo es exactamente lo que la regla dura #7 («todo envío masivo
 * con la lista de destinatarios a la vista») existe para impedir.
 */
export const POR_PAGINA_MAX = 200;
export const POR_PAGINA_DEFAULT = 50;

/** Un texto de filtro: corto, recortado, y vacío se lee como ausente. */
const textoCorto = z
  .string()
  .trim()
  .max(120)
  .transform((s) => (s === "" ? undefined : s))
  .optional();

export const filtrosSchema = z.object({
  /** Busca en nombre, correo, teléfono y DNI a la vez. */
  q: textoCorto,
  etapa: textoCorto,
  nivel: textoCorto,
  /** Código ISO de país tal como lo guarda icarus (`PE`, `MX`, `EC`…). */
  pais: textoCorto,
  /** Coincidencia parcial contra `course` y `last_course`. */
  curso: textoCorto,
  /** `source` — de dónde salió el contacto. */
  fuente: textoCorto,

  /**
   * ⚠️ **«Compró» se pregunta contra `icarus.sales`, NO contra `n_purchases`.**
   *
   * Medido el 4-ago-2026: 10.564 contactos dicen `n_purchases > 0` y solo
   * **4.783** tienen una fila de venta que lo respalde. El contador lo copió
   * verbatim el import de `leads_crm` y nadie lo recalculó (mismo hallazgo que
   * el padrón de ex-clientes, #133).
   *
   * O sea: filtrar por el contador le daría al supervisor un lote donde **más de
   * la mitad de los «clientes» nunca compró nada**, y la vendedora abriría la
   * conversación saludando a alguien por una compra que no existe. El EXISTS
   * cuesta un índice y saca ese error de la pantalla.
   */
  conVenta: z.coerce.boolean().optional(),

  /**
   * Solo los que se pueden contactar. 71.341 de 72.923 tienen teléfono usable;
   * los 1.582 restantes son ruido en un lote de prospección.
   */
  conTelefono: z.coerce.boolean().optional(),

  /**
   * Los que todavía no le tocaron a nadie — el filtro que hace usable la
   * pantalla del supervisor. Sin él, repartir la tanda 12 obliga a recordar
   * dónde terminó la 11, y el precio de olvidarse es que dos personas le
   * escriban al mismo contacto.
   */
  sinHabilitar: z.coerce.boolean().optional(),

  /** Lo habilitado a una vendedora en particular (el supervisor audita un lote). */
  habilitadoA: textoCorto,

  orden: z.enum(ORDENES).default("recientes"),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  porPagina: z.coerce.number().int().min(1).max(POR_PAGINA_MAX).default(POR_PAGINA_DEFAULT),
});

export type Filtros = z.infer<typeof filtrosSchema>;

/**
 * ¿Este recorte deja mirar el lote antes de repartirlo?
 *
 * Un supervisor que filtra nada y selecciona todo está por asignar 72.923
 * contactos de un clic. La respuesta no es prohibirlo —es su decisión— sino que
 * la pantalla lo diga con el número delante, que es lo que pide la regla dura #7.
 * Esto devuelve el dato para ese aviso; no bloquea nada.
 */
export function esLoteCiego(total: number, porPagina: number): boolean {
  return total > porPagina;
}
