/**
 * LOS FRENOS QUE ESTABAN MUERTOS — `vendedora_activa` y `spam`.
 *
 * ── El hallazgo ──────────────────────────────────────────────────────────
 *
 * `decision.ts` evalúa nueve motivos en orden fijo y está testeado hasta el
 * hueso. Pero `armarHechos()` en el orquestador le pasaba
 * `huboSalienteHumanoDespuesDe: null` y `entranteEsRepetido: false` **fijos**:
 * dos de esos nueve frenos no se podían disparar nunca. El motor decidía bien
 * sobre hechos que nadie recolectaba — la forma más cara de un bug, porque el
 * test del motor pasa en verde.
 *
 * El grave es el primero: **si una vendedora responde en la línea del bot, el
 * bot le escribe encima.** No es hipotético: la línea del bot es Cloud API y
 * cualquier vendedora puede contestar ahí desde Hermes.
 *
 * ── Por qué acá y no adentro del orquestador ─────────────────────────────
 *
 * Porque la parte que importa es una **regla**, no una consulta: «hay vendedora
 * activa» es una comparación de dos instantes, y «esto es spam» es una
 * propiedad de un puñado de textos. Las dos se pueden interrogar con un test sin
 * base ni red. La consulta a `envios_wa` es el mandado; la decisión vive
 * separada, como `senales/cotizacion.ts` frente a `consultarSenales.ts`.
 */

import { and, desc, eq, ne } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { enviosWa } from "../db/schema.js";

/**
 * Con qué `vendedora_id` firma el bot sus envíos.
 *
 * ⚠️ Acá decía «un envío con otro id es de una persona», y **es falso**: la sala
 * de leads firma `goberna-admin` —un id elegido a propósito para no ser `bot`,
 * justamente para que estos frenos no lo confundan con el bot
 * (`docs/prompt-sala-de-leads.md`)—. Para los frenos la distinción sigue
 * sirviendo tal cual está; lo que no se puede es leerla como «bot o humano»,
 * que fue lo que puso a dos actores automáticos en el cuadro «Equipo» del
 * Dashboard, firmando 537 de los 620 envíos de la tabla. La lista completa de
 * lo que NO es una persona vive en `dashboard/equipo.ts`.
 */
export const VENDEDORA_ID_DEL_BOT = "bot";

// ── vendedora_activa ─────────────────────────────────────────────────────

/**
 * ¿Contestó una PERSONA después del último mensaje del lead?
 *
 * Devuelve el instante (que es lo que `decidir()` espera) o `null`.
 *
 * **El orden importa y por eso se compara, no se pregunta «¿hay?»**: que una
 * vendedora haya escrito ayer no la hace dueña de la conversación de hoy. Lo que
 * la hace dueña es haber contestado *este* mensaje — si el lead volvió a
 * escribir después de ella y ella no respondió, la conversación vuelve a estar
 * libre. Sin la comparación, una sola intervención humana en marzo dejaría al
 * bot mudo para siempre en esa conversación.
 *
 * Empate = **la persona gana**: si los dos instantes son iguales no se sabe cuál
 * fue primero, y hablar encima de una vendedora es peor que callarse un turno.
 */
export function vendedoraActivaDesde(
  ultimoSalienteHumanoEn: Date | null,
  ultimoEntranteEn: Date | null,
): Date | null {
  if (!ultimoSalienteHumanoEn) return null;
  if (!ultimoEntranteEn) return ultimoSalienteHumanoEn;
  return ultimoSalienteHumanoEn >= ultimoEntranteEn ? ultimoSalienteHumanoEn : null;
}

/**
 * El último envío hecho por alguien que NO es el bot, en esta línea y a este
 * teléfono.
 *
 * Se pregunta a `envios_wa` y no al hilo a propósito: el hilo trae la marca
 * `automatico` por un `LEFT JOIN` que **degrada a `false` cuando la columna no
 * está** (`whatsapp/hilo.ts:89`), y con esa degradación cada burbuja del bot
 * pasaría por humana y el bot se callaría entero. Acá la pregunta es directa —
 * `vendedora_id` — y si la consulta falla se devuelve `null`, que es «no se
 * sabe» y deja que el bot siga: un freno que se traba en encendido apaga el
 * producto.
 */
export async function ultimoSalienteHumanoEn(
  base: typeof Base,
  numeroPropio: string,
  telefono: string,
): Promise<Date | null> {
  try {
    const filas = await base
      .select({ creadoAt: enviosWa.creadoAt })
      .from(enviosWa)
      .where(
        and(
          eq(enviosWa.numeroPropio, numeroPropio),
          eq(enviosWa.telefono, telefono),
          ne(enviosWa.vendedoraId, VENDEDORA_ID_DEL_BOT),
          // Un envío que no salió no ocupa la conversación: la vendedora
          // intentó y falló, el lead no vio nada, y el bot todavía hace falta.
          eq(enviosWa.estado, "enviado"),
        ),
      )
      .orderBy(desc(enviosWa.creadoAt))
      .limit(1);
    return filas[0]?.creadoAt ?? null;
  } catch {
    return null;
  }
}

// ── spam / entrante repetido ─────────────────────────────────────────────

/** Cuántas repeticiones seguidas hacen falta. Tres: dos son insistencia normal. */
export const REPETICIONES_PARA_SPAM = 3;

function normalizar(texto: string): string {
  return texto
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * ¿El lead está repitiendo el MISMO mensaje una y otra vez?
 *
 * ⚠️ **La condición no es solo la repetición, y esa es la decisión comercial
 * del módulo.** Alguien que escribe «hola» tres veces porque nadie le contesta
 * no es spam: es un lead impaciente, y callarse ahí es perderlo. Lo que sí es
 * anómalo es que repita **después de que ya le respondimos** — ahí o hay un
 * script del otro lado, o el bot está en un lazo, y en los dos casos la salida
 * correcta es dejar de contestar.
 *
 * Por eso entran dos cosas: los últimos textos del lead **y** si ya hubo
 * respuesta nuestra. Sin la segunda, el freno castiga justo a quien más ganas
 * tiene de que le contesten.
 *
 * `entrantes` viene en orden cronológico; se miran los últimos.
 */
export function esEntranteRepetido(
  entrantes: string[],
  yaLeRespondimos: boolean,
): boolean {
  if (!yaLeRespondimos) return false;
  const ultimos = entrantes.slice(-REPETICIONES_PARA_SPAM).map(normalizar).filter((t) => t !== "");
  if (ultimos.length < REPETICIONES_PARA_SPAM) return false;
  return ultimos.every((t) => t === ultimos[0]);
}

/**
 * ¿Ya le mandamos algo al lead en esta conversación? Es el segundo insumo de
 * `esEntranteRepetido` y se responde con el hilo que el pipeline ya tiene
 * cargado — no hace falta otra consulta.
 */
export function yaLeRespondimos(
  hilo: readonly { direccion: string }[],
): boolean {
  return hilo.some((m) => m.direccion === "saliente");
}
