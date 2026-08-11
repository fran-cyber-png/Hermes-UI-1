import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { diasDe, rangoDe } from "../lib/rangos.js";
import { preguntoSql } from "../cola/pregunta.js";

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

/**
 * ALGUIEN PIDIENDO INFORMACIÓN — y la copia que este archivo prometía no tener.
 *
 * 🔴 Acá vivía un regex propio, y el comentario de arriba afirmaba que la regla
 * cambiaba «en un lugar». Eran dos, y la de acá estaba **rota desde el día que se
 * escribió**: decía `info\b`, y en Postgres `\b` es un backspace, no un borde de
 * palabra. Verificado contra la base viva el 11-ago-2026:
 *
 *     select 'necesito info hoy' ~* 'info\y';  -- t   (el canónico)
 *     select 'necesito info hoy' ~* 'info\b';  -- f   (esta copia)
 *
 * Esa rama nunca matcheó nada, sin error y sin log. Tampoco tenía `inversion` ni
 * `temario`, que el otro sí. No hizo daño visible porque `/api/overview` —su
 * único consumidor— no lo llama ningún componente del front; el daño era el que
 * hace toda copia dormida: el que la despierte hereda un predicado falso.
 *
 * Ahora es el predicado canónico de `cola/pregunta.ts`, el mismo que la cola, el
 * radar y `/api/interactions`.
 */
export const PIDE_INFO = preguntoSql("texto");

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
