import { and, desc, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { botRespuestas } from "../db/bot.js";
import { interactions } from "../db/schema.js";

/**
 * LO QUE EL BOT NO SUPO CONTESTAR (#261).
 *
 * ══ EL DATO YA EXISTÍA Y NADIE LO MIRABA ═════════════════════════════════════
 *
 * El bot escala con motivo `sin_respuesta_en_catalogo` cada vez que le preguntan
 * algo que no tiene. Es un detector de agujeros del catálogo que viene
 * funcionando solo, y sus tres hallazgos estaban en la base sin que ninguna
 * pantalla los mostrara:
 *
 *   · «Ya me habían mandado información»  → falta el calendario de inicios
 *   · «La primera conferencia internacional» → un producto que no está
 *   · «Horarios del curso. PRESENCIAL»    → acá SÍ supo, y escaló igual
 *
 * El tercero es de otra clase y por eso se distingue: «no supo» es un hueco del
 * catálogo, «supo y escaló igual» es un defecto del criterio de escalada.
 * Mezclarlos haría que alguien cargue un dato que ya estaba.
 *
 * ══ EL SQL TRAE HECHOS CRUDOS ════════════════════════════════════════════════
 *
 * Sin `CASE`, sin umbrales: la clasificación es pura y vive abajo. Es la forma
 * de `consultarRadar` / `consultarSenales` / `consultarResultados`, y existe para
 * que no haya una segunda implementación que pueda divergir (la lección de #37).
 */

export interface AgujeroCrudo {
  clave: string;
  /** Lo que la persona preguntó y el bot no supo. */
  pregunta: string | null;
  /** Lo que el bot alcanzó a contestar antes de escalar. */
  respuesta: string | null;
  cuando: Date;
}

export type ClaseDeAgujero = "no_supo" | "supo_y_escalo";

export interface Agujero extends AgujeroCrudo {
  clase: ClaseDeAgujero;
  lectura: string;
}

/**
 * ¿Es un hueco del catálogo o un defecto del criterio de escalada?
 *
 * Pura. La señal es si el bot **llegó a afirmar algo** antes de escalar: cuando
 * de verdad no sabe, su respuesta se queda en acusar recibo («entiendo que te
 * interesa…»); cuando sí sabía, contesta y escala igual.
 *
 * Es una heurística y se dice: por eso la pantalla muestra la pregunta y la
 * respuesta al lado, para que la clasificación se pueda discutir en vez de
 * creerle.
 */
export function clasificarAgujero(a: AgujeroCrudo): Agujero {
  const r = (a.respuesta ?? "").toLowerCase();
  const soloAcusaRecibo =
    r === "" ||
    /(entiendo que|ese dato|no lo tengo|d[eé]jame (revisar|consultar)|te confirmo)/.test(r);

  return {
    ...a,
    clase: soloAcusaRecibo ? "no_supo" : "supo_y_escalo",
    lectura: soloAcusaRecibo
      ? "No tenía el dato: falta en el catálogo"
      : "Contestó y escaló igual: el que sobra es el escalado, no el dato",
  };
}

/** Las escaladas por `sin_respuesta_en_catalogo`, con lo que se preguntó. */
export async function consultarAgujeros(
  base: typeof Base,
  numeroPropio: string,
  limite = 50,
): Promise<Agujero[]> {
  const filas = await base
    .select({
      clave: botRespuestas.clave,
      respuesta: botRespuestas.texto,
      cuando: botRespuestas.creadoEn,
      // Lo último que la persona escribió ANTES de que el bot escalara. Es la
      // pregunta que se quedó sin responder, y sin ella el agujero no se puede
      // tapar: «faltó un dato» no dice cuál.
      pregunta: sql<string | null>`(
        SELECT i.texto FROM ${interactions} i
        WHERE i.persona_id = split_part(${botRespuestas.clave}, ':', 3)
          AND i.numero_propio = ${botRespuestas.numeroPropio}
          AND i.direccion = 'entrante'
          AND i.occurred_at <= ${botRespuestas.creadoEn}
        ORDER BY i.occurred_at DESC LIMIT 1
      )`,
    })
    .from(botRespuestas)
    .where(
      and(
        eq(botRespuestas.numeroPropio, numeroPropio),
        sql`${botRespuestas.acciones} @> '[{"motivo":"sin_respuesta_en_catalogo"}]'::jsonb`,
      ),
    )
    .orderBy(desc(botRespuestas.creadoEn))
    .limit(limite);

  return filas.map((f) => clasificarAgujero(f));
}
