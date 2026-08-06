import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import { corridasCampana } from "../db/campana.js";

/**
 * AUTORIZAR UNA CORRIDA — donde el ADR 0036 se vuelve código.
 *
 * ══ LA FILA SE ESCRIBE ANTES DE MANDAR NADA ═════════════════════════════════
 *
 * Y ese orden es la mitad de la garantía. Si la firma se guardara al terminar,
 * un proceso que muere a la mitad dejaría **628 mensajes enviados y ninguna fila
 * que diga quién los autorizó** — exactamente el estado que este registro existe
 * para hacer imposible.
 *
 * Se escribe primero, con `total_previsto`, y se cierra después. Si al final
 * `enviados ≠ total_previsto`, eso **se ve** — que es mejor que no saber.
 *
 * ══ CONDICIÓN 5 DEL ADR: EL TECHO DE FRECUENCIA ═════════════════════════════
 *
 * Una campaña por persona cada 30 días, **sea cual sea la plantilla**. Sin eso,
 * «no insistimos» no queda en pie de ninguna forma: dos campañas distintas la
 * misma semana son insistir, aunque cada una respete su propia dedup.
 *
 * Se aplica sobre el DESTINATARIO, no sobre la campaña — por eso vive donde se
 * arma el público y no acá.
 */

type Base = typeof Db;

/** Una corrida abierta: alguien la autorizó y todavía está saliendo. */
export interface CorridaViva {
  id: number;
  piezaRef: string;
  numeroPropio: string;
  autorizadaPor: string;
  autorizadaEn: Date;
  totalPrevisto: number;
}

export interface DatosDeAutorizacion {
  piezaRef: string;
  piezaVersion: string | null;
  numeroPropio: string;
  listaId: number | null;
  /** COPIA del filtro al autorizar. La lista viva no sirve para auditar. */
  filtros: unknown;
  autorizadaPor: string;
  totalPrevisto: number;
}

/**
 * Abre la corrida y devuelve su id.
 *
 * El log estructurado sale ACÁ además de la fila: la fila es el registro, el log
 * es observabilidad. Los dos, no uno.
 */
export async function autorizarCorrida(base: Base, d: DatosDeAutorizacion): Promise<number> {
  const [fila] = await base
    .insert(corridasCampana)
    .values({
      piezaRef: d.piezaRef,
      piezaVersion: d.piezaVersion,
      numeroPropio: d.numeroPropio,
      listaId: d.listaId === null ? null : String(d.listaId),
      filtros: d.filtros,
      autorizadaPor: d.autorizadaPor,
      totalPrevisto: d.totalPrevisto,
    })
    .returning({ id: corridasCampana.id });

  console.log(
    `[campana] AUTORIZADA corrida=${fila.id} pieza=${d.piezaRef} linea=${d.numeroPropio} ` +
      `por=${d.autorizadaPor} previstos=${d.totalPrevisto} lista=${d.listaId ?? "(filtro suelto)"}`,
  );
  return fila.id;
}

/** La cierra bien. `enviados` puede diferir de lo previsto, y eso se ve. */
export async function terminarCorrida(base: Base, id: number, enviados: number): Promise<void> {
  await base
    .update(corridasCampana)
    .set({ estado: "terminada", terminadaEn: new Date() })
    .where(eq(corridasCampana.id, id));
  console.log(`[campana] TERMINADA corrida=${id} enviados=${enviados}`);
}

/**
 * LA FRENA — y guarda QUIÉN, que es la otra mitad de la firma.
 *
 * `quien` es `null` cuando la frenó el propio despachador por un error de Meta:
 * una máquina no es una persona, y decir que la frenó alguien sería mentir sobre
 * la única columna que existe para saber quién decidió.
 */
export async function frenarCorrida(
  base: Base,
  id: number,
  quien: string | null,
  motivo: string,
): Promise<boolean> {
  const filas = await base
    .update(corridasCampana)
    .set({ estado: "frenada", frenadaPor: quien, frenadaEn: new Date(), motivoDelFreno: motivo })
    .where(and(eq(corridasCampana.id, id), eq(corridasCampana.estado, "despachando")))
    .returning({ id: corridasCampana.id });

  const paro = filas.length > 0;
  console.log(
    `[campana] ${paro ? "FRENADA" : "ya no estaba viva"} corrida=${id} ` +
      `por=${quien ?? "(el despachador)"} motivo=${motivo}`,
  );
  return paro;
}

/**
 * ¿HAY ALGUNA CORRIDA SALIENDO?
 *
 * Es lo que dibuja el chip de la cabecera y lo que habilita el botón de frenar.
 * Se lee de la tabla y no de un flag en memoria: el proceso puede reiniciarse y
 * el lote seguir, o al revés — y la pantalla tiene que decir la verdad en los
 * dos casos.
 */
export async function corridasVivas(base: Base): Promise<CorridaViva[]> {
  const filas = await base
    .select()
    .from(corridasCampana)
    .where(and(eq(corridasCampana.estado, "despachando"), isNull(corridasCampana.terminadaEn)))
    .orderBy(desc(corridasCampana.autorizadaEn))
    .limit(10);

  return filas.map((f) => ({
    id: f.id,
    piezaRef: f.piezaRef,
    numeroPropio: f.numeroPropio,
    autorizadaPor: f.autorizadaPor,
    autorizadaEn: f.autorizadaEn,
    totalPrevisto: f.totalPrevisto,
  }));
}

/** ¿La frenaron mientras despachaba? Se pregunta ANTES de cada envío. */
export async function estaFrenada(base: Base, id: number): Promise<boolean> {
  const [f] = await base
    .select({ estado: corridasCampana.estado })
    .from(corridasCampana)
    .where(eq(corridasCampana.id, id))
    .limit(1);
  return f?.estado !== "despachando";
}

/**
 * EL HISTORIAL CON SU FIRMA — quién mandó qué, y cuándo.
 *
 * Es la respuesta a «que se vigile quién mandó la campaña», y la razón por la
 * que esto es una tabla y no un `console.log`: un log no se puede consultar seis
 * meses después.
 */
export async function historial(
  base: Base,
  dias = 90,
): Promise<
  {
    id: number;
    piezaRef: string;
    autorizadaPor: string;
    autorizadaEn: Date;
    totalPrevisto: number;
    estado: string;
    frenadaPor: string | null;
    motivoDelFreno: string | null;
  }[]
> {
  const filas = await base
    .select()
    .from(corridasCampana)
    .where(sql`${corridasCampana.autorizadaEn} > now() - (${dias} || ' days')::interval`)
    .orderBy(desc(corridasCampana.autorizadaEn))
    .limit(200);

  return filas.map((f) => ({
    id: f.id,
    piezaRef: f.piezaRef,
    autorizadaPor: f.autorizadaPor,
    autorizadaEn: f.autorizadaEn,
    totalPrevisto: f.totalPrevisto,
    estado: f.estado,
    frenadaPor: f.frenadaPor,
    motivoDelFreno: f.motivoDelFreno,
  }));
}
