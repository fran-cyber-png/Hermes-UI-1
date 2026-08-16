import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { diasDe, rangoDe } from "../lib/rangos.js";
import { preguntoSql } from "../cola/pregunta.js";

/**
 * LAS CONSULTAS DE LA BANDEJA DE INTERACCIONES — el seam que `routes/interactions.ts` consulta.
 *
 * Extraído del router (mismo movimiento que `consultarRadar` con `routes/dashboard.ts`):
 * recibe `db` INYECTADO — la ruta le pasa el singleton, el test su base de prueba
 * (harness #33, ADR 0008). El router se queda con lo que es HTTP: leer la query,
 * acotar el lote y serializar; acá vive todo el SQL.
 *
 * Es una MUDANZA: el texto de cada consulta, sus parámetros y su orden son los
 * mismos que tenía el router. Nada se optimizó de paso.
 */

/**
 * ¿Esta persona está pidiendo que la contacten?
 *
 * De 14.458 comentarios, la mayoría son "👏👏" o discusión. Los que dicen "más
 * información", "precio", "me interesa" son leads idénticos a un formulario.
 * Es una HERRAMIENTA de filtrado, no un veredicto: quien usa la plataforma
 * decide si mira todo o solo lo que pide algo. No se esconde nada.
 *
 * El predicado vive una sola vez en `cola/pregunta.ts` — antes esta era una de
 * tres copias que habían divergido, y la que quedó rota (`info\b`) nunca
 * matcheó nada en Postgres.
 */
const PIDE_INFO = preguntoSql("texto");

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

/**
 * Qué recorta la bandeja. Los cuatro primeros llegan YA acotados por el router
 * (cadena vacía = "sin filtro"); `rango` viaja CRUDO desde la query porque quien
 * lo acota es `rangoDe` (lib/rangos), que acepta cualquier cosa y cae en "todo".
 */
export interface OpcionesInteracciones {
  canal: string;
  tipo: string;
  intencion: string;
  limit: number;
  offset: number;
  rango: unknown;
}

/** Una fila de la bandeja, como la devuelve Postgres.
 *  Es un type (no interface) a propósito: `db.execute<T>` exige la index
 *  signature implícita que las interfaces no tienen. */
export type FilaInteraccion = {
  id: number;
  canal: string;
  tipo: string;
  persona_nombre: string | null;
  texto: string | null;
  contexto_texto: string | null;
  occurred_at: Date;
  status: string;
  pide_info: boolean;
  ventana_abierta: boolean;
  dias: number;
};

/**
 * La página de la bandeja, con su total. `total` es `undefined` fuera de la
 * primera página — no es cero: es "no se contó".
 */
export async function consultarInteracciones(
  base: typeof db,
  o: OpcionesInteracciones,
): Promise<{ filas: FilaInteraccion[]; total: number | undefined }> {
  const ws: SQL[] = [];
  if (o.canal) ws.push(sql`canal = ${o.canal}`);
  if (o.tipo) ws.push(sql`tipo = ${o.tipo}`);
  if (o.intencion === "pide-info") ws.push(PIDE_INFO);
  if (o.intencion === "puedo-escribirle") ws.push(VENTANA_ABIERTA);

  const rango = filtroFecha(o.rango, "occurred_at");
  // "Le puedo escribir" ya implica menos de 7 días: filtrar además por rango lo
  // haría desaparecer si alguien elige un rango raro.
  if (rango && o.intencion !== "puedo-escribirle") ws.push(rango);

  const filas = await base.execute<FilaInteraccion>(sql`
    SELECT id, canal, tipo, persona_nombre, texto, contexto_texto, occurred_at, status,
           (${PIDE_INFO})       AS pide_info,
           (${VENTANA_ABIERTA}) AS ventana_abierta,
           extract(day from now() - occurred_at)::int AS dias
    FROM interactions
    ${where(ws)}
    ${ORDEN_URGENCIA}
    LIMIT ${o.limit} OFFSET ${o.offset}
  `);

  // El total solo se cuenta en la primera página: recontar 15.000 filas en cada
  // scroll cuesta y no aporta nada.
  let total: number | undefined;
  if (o.offset === 0) {
    const [r] = await base.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM interactions ${where(ws)}
    `);
    total = r.n;
  }

  return { filas, total };
}

export type FilaCanal = {
  canal: string;
  total: number;
  pide_info: number;
  ventana_abierta: number;
  sin_atender: number;
  comentarios: number;
  mensajes: number;
};

export type FilaFormularios = { total: number; sin_atender: number };

export type FilaPorDia = { dia: string; canal: string; n: number };

/**
 * El estado de todos los canales para un rango, en las tres consultas que la
 * pantalla necesita.
 */
export async function consultarEstadoDeCanales(
  base: typeof db,
  rangoCrudo: unknown,
): Promise<{
  interacciones: FilaCanal[];
  formularios: FilaFormularios;
  porDia: FilaPorDia[];
}> {
  const rango = filtroFecha(rangoCrudo, "occurred_at");
  const w = rango ? sql`WHERE ${rango}` : sql``;

  const rangoLeads = filtroFecha(rangoCrudo, "created_time");
  const wLeads = rangoLeads ? sql`WHERE ${rangoLeads}` : sql``;

  const interacciones = await base.execute<FilaCanal>(sql`
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

  const [formularios] = await base.execute<FilaFormularios>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'nuevo')::int AS sin_atender
    FROM leads ${wLeads}
  `);

  // Cuándo entró cada cosa, por día y por canal — para el gráfico del dashboard.
  const porDia = await base.execute<FilaPorDia>(sql`
    SELECT occurred_at::date::text AS dia, canal, count(*)::int AS n
    FROM interactions ${w}
    GROUP BY 1, 2 ORDER BY 1
  `);

  return { interacciones, formularios, porDia };
}

export type FilaFrescura = {
  ultimo_dato: string | null;
  ultima_ingesta: string | null;
  horas: string | null;
  total: number;
};

/** Qué tan viejo es lo que hay en la base. Una sola fila (o ninguna). */
export async function consultarFrescura(base: typeof db): Promise<FilaFrescura | undefined> {
  const [r] = await base.execute<FilaFrescura>(sql`
    SELECT max(i.occurred_at)                                   AS ultimo_dato,
           max(e.ingested_at)                                   AS ultima_ingesta,
           extract(epoch from now() - max(e.ingested_at)) / 3600 AS horas,
           count(*)::int                                        AS total
    FROM interactions i JOIN events e ON e.id = i.event_id
  `);

  return r;
}
