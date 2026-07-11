import { Router } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { diasDe, rangoDe } from "../lib/rangos.js";

export const interactionsRouter = Router();

/**
 * ¿Esta persona está pidiendo que la contacten?
 *
 * De 14.458 comentarios, la mayoría son "👏👏" o discusión. Los que dicen "más
 * información", "precio", "me interesa" son leads idénticos a un formulario.
 * Es una HERRAMIENTA de filtrado, no un veredicto: quien usa la plataforma
 * decide si mira todo o solo lo que pide algo. No se esconde nada.
 */
const PIDE_INFO = sql`texto ~* '(informaci|info\\b|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle)'`;

/**
 * ¿Sigue abierta la ventana para mandarle un mensaje privado?
 *
 * Meta la cierra a los 7 días del comentario. Se calcula EN SQL: fuera de la
 * ventana la respuesta es NO siempre. Preguntarle a Meta por los 14.437
 * comentarios viejos serían 14.437 llamadas para escuchar el mismo "no".
 */
const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND canal = 'facebook' AND occurred_at > now() - interval '7 days')`;

/**
 * El orden de la bandeja: urgencia real, no fecha.
 *
 * Lo urgente es a quien se le está por cerrar la ventana de 7 días. Y dentro de
 * la ventana, el MÁS VIEJO es el más urgente — es al que le quedan menos horas.
 * Ordenar por fecha descendente, que es el reflejo de cualquier feed, pondría
 * justo abajo del todo a la persona que estás por perder.
 *
 * Lo demás (ventana ya cerrada) va después, y ahí sí lo reciente primero: solo
 * se le puede responder en público, y un comentario de hace dos años no espera
 * nada.
 */
const ORDEN_URGENCIA = sql`
  ORDER BY (${VENTANA_ABIERTA}) DESC,
           CASE WHEN (${VENTANA_ABIERTA}) THEN occurred_at END ASC,
           occurred_at DESC
`;

/** El rango vive en un solo lugar (lib/rangos): el home entero obedece al mismo. */
function filtroFecha(q: unknown, columna: "occurred_at" | "created_time"): SQL | null {
  const dias = diasDe(rangoDe(q));
  if (dias === null) return null;
  const col = columna === "occurred_at" ? sql`occurred_at` : sql`created_time`;
  return sql`${col} > now() - (${String(dias)} || ' days')::interval`;
}

const where = (ws: SQL[]) => (ws.length > 0 ? sql`WHERE ${sql.join(ws, sql` AND `)}` : sql``);

interactionsRouter.get("/", async (req, res) => {
  const canal = typeof req.query.canal === "string" ? req.query.canal : "";
  const intencion = typeof req.query.intencion === "string" ? req.query.intencion : "";
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const offset = Number(req.query.offset) || 0;

  // Comentario y mensaje NO son lo mismo, y por eso se pueden separar: a un
  // comentario le respondes en público (y tienes 7 días para el privado); un
  // mensaje ya ES una conversación abierta. Cambia lo que puedes hacer.
  const tipo = req.query.tipo === "comentario" || req.query.tipo === "mensaje" ? req.query.tipo : "";

  const ws: SQL[] = [];
  if (canal) ws.push(sql`canal = ${canal}`);
  if (tipo) ws.push(sql`tipo = ${tipo}`);
  if (intencion === "pide-info") ws.push(PIDE_INFO);
  if (intencion === "puedo-escribirle") ws.push(VENTANA_ABIERTA);

  const rango = filtroFecha(req.query.rango, "occurred_at");
  // "Le puedo escribir" ya implica menos de 7 días: filtrar además por rango lo
  // haría desaparecer si alguien elige un rango raro.
  if (rango && intencion !== "puedo-escribirle") ws.push(rango);

  const filas = await db.execute(sql`
    SELECT id, canal, tipo, persona_nombre, texto, contexto_texto, occurred_at, status,
           (${PIDE_INFO})       AS pide_info,
           (${VENTANA_ABIERTA}) AS ventana_abierta,
           extract(day from now() - occurred_at)::int AS dias
    FROM interactions
    ${where(ws)}
    ${ORDEN_URGENCIA}
    LIMIT ${limit} OFFSET ${offset}
  `);

  // El total solo se cuenta en la primera página: recontar 15.000 filas en cada
  // scroll cuesta y no aporta nada.
  let total: number | undefined;
  if (offset === 0) {
    const [r] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM interactions ${where(ws)}
    `);
    total = r.n;
  }

  res.json({ interacciones: filas, total, hayMas: filas.length === limit });
});

/**
 * El estado de todos los canales, en una sola consulta.
 *
 * Incluye los formularios: para el negocio son un canal más. La diferencia
 * entre un formulario y un comentario que dice "más información" es de formato,
 * no de intención.
 */
interactionsRouter.get("/canales", async (req, res) => {
  const rango = filtroFecha(req.query.rango, "occurred_at");
  const w = rango ? sql`WHERE ${rango}` : sql``;

  const rangoLeads = filtroFecha(req.query.rango, "created_time");
  const wLeads = rangoLeads ? sql`WHERE ${rangoLeads}` : sql``;

  const interacciones = await db.execute<{
    canal: string;
    total: number;
    pide_info: number;
    ventana_abierta: number;
    sin_atender: number;
    comentarios: number;
    mensajes: number;
  }>(sql`
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
  `);

  const [formularios] = await db.execute<{ total: number; sin_atender: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'nuevo')::int AS sin_atender
    FROM leads ${wLeads}
  `);

  // Cuándo entró cada cosa, por día y por canal — para el gráfico del dashboard.
  const porDia = await db.execute<{ dia: string; canal: string; n: number }>(sql`
    SELECT occurred_at::date::text AS dia, canal, count(*)::int AS n
    FROM interactions ${w}
    GROUP BY 1, 2 ORDER BY 1
  `);

  res.json({ interacciones, formularios, porDia });
});
