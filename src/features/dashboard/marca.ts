/**
 * LA MARCA DE LA FILA — por qué esta fila está donde está.
 *
 * El radar ordena en el server (`cola/urgencia.ts`, #19) y la vendedora recibe
 * una lista donde la primera fila es la que tiene que atender. Pero un orden sin
 * explicación es un orden que no se puede auditar: si la pantalla no dice POR QUÉ
 * alguien está arriba, la única forma de confiar en ella es la fe.
 *
 * Esta función traduce el nivel de urgencia —y el dato que lo causó— a una frase
 * corta. Es pura y vive aparte del componente a propósito: el runner del front
 * corre en entorno `node` sin DOM (`vitest.config.ts`), así que lo que está acá
 * se puede fijar con tests y lo que está en el `.tsx` no.
 *
 * CRECE POR PARTES, una por ticket, sin reescribir lo anterior:
 *   · #22 — la Ventana (este archivo hoy).
 *   · #23 — el Vencido, con la nota del compromiso.
 *   · #20 — el resto de los niveles y la reestructura de la fila.
 * Por eso devuelve `null` para todo lo que todavía no sabe nombrar: un `null` es
 * «este ticket no llegó acá», no «esta fila no tiene motivo».
 */

/**
 * El tono decide la tinta, y la tinta significa algo fijo en Hermes:
 * `oro` = tiempo que se acaba (`CLAUDE.md`), y nada más. Se nombra el SIGNIFICADO
 * y no el color para que la fila no elija paleta: si mañana el oro cambia de hex,
 * cambia en un lugar y esta función ni se entera.
 */
export type TonoMarca = 'oro' | 'apagado';

export interface Marca {
  texto: string;
  tono: TonoMarca;
}

export interface DatosMarca {
  /** Días restantes de la Ventana de Meta: `null` si no aplica, `0` si se cerró. */
  ventana_dias: number | null;
}

/**
 * La marca de una fila, o `null` si no hay nada que explicar todavía.
 *
 * LA VENTANA (#22) son los 7 días que da Meta para responder EN PRIVADO un
 * comentario público de Facebook o Instagram (`CONTEXT.md` §Ventana). Es el único
 * plazo duro que no se puso la vendedora: cuando se cierra, esa puerta se cierra
 * de verdad. Por eso el aviso tiene que llegar ANTES del cierre — un «se venció»
 * es información sin jugada posible.
 *
 * `null` (no aplica) y `0` (se cerró) se tratan distinto y ese es medio ticket:
 * un chat de WhatsApp no tiene ventana ninguna —el número está vinculado como
 * dispositivo de un teléfono real, no como cuenta de negocio— así que mostrarle
 * una cuenta regresiva sería inventar un plazo que no existe.
 */
export function marcaDeFila({ ventana_dias }: DatosMarca): Marca | null {
  // Sin ventana no hay nada que contar. Es el caso de TODO WhatsApp, que es la
  // mayoría del radar: el default correcto es callarse.
  if (ventana_dias == null) return null;

  // Cerrada. Se dice, y se dice apagado: no es urgencia, es una puerta que ya no
  // está. Pintarlo de oro pediría correr por algo que no se puede alcanzar.
  if (ventana_dias <= 0) return { texto: 'se cerró la ventana', tono: 'apagado' };

  // Abierta: la cuenta regresiva, en oro, que acá es literal — es tiempo que se
  // acaba. El singular importa: «queda 1 día» es el aviso que más se lee.
  return {
    texto: ventana_dias === 1 ? 'queda 1 día para escribirle' : `quedan ${ventana_dias} días para escribirle`,
    tono: 'oro',
  };
}

/** La tinta de cada tono. Única traducción tono → clase; la fila no elige color. */
export const TINTA_MARCA: Record<TonoMarca, string> = {
  oro: 'text-gold-ink',
  apagado: 'text-muted-foreground',
};
