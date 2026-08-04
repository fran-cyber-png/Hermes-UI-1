import { and, desc, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { siguienteEnLaRueda, type EnLaRueda } from "./rueda.js";

/**
 * ASIGNARLE DUEÑO A UNA CONVERSACIÓN (round-robin).
 *
 * Se llama cuando entra un mensaje. Si la conversación **ya tiene dueño no hace
 * nada**: el reparto ocurre una vez, en el primer mensaje. Si reasignara en cada
 * turno, una conversación cambiaría de manos en medio de la charla — que es peor
 * que no repartir.
 *
 * ⚠️ **Degrada en silencio, a propósito.** Si la tabla no está migrada o no hay
 * nadie en la rueda, no asigna y devuelve `null`. Es fail-open: la conversación
 * queda sin dueño, que es exactamente el comportamiento de antes de este frente.
 * Lo que NO puede hacer es tumbar la ingesta de un mensaje — un lead perdido por
 * un fallo del reparto es infinitamente peor que un lead sin repartir.
 */
export async function asignarSiHaceFalta(
  base: typeof Base,
  clave: string,
  numeroPropio: string,
): Promise<string | null> {
  try {
    const [yaTiene] = await base
      .select({ vendedoraId: conversacionAsignada.vendedoraId })
      .from(conversacionAsignada)
      .where(eq(conversacionAsignada.clave, clave));
    if (yaTiene) return yaTiene.vendedoraId;

    const rueda = await leerRueda(base, numeroPropio);
    const quien = siguienteEnLaRueda(rueda);
    if (!quien) return null;

    await base
      .insert(conversacionAsignada)
      .values({ clave, vendedoraId: quien, numeroPropio, motivo: "round-robin" })
      // Dos mensajes de la misma persona pueden entrar casi juntos. Sin esto,
      // el segundo reventaría por PK duplicada y —por el catch de abajo— se
      // perdería en silencio. Con esto, el primero manda y el segundo no hace nada.
      .onConflictDoNothing({ target: conversacionAsignada.clave });

    const [confirmada] = await base
      .select({ vendedoraId: conversacionAsignada.vendedoraId })
      .from(conversacionAsignada)
      .where(eq(conversacionAsignada.clave, clave));
    return confirmada?.vendedoraId ?? null;
  } catch {
    return null;
  }
}

/**
 * Quiénes están en la rueda de esta línea, con lo que ya les tocó.
 *
 * La carga se cuenta **de la misma línea**: quien atiende dos números no tiene
 * por qué recibir menos en uno porque le tocó mucho en el otro.
 */
export async function leerRueda(
  base: typeof Base,
  numeroPropio: string,
): Promise<EnLaRueda[]> {
  // ⚠️ Con un subquery correlacionado acá, drizzle NO correlacionaba: el
  // `count(*)` devolvía el total de la tabla para todas, así que las seis
  // parecían tener la misma carga y **todo caía en la primera por orden**. Lo
  // atrapó `asignar.test.db.ts` (la suma dio 120 con 20 asignaciones: 20 × 6).
  // Un LEFT JOIN con GROUP BY correlaciona de verdad y se puede leer.
  const filas = await base
    .select({
      vendedoraId: repartoRueda.vendedoraId,
      orden: repartoRueda.orden,
      asignadas: sql<number>`count(${conversacionAsignada.clave})::int`,
    })
    .from(repartoRueda)
    .leftJoin(
      conversacionAsignada,
      and(
        eq(conversacionAsignada.vendedoraId, repartoRueda.vendedoraId),
        eq(conversacionAsignada.numeroPropio, repartoRueda.numeroPropio),
      ),
    )
    .where(and(eq(repartoRueda.numeroPropio, numeroPropio), eq(repartoRueda.activa, "si")))
    .groupBy(repartoRueda.vendedoraId, repartoRueda.orden);

  return filas.map((f) => ({
    vendedoraId: f.vendedoraId,
    orden: f.orden,
    asignadas: Number(f.asignadas ?? 0),
  }));
}

/**
 * TODOS los de la rueda de esta línea, **incluidas las inactivas**.
 *
 * Distinto de `leerRueda`, que solo trae a quienes RECIBEN. Acá se contesta otra
 * pregunta: «¿quién es alguien conocido en esta línea?» — la que usa
 * `reparto/destino.ts` para no dejar pasar un dedazo en el username de Cerberus.
 * Sacar a alguien de la rueda le corta los leads nuevos; no le prohíbe recibir
 * una conversación pasada a mano.
 */
export async function vendedorasDeLaRueda(
  base: typeof Base,
  numeroPropio: string,
): Promise<string[]> {
  const filas = await base
    .select({ vendedoraId: repartoRueda.vendedoraId })
    .from(repartoRueda)
    .where(eq(repartoRueda.numeroPropio, numeroPropio));
  return filas.map((f) => f.vendedoraId);
}

/**
 * ¿ESTA PERSONA PARTICIPA DEL REPARTO EN ALGUNA LÍNEA?
 *
 * Es lo que convierte «Míos» de FILTRO en la cola misma. Quien está en una rueda
 * trabaja lo que le tocó y nada más: no hace falta un chip que lo pida —y
 * tenerlo sería peor, porque cinco personas compartiendo una línea no tienen por
 * qué acordarse de encender un filtro para no leer los chats de las otras
 * cuatro—.
 *
 * Se pregunta acá y no en el front por lo de siempre: si el cliente decidiera
 * quién está en el reparto habría dos lugares decidiéndolo, y una preferencia
 * vieja en localStorage podría devolverle la cola entera a alguien que sí está.
 *
 * ⚠️ **Sigue sin ser un permiso.** El hilo, la ficha y el envío responden
 * cualquier conversación a cualquier token; esto cambia lo que la cola MUESTRA.
 * Quien no está en ninguna rueda —Luz, que quedó afuera a propósito, y quien
 * supervisa— sigue viendo todo: es el fail-open que hace que una conversación
 * mal asignada, o sin asignar, le aparezca a alguien.
 *
 * Compara normalizado de los dos lados: en producción el mismo humano tiene dos
 * grafías (`Luz` de Cerberus, `luz` del login) y la exacta diría que no está.
 */
export async function estaEnAlgunaRueda(
  base: typeof Base,
  vendedoraId: string | undefined,
): Promise<boolean> {
  const limpio = (vendedoraId ?? "").trim().toLowerCase();
  if (!limpio) return false;
  try {
    const [fila] = await base
      .select({ vendedoraId: repartoRueda.vendedoraId })
      .from(repartoRueda)
      .where(
        and(
          sql`lower(btrim(${repartoRueda.vendedoraId})) = ${limpio}`,
          eq(repartoRueda.activa, "si"),
        ),
      )
      .limit(1);
    return fila != null;
  } catch {
    // Sin la tabla migrada nadie está en ninguna rueda, y la cola se sirve
    // entera: fail-open, igual que todo lo demás de este frente.
    return false;
  }
}

/** Una fila del reparto tal como se AUDITA: quién, cuántas tiene, si sigue recibiendo. */
export interface EnElReparto {
  vendedoraId: string;
  asignadas: number;
  orden: number;
  activa: boolean;
}

/**
 * CÓMO VA EL REPARTO — la consulta de auditoría, la misma que promete la
 * propiedad: entre el que más y el que menos recibe nunca hay más de 1.
 *
 * Trae también a las INACTIVAS y a quien tiene conversaciones sin estar en la
 * rueda (una reasignación a mano a Luz, por ejemplo). Ocultarlas haría que la
 * suma de la tabla no diera el total de asignadas, y una auditoría cuyos números
 * no cierran no sirve para auditar nada.
 */
export async function comoVaElReparto(
  base: typeof Base,
  numeroPropio: string,
): Promise<EnElReparto[]> {
  const filas = await base.execute<{
    vendedora_id: string;
    asignadas: number;
    orden: number;
    activa: boolean;
  }>(sql`
    SELECT COALESCE(r.vendedora_id, a.vendedora_id)          AS vendedora_id,
           COALESCE(a.asignadas, 0)::int                     AS asignadas,
           COALESCE(r.orden, 999)::int                       AS orden,
           (r.vendedora_id IS NOT NULL AND r.activa = 'si')  AS activa
      FROM (
        SELECT vendedora_id, orden, activa FROM reparto_rueda
         WHERE numero_propio = ${numeroPropio}
      ) r
      FULL OUTER JOIN (
        SELECT vendedora_id, count(*) AS asignadas FROM conversacion_asignada
         WHERE numero_propio = ${numeroPropio}
         GROUP BY vendedora_id
      ) a ON a.vendedora_id = r.vendedora_id
     ORDER BY 3, 1
  `);
  return filas.map((f) => ({
    vendedoraId: f.vendedora_id,
    asignadas: Number(f.asignadas ?? 0),
    orden: Number(f.orden ?? 0),
    activa: f.activa === true,
  }));
}

/**
 * Mete (o vuelve a activar) a alguien en la rueda de una línea.
 *
 * Es idempotente y **reactiva**: correrlo dos veces no duplica, y correrlo sobre
 * alguien que estaba en `activa='no'` lo vuelve a poner a recibir. Sin eso, la
 * única forma de que alguien vuelva sería un `UPDATE` a mano en producción —que
 * es justo lo que este frente vino a sacar del medio.
 *
 * El `orden` solo desempata cargas iguales (`rueda.ts`); no es una prioridad.
 */
export async function agregarALaRueda(
  base: typeof Base,
  numeroPropio: string,
  vendedoraId: string,
  orden: number,
): Promise<void> {
  await base
    .insert(repartoRueda)
    .values({ numeroPropio, vendedoraId, orden, activa: "si" })
    .onConflictDoUpdate({
      target: [repartoRueda.numeroPropio, repartoRueda.vendedoraId],
      set: { orden, activa: "si" },
    });
}

/**
 * Saca a alguien de la rueda: deja de recibir leads nuevos.
 *
 * **No borra la fila ni sus asignaciones** (baja lógica, como `desactivarNumero`):
 * borrarla dejaría sus conversaciones sin dueño y sin rastro de quién las tenía,
 * que es peor que el problema que el reparto vino a resolver. Devuelve si había
 * alguien a quien sacar.
 */
export async function sacarDeLaRueda(
  base: typeof Base,
  numeroPropio: string,
  vendedoraId: string,
): Promise<boolean> {
  const filas = await base
    .update(repartoRueda)
    .set({ activa: "no" })
    .where(and(eq(repartoRueda.numeroPropio, numeroPropio), eq(repartoRueda.vendedoraId, vendedoraId)))
    .returning({ vendedoraId: repartoRueda.vendedoraId });
  return filas.length > 0;
}

/** El próximo `orden` libre de una línea, para que agregar no pise un desempate. */
export async function proximoOrden(base: typeof Base, numeroPropio: string): Promise<number> {
  const [fila] = await base
    .select({ orden: repartoRueda.orden })
    .from(repartoRueda)
    .where(eq(repartoRueda.numeroPropio, numeroPropio))
    .orderBy(desc(repartoRueda.orden))
    .limit(1);
  return fila ? fila.orden + 1 : 0;
}

/** Pasarle una conversación a otra persona. Queda registrado quién la pasó. */
export async function reasignar(
  base: typeof Base,
  clave: string,
  numeroPropio: string,
  aQuien: string,
  quienLaPasa: string,
): Promise<void> {
  await base
    .insert(conversacionAsignada)
    .values({
      clave,
      numeroPropio,
      vendedoraId: aQuien,
      motivo: "manual",
      asignadaPor: quienLaPasa,
    })
    .onConflictDoUpdate({
      target: conversacionAsignada.clave,
      set: {
        vendedoraId: aQuien,
        motivo: "manual",
        asignadaPor: quienLaPasa,
        asignadaEn: new Date(),
      },
    });
}
