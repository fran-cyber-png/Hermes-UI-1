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
 * El tono es el SIGNIFICADO, no el color — así la fila no elige paleta y el día
 * que el oro cambie de hex cambia en un lugar solo. La distinción que sostiene
 * las tres es la de `VistaDashboard.tsx`: **oro = se acaba; rojo = ya se acabó**.
 *
 *   · `urgente` → todavía se puede hacer algo, y el reloj corre. Es el ORO, que
 *     en `CLAUDE.md` significa exactamente eso y nada más.
 *   · `perdido`  → el plazo ya pasó. Es el ROJO, el mismo de los pills de la
 *     agenda que se ven arriba en esta misma pantalla.
 *   · `neutro`   → hay algo que decir, pero no hay nada que correr.
 *
 * (En #22 esto se llamaba `'oro' | 'apagado'` — nombres de color, justo lo que
 * este comentario dice que no se hace. Corregido antes de que hubiera más de un
 * consumidor.)
 */
export type TonoMarca = 'urgente' | 'perdido' | 'neutro';

export interface Marca {
  texto: string;
  tono: TonoMarca;
}

export interface DatosMarca {
  /**
   * El nivel 0–5 que decidió el server (`cola/urgencia.ts`). La marca lo LEE
   * para saber qué explicar; no vuelve a comparar fechas por su cuenta. Si acá
   * se recalculara la precedencia, la fila podría explicar un motivo distinto
   * del que la puso en ese lugar — que es la clase de bug de #37.
   */
  nivel: number;
  /** Días restantes de la Ventana de Meta: `null` si no aplica, `0` si se cerró. */
  ventana_dias: number | null;
  /** De qué se trata el compromiso vencido, si hay uno. */
  seguimiento_nota?: string | null;
}

/** El nivel 1 de `cola/urgencia.ts`: un seguimiento agendado cuya fecha ya pasó. */
const NIVEL_VENCIDO = 1;

/**
 * Hasta dónde se muestra la nota del compromiso. La marca es `shrink-0` en la
 * fila —para que no la coma la atribución— así que una nota larga empujaría todo
 * lo demás fuera del renglón. Se recorta acá y no en CSS porque así el límite es
 * testeable y no depende de qué clase le toque a la fila.
 */
const TOPE_NOTA = 42;

function notaCorta(nota: string): string {
  const limpia = nota.trim().replace(/\s+/g, ' ');
  return limpia.length <= TOPE_NOTA ? limpia : `${limpia.slice(0, TOPE_NOTA - 1).trimEnd()}…`;
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
 *
 * EL VENCIDO (#23) es un seguimiento agendado cuya fecha ya pasó: el único plazo
 * duro que la vendedora se pone A SÍ MISMA. Va primero porque el server ya lo
 * puso primero — el orden lo decide `cola/urgencia.ts` y acá solo se lee.
 */
export function marcaDeFila({ nivel, ventana_dias, seguimiento_nota }: DatosMarca): Marca | null {
  // VENCIDO antes que la Ventana, porque así los ordenó el server: el nivel 1 le
  // gana al 2. La precedencia se LEE del nivel en vez de recalcularse — si acá se
  // comparara de nuevo, la fila podría explicar un motivo distinto del que la
  // puso en ese lugar, que es exactamente el bug de #37 en versión chica.
  if (nivel === NIVEL_VENCIDO) {
    const nota = seguimiento_nota?.trim();
    return {
      // La nota es el ticket: «vencido» a secas no le dice qué hacer. Si por lo
      // que sea no llegó, se dice igual que venció — callarse sería peor.
      texto: nota ? `vencido · ${notaCorta(nota)}` : 'vencido',
      // Rojo, no oro: el oro es lo que se está acabando y esto ya se acabó. Es la
      // misma tinta de los pills de la agenda, arriba en esta misma pantalla.
      tono: 'perdido',
    };
  }

  // Sin ventana no hay nada que contar. Es el caso de TODO WhatsApp, que es la
  // mayoría del radar: el default correcto es callarse.
  if (ventana_dias == null) return null;

  // Cerrada. Se dice, y en neutro: no es urgencia, es una puerta que ya no está.
  // Pintarlo de oro pediría correr por algo que no se puede alcanzar.
  if (ventana_dias <= 0) return { texto: 'se cerró la ventana', tono: 'neutro' };

  // Abierta: la cuenta regresiva, en oro, que acá es literal — es tiempo que se
  // acaba. El singular importa: «queda 1 día» es el aviso que más se lee.
  return {
    texto: ventana_dias === 1 ? 'queda 1 día para escribirle' : `quedan ${ventana_dias} días para escribirle`,
    tono: 'urgente',
  };
}

/** La tinta de cada tono. Única traducción tono → clase; la fila no elige color. */
export const TINTA_MARCA: Record<TonoMarca, string> = {
  urgente: 'text-gold-ink',
  perdido: 'text-destructive',
  neutro: 'text-muted-foreground',
};
