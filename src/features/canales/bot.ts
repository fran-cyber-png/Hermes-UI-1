/**
 * «EL BOT DIJO ALGO DE ESTA CONVERSACIÓN» — la marca de la fila de la cola, pura.
 *
 * ── Por qué existe ──
 * El bot comercial escribe en `bot_calificaciones` desde el 1-ago-2026 y esa
 * tabla **no tenía un solo lector**. Ese mismo día escaló tres conversaciones de
 * leads que estaban por comprar: escalar lo silencia a propósito (dos horas de
 * gracia) y del otro lado no había nadie. Se salvaron porque el dueño estaba
 * mirando la sala a mano — o sea que el bot solo servía mientras alguien lo
 * vigilaba.
 *
 * ── Qué dice, y por qué así ──
 * Dos hechos distintos, que se atienden distinto:
 *
 *   · **escalada** — el bot SE FRENÓ y está esperando a una persona. Es el más
 *     caro: mientras nadie la toma, el lead no recibe nada. El chip dice el
 *     MOTIVO, porque «está por cerrar» y «preguntó si es un bot» no se atienden
 *     igual.
 *   · **caliente** — el bot la calificó caliente (pidió precio, cuotas o forma
 *     de pago) y sigue trabajándola. Es una oportunidad, no una deuda.
 *
 * `tibio` y `frio` NO se dibujan: en un día real fueron 50 de 66 conversaciones,
 * y un chip que aparece en tres de cada cuatro filas no ayuda a elegir a quién
 * atender — es la misma lección que dejó «Pide info» (#72).
 *
 * ── Lo que NO hace ──
 * No inventa. Sin el campo (el radar y la agenda arman `Conversacion` sin él, y
 * un server sin la migración del bot tampoco lo trae) devuelve `null`: la
 * ausencia de dato NO es «el bot la vio fría». Y un motivo que el front no
 * conoce —el enum de escaladas crece del lado del server— cae en la lectura
 * genérica, nunca en un throw y nunca en un motivo parecido.
 *
 * El color y la forma viven en el componente, igual que en `cliente.ts`: acá se
 * decide QUÉ se dice, no cómo se ve.
 */

export type TonoBot = 'escalada' | 'caliente';

/**
 * Los seis motivos de escalada del server (`bot/acciones.ts` · `EscaladaMotivo`),
 * dichos como los diría una persona. El `Record` es parcial a propósito: lo que
 * llega es texto de otro proceso, no un tipo compartido, y este archivo tiene que
 * poder leer una fila escrita por un server más nuevo que él.
 */
const LECTURA_ESCALADA: Record<string, string> = {
  por_cerrar: 'Listo para cerrar',
  pidio_humano: 'Pidió una persona',
  pregunto_si_es_bot: 'Preguntó si es un bot',
  sin_respuesta_en_catalogo: 'Preguntó algo que no sabe',
  frustrado: 'Se está molestando',
  error_bot: 'El bot falló',
};

export interface MarcaBot {
  tono: TonoBot;
  /** Lo que se lee en el chip. Corto: la fila mide 360 px y ya lleva mucho. */
  texto: string;
  /** El `title`, donde entra el detalle sin gastar ancho. */
  titulo: string;
}

/** Lo mínimo que la marca necesita de una fila de la cola. */
export interface FilaConBot {
  bot_escalada?: boolean | null;
  bot_temperatura?: string | null;
  bot_motivo?: string | null;
}

export function marcaDelBot(fila: FilaConBot): MarcaBot | null {
  const motivo = (fila.bot_motivo ?? '').trim();

  if (fila.bot_escalada === true) {
    // La escalada gana siempre, incluso sobre «caliente»: una está esperando a
    // una persona y la otra no. Si el motivo no está en la tabla, el chip dice
    // el hecho que sí se sabe —que el bot se frenó— en vez de callarse.
    const lectura = LECTURA_ESCALADA[motivo];
    return {
      tono: 'escalada',
      texto: lectura ?? 'Pidió ayuda',
      titulo: lectura
        ? `El bot se frenó y espera a una persona: ${lectura.toLowerCase()}`
        : 'El bot se frenó y espera a una persona',
    };
  }

  if (fila.bot_temperatura === 'caliente') {
    return {
      tono: 'caliente',
      texto: 'Caliente',
      // El motivo de `calificar` lo escribe el modelo en texto libre: sirve como
      // detalle en el `title`, nunca como rótulo del chip (puede ser una frase).
      titulo: motivo ? `El bot la ve caliente: ${motivo}` : 'El bot la ve caliente',
    };
  }

  return null;
}
