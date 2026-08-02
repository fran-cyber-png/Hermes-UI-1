/**
 * EL CLAIM DE `bot_pendientes` VENCE — y antes no vencía, así que cada deploy
 * colgaba a un lead.
 *
 * ══ EL AGUJERO, MEDIDO ═══════════════════════════════════════════════════════
 *
 * El despachador tomaba pendientes con `en_proceso_desde IS NULL` y los marcaba
 * con la hora. **No había ninguna recuperación por vencimiento**: si el proceso
 * moría con el claim tomado —lo que hace TODO deploy con restart, y también un
 * OOM o un `systemctl restart`— la fila quedaba marcada para siempre y nadie la
 * volvía a mirar.
 *
 * Pasó dos veces el 1-ago-2026, con leads reales. Y el síntoma es el peor que
 * hay: **silencio total**. No queda ni una fila en `bot_respuestas`, así que
 * desde afuera se ve igual que «el bot nunca lo miró» y no hay motivo que lo
 * explique.
 *
 * ══ POR QUÉ LA REGLA VIVE ACÁ Y NO ADENTRO DEL DESPACHADOR ═══════════════════
 *
 * Es el molde de `numeros/dominio.ts` (`estadoVinculacionVigente`), que resuelve
 * exactamente esto para el QR: **el caso que importa es el minuto que todavía no
 * pasó**, y eso no se puede interrogar si la comparación vive adentro de un
 * `setInterval` que necesita una base. Acá entra un instante, sale un booleano.
 *
 * El `WHERE` del despachador es la transcripción literal de `corteDeClaim` — no
 * hay dos umbrales, hay uno y una consulta que lo compara.
 */

/**
 * CUÁNTO VALE UN CLAIM — cinco minutos.
 *
 * Los dos bordes que lo fijan, y ninguno es redondo por casualidad:
 *
 *   · **El piso es el turno más lento que existe.** Un turno son hasta 4 llamadas
 *     al modelo (`MAX_ITERATIONS` en `agente.ts`), más Cerberus para el contexto
 *     y para el precio (6–12 s con techo propio), más el despacho de hasta 2
 *     piezas con su espaciado de 2–6 s por paso. Sumado y siendo pesimista da
 *     ~3 minutos. Si el claim venciera antes, **un pipeline vivo pero lento
 *     recibiría un segundo pipeline encima y el lead vería la respuesta dos
 *     veces** — el texto no tiene dedupe (las piezas sí, `piezasYaEnviadas`).
 *   · **El techo es la paciencia del lead.** Recuperar a los 20 minutos es
 *     técnicamente correcto y comercialmente inútil: contesta cuando la persona
 *     ya cerró el chat. Cinco minutos deja la respuesta dentro de la ventana en
 *     la que todavía está mirando el teléfono.
 *
 * ⚠️ **El riesgo que queda escrito**: el SDK de Anthropic no lleva timeout
 * propio acá, así que una llamada COLGADA puede pasar los 5 minutos y hacerse
 * re-tomar. Es un cambio a conciencia: hoy el costo es que cada deploy deja un
 * lead en silencio para siempre —pasó dos veces en un día— y el costo nuevo es
 * una respuesta repetida en un caso raro. Lo que lo cerraría del todo es un
 * `timeout` por llamada al modelo, más chico que esto; va aparte porque toca el
 * agente y no el claim.
 */
export const VIGENCIA_CLAIM_MS = 5 * 60_000;

/**
 * HASTA CUÁNDO VALE LA PENA CONTESTAR UN ENTRANTE — seis horas.
 *
 * Vivía en `orquestador.ts` (para el reintento de los saltos transitorios) y se
 * mudó acá porque el claim que vence necesita **el mismo techo**, y por el mismo
 * motivo: la lección de #166. Un entrante que estuvo esperando medio día no se
 * contesta cuando el proceso vuelve — «¿en qué te puedo ayudar?» seis horas
 * después confirma que nadie miraba, y es peor que el silencio.
 *
 * Sin este techo, el primer deploy con esta recuperación adentro despertaría de
 * golpe a todos los pendientes colgados de días anteriores y les contestaría a
 * todos a la vez. Es exactamente el error de las 40 auto-respuestas del 27-jul,
 * que esperaban entre 57 y 72 horas.
 */
export const ESPERA_MAXIMA_MS = 6 * 60 * 60 * 1000;

/** El instante antes del cual un claim ya no vale. La regla, una sola vez. */
export function corteDeClaim(ahora: Date): Date {
  return new Date(ahora.getTime() - VIGENCIA_CLAIM_MS);
}

/**
 * ¿Se puede tomar este pendiente?
 *
 * `null` = nadie lo tiene (el caso normal). Con fecha, solo si esa fecha ya
 * quedó del otro lado del corte.
 */
export function sePuedeTomar(enProcesoDesde: Date | null, ahora: Date): boolean {
  if (enProcesoDesde === null) return true;
  return enProcesoDesde < corteDeClaim(ahora);
}

/**
 * ¿Tomarlo es RECUPERAR uno colgado (y no simplemente atender uno nuevo)?
 *
 * Existe para una sola cosa y no es cosmética: **el log**. El modo de falla de
 * este mecanismo es silencioso por definición —una fila marcada que nadie mira—,
 * así que cuando se recupera una, el renglón tiene que decirlo y decir cuánto
 * estuvo colgada. Si un día hay muchas, eso ES el aviso de que el proceso se
 * está muriendo seguido.
 */
export function esRecuperacion(enProcesoDesde: Date | null, ahora: Date): boolean {
  return enProcesoDesde !== null && sePuedeTomar(enProcesoDesde, ahora);
}

/**
 * ¿Este entrante esperó tanto que contestarlo es peor que callarse?
 *
 * `null` (no sabemos cuándo escribió) NO es espera excesiva: es lo que devuelve
 * un hilo que todavía no se pudo leer, y descartar por no saber convertiría una
 * laguna en una decisión.
 */
export function esperaExcesiva(ultimoEntranteEn: Date | null, ahora: Date): boolean {
  if (!ultimoEntranteEn) return false;
  return ahora.getTime() - ultimoEntranteEn.getTime() > ESPERA_MAXIMA_MS;
}

/** Cuánto lleva tomado, en segundos — para el renglón del log. */
export function segundosTomado(enProcesoDesde: Date, ahora: Date): number {
  return Math.round((ahora.getTime() - enProcesoDesde.getTime()) / 1000);
}
