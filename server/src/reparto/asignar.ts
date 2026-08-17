import { and, desc, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { duenosPorCampana } from "../routing/repositorio.js";
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
  /**
   * El `source_id` del referral, cuando el mensaje vino de un click-to-WhatsApp.
   * Con él se pregunta si la CAMPAÑA de ese anuncio tiene dueño elegido; sin él
   * (o sin regla) manda la rueda, exactamente como antes de este frente.
   */
  adId?: string | null,
): Promise<string | null> {
  try {
    const [yaTiene] = await base
      .select({ vendedoraId: conversacionAsignada.vendedoraId })
      .from(conversacionAsignada)
      .where(eq(conversacionAsignada.clave, clave));
    if (yaTiene) return yaTiene.vendedoraId;

    /**
     * 🔴 LA REGLA DE CAMPAÑA LE GANA A LA RUEDA, y ese es todo el frente: la
     * rueda reparte parejo porque no sabe nada de quién viene; una regla la puso
     * una persona sabiendo de qué campaña se trata. Lo específico le gana a lo
     * general, la misma forma que el alias por `adId` contra el título inferido
     * (`cursos/`) y que lo manual contra lo derivado en el grafo de identidad.
     *
     * ⚠️ **No se le exige estar en la rueda.** El destino ya se verificó contra
     * `destinosPosibles` al guardar la regla, y la rueda contesta otra pregunta
     * («¿entre quiénes se reparte lo que no tiene dueño?»). Exigirlo haría que
     * sacar a alguien de la rueda le apagara sus campañas en silencio.
     */
    /**
     * 🔴 **LOS CABLES DE LA CAMPAÑA SON UNA RUEDA CHICA**, y se elige adentro con
     * la MISMA regla que la grande: le toca a quien menos tiene. Con un cable eso
     * es asignación directa; con tres, round-robin entre esas tres. Reusar
     * `siguienteEnLaRueda` no es ahorro de código: es lo que hace que la
     * propiedad que el reparto promete —entre el que más y el que menos nunca
     * hay más de 1— valga también acá.
     *
     * ⚠️ La CARGA se cuenta sobre la línea entera, no sobre la campaña: quien
     * atiende dos campañas ya tiene trabajo, y contarle solo lo de ésta le
     * mandaría el doble.
     */
    const cables = await duenosPorCampana(base, numeroPropio, adId);
    const porCampana = cables.length
      ? siguienteEnLaRueda(await ruedaDeCables(base, numeroPropio, cables))
      : null;
    const quien = porCampana ?? siguienteEnLaRueda(await leerRueda(base, numeroPropio));
    if (!quien) return null;

    await base
      .insert(conversacionAsignada)
      .values({
        clave,
        vendedoraId: quien,
        numeroPropio,
        motivo: porCampana ? "campana" : "round-robin",
      })
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
 * LOS CABLES, CON LA CARGA QUE YA TIENE CADA UNO.
 *
 * ⚠️ **Quien está cableado pero no está en la rueda general arranca en 0**, y no
 * es un bug: `leerRueda` solo trae a quienes participan del reparto automático, y
 * conectar un cable NO exige estar ahí (el destino ya se verificó al guardarlo).
 * Sin este default, esa persona no existiría para la elección y su cable no
 * llevaría nada.
 *
 * El `orden` sale de la posición alfabética: `siguienteEnLaRueda` lo usa solo
 * para desempatar cargas iguales, y con un orden estable dos leads seguidos en
 * la misma situación caen siempre en la misma persona — o sea, es reproducible.
 */
async function ruedaDeCables(
  base: typeof Base,
  numeroPropio: string,
  cables: readonly string[],
): Promise<EnLaRueda[]> {
  const cargas = await cargaDeVendedoras(base, numeroPropio, cables);
  return [...cables]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((vendedoraId, orden) => ({
      vendedoraId,
      orden,
      asignadas: cargas.get(vendedoraId.trim().toLowerCase()) ?? 0,
    }));
}

/**
 * 🔴 LA CARGA SE CUENTA CONTRA `conversacion_asignada`, NO CONTRA LA RUEDA.
 *
 * El primer borrador la sacaba de `leerRueda`, que **solo trae a quienes están
 * `activa='si'`**: cualquier cableada fuera de la rueda activa —Luz, que queda
 * afuera a propósito; ventas13 y ventas14, que están inactivas— aparecía con
 * carga **0 para siempre** y se llevaba **todos** los leads de la campaña. Con
 * dos cables, uno a alguien de la rueda y otro a alguien de afuera, el segundo
 * ganaba siempre: el round-robin dejaba de repartir sin un solo síntoma.
 *
 * Medido sobre la copia de producción: la pantalla ofrece 7 destinos y
 * `leerRueda` devuelve 4. O sea que el agujero cubría a 3 de cada 7.
 *
 * ⚠️ Se compara normalizando los dos lados: en producción el mismo humano tiene
 * dos grafías (`Luz` de Cerberus, `luz` del login), y con la exacta la carga de
 * una de las dos daría 0.
 */
async function cargaDeVendedoras(
  base: typeof Base,
  numeroPropio: string,
  quienes: readonly string[],
): Promise<Map<string, number>> {
  const limpias = [...new Set(quienes.map((q) => q.trim().toLowerCase()).filter(Boolean))];
  if (limpias.length === 0) return new Map();
  const filas = await base.execute<{ vendedora_id: string; n: number }>(sql`
    SELECT lower(btrim(vendedora_id)) AS vendedora_id, count(*)::int AS n
      FROM conversacion_asignada
     WHERE numero_propio = ${numeroPropio}
       AND lower(btrim(vendedora_id)) IN (${sql.join(limpias.map((v) => sql`${v}`), sql`, `)})
     GROUP BY 1
  `);
  return new Map(filas.map((f) => [f.vendedora_id, Number(f.n ?? 0)]));
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
 * 🔴 ACÁ VIVÍA `estaEnAlgunaRueda`, Y SE BORRÓ CON D4 — vale dejarlo escrito.
 *
 * Respondía «¿esta persona participa del reparto en alguna línea?» y era lo que
 * convertía «Míos» de FILTRO en la cola misma: quien estaba en una rueda veía
 * solo lo suyo **sin pedirlo**, y quien no —Luz, que quedó afuera a propósito—
 * seguía viendo todo. Fue la mejor aproximación que había mientras el rol no
 * existiera en ningún lado.
 *
 * Desde D4 el recorte es propiedad del ROL (`equipo/roles.ts`; el predicado, en
 * `cola/asignadaSql.ts`): toda vendedora ve lo suyo más lo huérfano de sus
 * líneas, y supervisor/admin ven todo. Dejar viva la regla de la rueda «solo
 * para vendedoras» habría hecho **falso a D4 justo para las que están fuera de
 * la rueda**, que son dos de las que venden. Y dos reglas para la misma pregunta
 * es #37: la que sobrevive en silencio es siempre la vieja.
 *
 * ⚠️ Si vuelve a hacer falta algo así, la pregunta correcta es por el **rol**, no
 * por la rueda. La rueda decide a quién le TOCA lo nuevo, no quién VE qué.
 */

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
