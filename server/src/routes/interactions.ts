import { Router } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";

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

/** Rangos que se pueden pedir. Se acotan para que nadie mande SQL por la query. */
const RANGOS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  todo: null,
};

function rangoDe(q: unknown): SQL | null {
  const dias = RANGOS[String(q ?? "30d")];
  if (dias === null || dias === undefined) return null;
  return sql`occurred_at > now() - (${String(dias)} || ' days')::interval`;
}

const where = (ws: SQL[]) => (ws.length > 0 ? sql`WHERE ${sql.join(ws, sql` AND `)}` : sql``);

interactionsRouter.get("/", async (req, res) => {
  const canal = typeof req.query.canal === "string" ? req.query.canal : "";
  const intencion = typeof req.query.intencion === "string" ? req.query.intencion : "";
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const offset = Number(req.query.offset) || 0;

  const ws: SQL[] = [];
  if (canal) ws.push(sql`canal = ${canal}`);
  if (intencion === "pide-info") ws.push(PIDE_INFO);
  if (intencion === "puedo-escribirle") ws.push(VENTANA_ABIERTA);

  const rango = rangoDe(req.query.rango);
  // "Le puedo escribir" ya implica menos de 7 días: filtrar además por rango lo
  // haría desaparecer si alguien elige un rango raro.
  if (rango && intencion !== "puedo-escribirle") ws.push(rango);

  const filas = await db.execute(sql`
    SELECT id, canal, tipo, persona_nombre, texto, contexto_texto, occurred_at, status,
           (${PIDE_INFO})       AS pide_info,
           (${VENTANA_ABIERTA}) AS ventana_abierta
    FROM interactions
    ${where(ws)}
    ORDER BY occurred_at DESC
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
  const rango = rangoDe(req.query.rango);
  const w = rango ? sql`WHERE ${rango}` : sql``;
  const wLeads = rango
    ? sql`WHERE created_time > now() - (${String(RANGOS[String(req.query.rango ?? "30d")])} || ' days')::interval`
    : sql``;

  const interacciones = await db.execute<{
    canal: string;
    total: number;
    pide_info: number;
    ventana_abierta: number;
    sin_atender: number;
  }>(sql`
    SELECT
      canal,
      count(*)::int                                   AS total,
      count(*) FILTER (WHERE ${PIDE_INFO})::int       AS pide_info,
      count(*) FILTER (WHERE ${VENTANA_ABIERTA})::int AS ventana_abierta,
      count(*) FILTER (WHERE status = 'nuevo')::int   AS sin_atender
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
