import { inArray } from "drizzle-orm";
import type { db } from "../db/client.js";
import { intereses } from "../db/schema.js";
import { consultarInteresesDerivados } from "../cursos/consultarDerivados.js";
import type { InteresDerivado } from "../cursos/derivar.js";
import type { AliasCurso } from "../cursos/alias.js";

/**
 * LA LÍNEA DE TIEMPO DEL INTERÉS (#57) — el server.
 *
 * Un contacto que un día pregunta por un curso y a la semana por otro es un
 * perfil que se construye EN EL TIEMPO, no un estado que se pisa. El dato ya
 * estaba (`intereses.creadoAt`); faltaba EXPONERLO con fecha y en orden.
 *
 * Cambio RETROCOMPATIBLE: la forma vieja `intereses` (clave → string[]) se
 * mantiene intacta —lo que el front viejo (o un caché persistido) espera— y se
 * SUMA `interesesDetalle` con la fecha de cada interés. Nadie que lea la vieja
 * se rompe; quien quiera la línea de tiempo lee la nueva.
 */

export interface FilaInteres {
  clave: string;
  curso: string;
  /** timestamptz de Drizzle (Date) o su ISO — se normaliza a ISO en la salida. */
  creadoAt: Date | string;
}

export interface InteresConFecha {
  curso: string;
  creadoAt: string;
}

export interface PayloadIntereses {
  /** RETROCOMPAT: la forma vieja (clave → cursos), ahora en orden cronológico. */
  intereses: Record<string, string[]>;
  /** NUEVO: cada interés con su fecha, para pintar la línea de tiempo (#57). */
  interesesDetalle: Record<string, InteresConFecha[]>;
  /**
   * LA PROPUESTA (#102): el curso que se deduce del anuncio o del formulario,
   * para las conversaciones que todavía NO tienen ninguno asentado. No es un
   * interés: es lo que la ficha muestra marcado «del anuncio» con un botón para
   * confirmarlo. Una clave ausente = nada que proponer.
   */
  derivados: Record<string, InteresDerivado>;
}

/**
 * Da forma al payload a partir de las filas crudas. PURO (sin base) para testear
 * el orden y la retrocompat sin Postgres. Ordena cronológicamente (el más viejo
 * primero: la línea de tiempo se lee de izquierda a derecha) y agrupa por
 * conversación.
 */
export function armarPayloadIntereses(
  filas: readonly FilaInteres[],
  derivados: Record<string, InteresDerivado> = {},
): PayloadIntereses {
  const orden = [...filas].sort(
    (a, b) => new Date(a.creadoAt).getTime() - new Date(b.creadoAt).getTime(),
  );
  const planos: Record<string, string[]> = {};
  const detalle: Record<string, InteresConFecha[]> = {};
  for (const f of orden) {
    (planos[f.clave] ??= []).push(f.curso);
    (detalle[f.clave] ??= []).push({
      curso: f.curso,
      creadoAt: new Date(f.creadoAt).toISOString(),
    });
  }
  return { intereses: planos, interesesDetalle: detalle, derivados };
}

/**
 * SEAM (#33): consulta los intereses de una o todas las claves, ORDENADOS por
 * fecha en el SQL, y arma el payload. La ruta le pasa el singleton; el test su
 * base de prueba. El `armarPayloadIntereses` reordena igual, así que el resultado
 * es determinista aunque el planner devuelva las filas en otro orden.
 */
export async function consultarIntereses(
  base: typeof db,
  claves: readonly string[],
  /** Los alias del derivado. Por defecto, los activos de la tabla (el test le pasa los suyos). */
  aliases?: readonly AliasCurso[],
): Promise<PayloadIntereses> {
  const filas = claves.length
    ? await base
        .select()
        .from(intereses)
        .where(inArray(intereses.clave, [...claves]))
        .orderBy(intereses.creadoAt)
    : await base.select().from(intereses).orderBy(intereses.creadoAt);
  const payload = armarPayloadIntereses(filas);

  // La propuesta se calcula SOLO cuando se preguntó por conversaciones
  // concretas. Sin claves, esto es «traeme todos los intereses de la base»
  // (retrocompat) y derivar ahí sería cruzar la base entera contra `leads` para
  // una pantalla que ni lo pide.
  if (claves.length === 0) return payload;

  return {
    ...payload,
    derivados: await consultarInteresesDerivados(base, {
      claves,
      registradosPorClave: payload.intereses,
      aliases,
    }),
  };
}
