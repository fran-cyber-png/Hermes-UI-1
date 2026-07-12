import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { diasDe, rangoDe } from "../lib/rangos.js";

/**
 * Las consultas de canales, en un solo lugar.
 *
 * Vivían dentro de `routes/interactions.ts`. Se extrajeron cuando el BFF (`routes/overview.ts`)
 * necesitó los mismos números: duplicar la consulta habría sido la forma más rápida de que las
 * dos pantallas empezaran a mostrar cifras distintas del mismo dato.
 *
 * Una sola definición de "qué es pedir información" y de "qué está dentro de ventana". Si esas
 * reglas cambian, cambian en un lugar.
 */

/** Alguien pidiendo información. Es una heurística de texto, y por eso vive acá y no en el aire. */
export const PIDE_INFO = sql`texto ~* '(informaci|info\\b|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle)'`;

/**
 * Lo que TODAVÍA se puede responder en privado.
 *
 * Meta cierra la respuesta privada a un comentario a los 7 días, y da un solo intento. Fuera de
 * esa ventana no hay nada que hacer: no es trabajo pendiente, es archivo.
 */
export const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND canal = 'facebook' AND occurred_at > now() - interval '7 days')`;

export interface EstadoCanal extends Record<string, unknown> {
  canal: string;
  total: number;
  pide_info: number;
  ventana_abierta: number;
  sin_atender: number;
  comentarios: number;
  mensajes: number;
}

export interface EstadoCanales {
  interacciones: EstadoCanal[];
  formularios: { total: number; sin_atender: number };
  porDia: { dia: string; canal: string; n: number }[];
}

/** El estado de todos los canales para un rango. Solo Postgres. */
export async function estadoDeCanales(rango: string): Promise<EstadoCanales> {
  const dias = diasDe(rangoDe(rango));
  const w: SQL = dias ? sql`WHERE occurred_at > now() - (${dias} || ' days')::interval` : sql``;
  const wLeads: SQL = dias
    ? sql`WHERE created_time > now() - (${dias} || ' days')::interval`
    : sql``;

  const [interacciones, formulariosFilas, porDia] = await Promise.all([
    db.execute<EstadoCanal>(sql`
      SELECT
        canal,
        count(*)::int                                        AS total,
        count(*) FILTER (WHERE ${PIDE_INFO})::int            AS pide_info,
        count(*) FILTER (WHERE ${VENTANA_ABIERTA})::int      AS ventana_abierta,
        count(*) FILTER (WHERE status = 'nuevo')::int        AS sin_atender,
        count(*) FILTER (WHERE tipo = 'comentario')::int     AS comentarios,
        count(*) FILTER (WHERE tipo = 'mensaje')::int        AS mensajes
      FROM interactions
      ${w}
      GROUP BY 1
    `),
    db.execute<{ total: number; sin_atender: number }>(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'nuevo')::int AS sin_atender
      FROM leads ${wLeads}
    `),
    db.execute<{ dia: string; canal: string; n: number }>(sql`
      SELECT occurred_at::date::text AS dia, canal, count(*)::int AS n
      FROM interactions ${w}
      GROUP BY 1, 2 ORDER BY 1
    `),
  ]);

  return {
    interacciones: interacciones as unknown as EstadoCanal[],
    formularios: (formulariosFilas as unknown as { total: number; sin_atender: number }[])[0] ?? {
      total: 0,
      sin_atender: 0,
    },
    porDia: porDia as unknown as { dia: string; canal: string; n: number }[],
  };
}
