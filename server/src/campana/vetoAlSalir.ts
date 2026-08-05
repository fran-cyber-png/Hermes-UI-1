import { esDespedida, huboRechazo } from "../autorespuesta/rechazo.js";

/**
 * EL VETO SE PREGUNTA AL SALIR, NO AL PLANIFICAR.
 *
 * ══ EL DEFECTO QUE ESTE ARCHIVO EXISTE PARA MATAR ═══════════════════════════
 *
 * `publico.ts` decide a quién le corresponde el mensaje. Lo hace **una vez**, y
 * eso alcanzaría si el lote saliera instantáneo. No sale: 88 destinatarios a 30
 * segundos son 45 minutos, y con el ritmo que un número real tolera son horas.
 *
 * En esa ventana la persona sigue viva. Contesta. Dice «sacame de esta lista» a
 * las 15:00 y recibe el flyer a las 17:30, porque su lugar en la fila se decidió
 * a las 14:00. La foto del rechazo envejece mientras el lote corre, y el punto
 * «**nunca a quien dijo que no**» —una de las condiciones escritas con las que
 * la auto-respuesta se ganó su excepción a ADR 0015— queda falso desde el
 * segundo envío.
 *
 * No es una hipótesis prolija: es la versión aguda del defecto que ya se pagó.
 * El primer lote real preguntó el rechazo **mal** (sólo el primer mensaje) *y*
 * **una sola vez**. Dos personas que habían dicho que no recibieron la promo.
 *
 * ══ POR QUÉ ESTO NO ES UN `if` MÁS EN EL BUCLE ══════════════════════════════
 *
 * La auto-respuesta ya resolvió exactamente esto y su solución tiene test
 * propio: `cancelarPorRespuestaHumana` / `cancelarDeConversacion`
 * (`autorespuesta/repositorio.ts`). Lo que faltaba era la forma general, y la
 * regla que sale de acá vale para **cualquier cola con destinatarios humanos**:
 *
 *   > Si entre la decisión y el envío puede pasar más de un minuto, el veto se
 *   > vuelve a preguntar antes de mandar.
 *
 * ══ Y POR QUÉ ES LO QUE SOSTIENE EL ADR ═════════════════════════════════════
 *
 * Una campaña no se puede aprobar de a un mensaje (ADR 0020 retiró el aprobar
 * en lote justamente para que nadie apretara «Aprobar 32»). La salida honesta
 * no es pedirle a una persona que apruebe 88 veces: es que **lo que un humano
 * no puede mirar a las 17:30, la máquina lo mire por él**. Sin este archivo, la
 * excepción que autoriza campañas no tiene con qué comprarse.
 */

/** Lo que hay que saber de una persona en el instante de mandarle. */
export interface EstadoAlSalir {
  /** Sus mensajes entrantes, incluidos los que llegaron DESPUÉS de autorizar. */
  mensajes: readonly (string | null | undefined)[];
  /** ¿Escribió algo desde que se autorizó la corrida? */
  escribioDesdeQueSeAutorizo: boolean;
  /** ¿Una persona nuestra le escribió desde que se autorizó? */
  leEscribieronDesdeQueSeAutorizo: boolean;
  /** ¿Ya se le mandó esta misma pieza? (una corrida frenada y reanudada) */
  yaLeLlego: boolean;
}

export const MOTIVOS_DE_CANCELACION = [
  "dijo_que_no",
  "se_despidio",
  "conversacion_viva",
  "ya_le_escribieron",
  "ya_le_llego",
] as const;
export type MotivoDeCancelacion = (typeof MOTIVOS_DE_CANCELACION)[number];

export type Veredicto =
  | { sale: true }
  | { sale: false; motivo: MotivoDeCancelacion };

/**
 * ¿Sale este mensaje, ahora?
 *
 * El orden de las preguntas va de lo más grave a lo más circunstancial, igual
 * que en `publico.ts`: quien dijo que no se cancela POR eso, aunque además haya
 * una conversación viva. El motivo que se guarda es el que hay que poder
 * defender después.
 */
export function vetoAlSalir(estado: EstadoAlSalir): Veredicto {
  if (huboRechazo(estado.mensajes)) return { sale: false, motivo: "dijo_que_no" };
  if (esDespedida(estado.mensajes[estado.mensajes.length - 1]))
    return { sale: false, motivo: "se_despidio" };

  /**
   * YA SE LE MANDÓ. Va antes que los dos de abajo porque un segundo mensaje
   * idéntico es peor que uno inoportuno: es el que se lee como spam.
   */
  if (estado.yaLeLlego) return { sale: false, motivo: "ya_le_llego" };

  /**
   * UNA CONVERSACIÓN VIVA NO SE INTERRUMPE CON UNA PROMO.
   *
   * Si la persona escribió desde que se autorizó la corrida, está hablando con
   * nosotros AHORA — y lo que necesita es una respuesta, no un flyer. Mandarlo
   * igual es la forma más visible de que hay una máquina detrás.
   */
  if (estado.escribioDesdeQueSeAutorizo) return { sale: false, motivo: "conversacion_viva" };

  /**
   * Y SI UNA VENDEDORA YA LE ESCRIBIÓ, la campaña llega tarde y de más: la
   * atención humana ya ocurrió. Es el gemelo de `cancelarPorRespuestaHumana`.
   */
  if (estado.leEscribieronDesdeQueSeAutorizo)
    return { sale: false, motivo: "ya_le_escribieron" };

  return { sale: true };
}

/** Para el resumen del final: qué se canceló y por qué. */
export function contarCancelaciones(
  veredictos: readonly Veredicto[],
): Record<MotivoDeCancelacion, number> {
  const cuenta = Object.fromEntries(MOTIVOS_DE_CANCELACION.map((m) => [m, 0])) as Record<
    MotivoDeCancelacion,
    number
  >;
  for (const v of veredictos) if (!v.sale) cuenta[v.motivo]++;
  return cuenta;
}
