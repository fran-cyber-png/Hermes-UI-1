import { z } from "zod";

/**
 * CON QUÉ SE RECORTAN 72.923 CONTACTOS — el vocabulario, puro.
 *
 * Vive separado del SQL a propósito: lo que un filtro SIGNIFICA se puede
 * interrogar sin levantar una base, y es lo único que el front y el server
 * comparten. El SQL que lo aplica es una implementación (`consultarPadron.ts`);
 * esto es el contrato.
 *
 * ── Por qué MULTIVALOR y no un valor por dimensión ──
 * Con un solo valor, «Perú **o** México» no se puede pedir: hay que mirar los dos
 * recortes por separado y repartirlos en dos tandas, y el supervisor pierde el
 * total —que es el número con el que decide—. Las dimensiones son OR adentro y
 * AND entre ellas: `pais=Perú,México` + `nivel=vip` es «peruanos o mexicanos, que
 * además sean VIP». Es la semántica que la gente ya espera de un filtro con
 * casillas, y la única con la que «seleccionar los que quiera de manera precisa»
 * se puede expresar en una sola pasada.
 *
 * ── Por qué estos y no cuarenta ──
 * `icarus.contacts` tiene 46 columnas y casi todas se pueden filtrar. Se publican
 * las que un supervisor usa para ARMAR UN LOTE que le va a dar a una persona.
 *
 * Los valores medidos en producción el 4-ago-2026 (72.923 filas) están al lado de
 * cada uno: un filtro que parte el universo en 61.324 y 7 no es un filtro, es un
 * rótulo, y conviene saberlo antes de dibujarlo.
 */

/**
 * `stage` — dónde quedó esa persona. 10 valores distintos, medidos:
 *   contacted 61.324 · delivered 5.801 · sold 4.774 · interested 666 ·
 *   new 140 · follow_up 136 · recontact 46 · resold 28 · lost 7 · client 1
 *
 * ⚠️ **La lista NO se cierra con un enum.** `stage` lo escribe icarus, que es otro
 * repo y otro equipo: un valor nuevo del otro lado no puede volverse un 400 acá.
 * Se valida que sea texto corto y se pasa; lo que no existe devuelve cero filas,
 * que es la respuesta correcta y no un error. Mismo criterio que `TIPO_IVI`
 * (ADR 0021): vocabulario publicado, schema abierto. Y por eso las opciones que
 * la pantalla ofrece **se derivan de los datos** (`facetas.ts`), no de esta lista.
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

/** Cómo se ordena. Cerrado a propósito: cada uno es una columna, no texto libre. */
export const ORDENES = ["recientes", "antiguos", "mas_gastaron", "nombre"] as const;
export type Orden = (typeof ORDENES)[number];

/**
 * El tope de una página.
 *
 * 200 no es una cifra estética: es lo que entra en una tabla que alguien va a
 * MIRAR antes de repartirla. Más que eso no se revisa, se acepta — y aceptar un
 * lote sin mirarlo es lo que la regla dura #7 existe para impedir.
 */
export const POR_PAGINA_MAX = 200;
export const POR_PAGINA_DEFAULT = 50;

/** Cuántos valores distintos admite una dimensión por request. */
const MAX_VALORES = 40;

/**
 * Una lista de valores, que llega como CSV (`pais=Perú,México`).
 *
 * ⚠️ **La coma es el separador y los valores de icarus no la usan** — verificado
 * el 4-ago sobre los 62 países, 102 cursos y 10 fuentes vivos. Si algún día un
 * valor la trae, ese filtro se parte en dos que no matchean nada: devolvería cero
 * filas, no un error. Está anotado acá porque el síntoma («ese país no filtra»)
 * no se parece en nada a la causa.
 *
 * Vacío ⇒ `undefined` (filtro ausente), nunca una lista vacía: `IN ()` no existe,
 * y un array vacío tratado como filtro devolvería cero filas — o sea, «ningún
 * país» en vez de «cualquier país», que es lo contrario de lo que se pidió.
 */
const listaDeTextos = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => {
    const crudos = Array.isArray(v) ? v : v.split(",");
    const limpios = [...new Set(crudos.map((s) => s.trim()).filter((s) => s !== ""))];
    return limpios.length === 0 ? undefined : limpios;
  })
  .pipe(z.array(z.string().max(160)).min(1).max(MAX_VALORES).optional())
  .optional();

/** Un texto suelto: corto, recortado, y vacío se lee como ausente. */
const textoCorto = z
  .string()
  .trim()
  .max(120)
  .transform((s) => (s === "" ? undefined : s))
  .optional();

export const filtrosSchema = z.object({
  /** Busca en nombre, correo, teléfono y DNI a la vez. */
  q: textoCorto,

  // Las cinco dimensiones multivalor. OR adentro, AND entre ellas.
  etapa: listaDeTextos,
  nivel: listaDeTextos,
  /** ⚠️ El país de icarus es el NOMBRE COMPLETO («Perú», «México»), no ISO-2. */
  pais: listaDeTextos,
  /** Coincidencia EXACTA contra `last_course` o `course` (las opciones salen de los datos). */
  curso: listaDeTextos,
  fuente: listaDeTextos,

  /**
   * ⚠️ **«Compró» se pregunta contra `icarus.sales`, NO contra `n_purchases`.**
   *
   * Medido el 4-ago-2026: 10.564 contactos dicen `n_purchases > 0` y solo **4.783**
   * tienen una fila de venta que lo respalde. El contador lo copió verbatim el
   * import de `leads_crm` y nadie lo recalculó (mismo hallazgo que #133).
   *
   * O sea: filtrar por el contador le daría al supervisor un lote donde **más de
   * la mitad de los «clientes» nunca compró nada**, y la vendedora abriría la
   * conversación saludando por una compra que no existe.
   */
  conVenta: z.coerce.boolean().optional(),

  /** Solo contactables. 71.341 de 72.923 tienen teléfono usable. */
  conTelefono: z.coerce.boolean().optional(),

  /**
   * Los que todavía no le tocaron a nadie. Sin él, repartir la tanda 12 obliga a
   * recordar dónde terminó la 11, y el precio de olvidarse es que dos personas le
   * escriban al mismo contacto.
   */
  sinHabilitar: z.coerce.boolean().optional(),

  orden: z.enum(ORDENES).default("recientes"),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  porPagina: z.coerce.number().int().min(1).max(POR_PAGINA_MAX).default(POR_PAGINA_DEFAULT),
});

export type Filtros = z.infer<typeof filtrosSchema>;

/** Las dimensiones que tienen facetas. El orden es el de la pantalla. */
export const DIMENSIONES = ["pais", "curso", "etapa", "nivel", "fuente"] as const;
export type Dimension = (typeof DIMENSIONES)[number];

/**
 * ¿Este recorte deja mirar el lote antes de repartirlo?
 *
 * Un supervisor que no filtra nada y selecciona todo está por asignar 72.923
 * contactos de un clic. La respuesta no es prohibirlo —es su decisión— sino que
 * la pantalla lo diga con el número delante (regla dura #7). Esto devuelve el
 * dato para ese aviso; no bloquea nada.
 */
export function esLoteCiego(total: number, porPagina: number): boolean {
  return total > porPagina;
}

/** Cuántas dimensiones están recortando ahora — para el contador de «filtros activos». */
export function filtrosActivos(f: Filtros): number {
  let n = 0;
  for (const d of DIMENSIONES) n += f[d]?.length ?? 0;
  if (f.q) n += 1;
  if (f.conVenta) n += 1;
  if (f.conTelefono) n += 1;
  if (f.sinHabilitar) n += 1;
  return n;
}
