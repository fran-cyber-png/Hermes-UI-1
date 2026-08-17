/**
 * CÓMO SE DIBUJA LA VENTANA DE CONVERSACIÓN — puro, fuera del JSX.
 *
 * El server manda el INSTANTE del cierre (`ventana_cierra`, de `cola/ventana.ts`)
 * y acá se decide qué se lee. Vive afuera del componente por el motivo de
 * siempre: un `if` adentro del JSX no se puede interrogar sobre el caso que
 * todavía no pasó —el minuto antes del cierre, el server viejo que no manda el
 * campo— y esos son justo los que importan.
 *
 * ── LA SEÑAL ES POSITIVA, Y ESO DECIDE EL DISEÑO ──────────────────────────
 * Una ventana CERRADA no dibuja nada **en la cola**. No es un olvido: el plazo es
 * duro solo en la línea de la Cloud API, y en una línea whatsmeow Meta no rechaza
 * nada. Una píldora que dijera «cerrada» sería falsa ahí, y lo que se pierde con
 * esa mentira es una venta que nadie intenta. En la cola se dice a quién SÍ se le
 * puede hablar, nunca a quién no — **y eso no cambia** (ADR 0041).
 *
 * ── LA ENMIENDA, Y POR QUÉ NO CONTRADICE LO DE ARRIBA (ADR 0058) ──────────
 * Lo que la regla de arriba protege es no MENTIR sobre una línea donde el plazo
 * no existe. La fila de la cola no sabe por qué línea va a salir la respuesta;
 * **el composer sí** (`numeroPropio` → `transporte` de `/api/whatsapp/sesion`).
 * Donde se sabe que el plazo es duro, callarlo no es prudencia: es dejar que el
 * mensaje rebote. Por eso `avisoDeComposer` puede decir «cerrada» y
 * `lecturaDeVentana` sigue sin poder — no es la misma pregunta ni el mismo lugar.
 *
 * Lo que lo volvió urgente, medido el 17-ago-2026: los dos únicos envíos manuales
 * fallidos de dos semanas fueron ventana vencida, a 28,3 h y a **24,5 h** del
 * último entrante. El segundo se pasó **por media hora** y nadie tenía cómo
 * saberlo: el aviso no existía y el rechazo llegaba mudo.
 *
 * ── EL ORO ────────────────────────────────────────────────────────────────
 * Acá el oro SÍ corresponde, y es de los pocos lugares: en esta app significa
 * **tiempo que se acaba** y nada más (`src/index.css`). Una ventana con menos de
 * `UMBRAL_ORO_MS` es exactamente eso. Arriba de ese umbral va en tinta neutra —
 * si todo lo abierto fuera dorado, el oro dejaría de querer decir «ahora».
 */

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** Debajo de esto la ventana se dibuja en oro: queda menos de una mañana. */
export const UMBRAL_ORO_MS = 3 * HORA;

export interface LecturaVentana {
  /** Lo que se lee en la píldora: «45 min», «6 h», «3 d». */
  texto: string;
  /** Queda poco: se pinta en oro. */
  urgente: boolean;
  /** El texto largo del `title`, que es donde se explica el plazo. */
  ayuda: string;
}

/**
 * Cuánto falta, en criollo. **Redondea para ABAJO** a propósito: con 6 h 50 min
 * dice «6 h». Un redondeo para arriba prometería tiempo que no hay, y el error
 * que importa acá es el que llega tarde. Nunca dice «0 min» — el último minuto
 * sigue siendo un minuto.
 */
export function cuantoFalta(ms: number): string {
  if (ms >= DIA) return `${Math.floor(ms / DIA)} d`;
  if (ms >= HORA) return `${Math.floor(ms / HORA)} h`;
  return `${Math.max(1, Math.floor(ms / MINUTO))} min`;
}

/**
 * QUÉ DICE LA PÍLDORA, o `null` si no se dibuja nada.
 *
 * `null` en los tres casos que se ven igual en pantalla y son distintos abajo, y
 * está bien que se vean igual: **la ausencia de señal no afirma nada**.
 *   · la ventana está cerrada (se dice a quién sí, no a quién no);
 *   · esta conversación no tiene ventana (un comentario de un canal sin plazo);
 *   · el server no manda el campo todavía (N4 va solo, N5 es un botón: hay una
 *     ventana de deploy donde el front nuevo habla con el server viejo).
 */
export function lecturaDeVentana(
  ventanaCierra: string | null | undefined,
  ahora: Date,
): LecturaVentana | null {
  if (!ventanaCierra) return null;

  const cierra = new Date(ventanaCierra).getTime();
  // Una fecha que no se puede leer no inventa una cuenta regresiva.
  if (Number.isNaN(cierra)) return null;

  const falta = cierra - ahora.getTime();
  if (falta <= 0) return null;

  return {
    texto: cuantoFalta(falta),
    urgente: falta < UMBRAL_ORO_MS,
    ayuda: `Se le puede escribir: la ventana cierra en ${cuantoFalta(falta)}`,
  };
}

/** Qué le decimos a quien está por escribir. `null` = nada, y es el default. */
export type AvisoDeComposer = {
  /** `cerrada` es un hecho consumado; `por-cerrar` todavía se puede aprovechar. */
  clase: 'cerrada' | 'por-cerrar';
  texto: string;
} | null;

/**
 * EL AVISO ARRIBA DE LA CAJA DE ESCRIBIR (ADR 0058).
 *
 * ── AVISA, NO BLOQUEA — y la razón no es estilo ──────────────────────────
 * El cierre se calcula sobre el último entrante que Hermes CONOCE. Si la ingesta
 * se perdió un mensaje —ya pasó—, Hermes cree cerrada una ventana que está
 * abierta, y un bloqueo le impediría contestar a alguien que sí podía recibir.
 * Un aviso que a veces sobra cuesta una línea de más; un bloqueo que a veces
 * sobra cuesta la venta. **La garantía nunca es el front**: quien rechaza es
 * Meta, y ahora eso se lee en la burbuja (`whatsapp/motivoEntrega.ts`).
 *
 * ── SOLO EN LA LÍNEA DONDE EL PLAZO ES DURO ──────────────────────────────
 * `cloud-api` y nada más. En `whatsmeow` Meta no rechaza por ventana (el riesgo
 * ahí es el ban, que es otra conversación) y en `falso` no se manda a nadie.
 * ⚠️ **Un `transporte` ausente es un server viejo y NO avisa**: es preferible
 * quedarse como antes del frente a inventar una prohibición que quizá no rige.
 */
export function avisoDeComposer(
  ventanaCierra: string | null | undefined,
  transporte: 'whatsmeow' | 'cloud-api' | 'falso' | undefined,
  ahora: Date,
): AvisoDeComposer {
  if (transporte !== 'cloud-api') return null;
  if (!ventanaCierra) return null;

  const cierra = new Date(ventanaCierra).getTime();
  // Una fecha ilegible no autoriza a afirmar nada, en ninguno de los dos sentidos.
  if (Number.isNaN(cierra)) return null;

  const falta = cierra - ahora.getTime();
  if (falta <= 0) {
    return {
      clase: 'cerrada',
      texto:
        'Pasaron más de 24 h desde su último mensaje: WhatsApp va a rechazar lo que escribas acá. Solo entra una plantilla aprobada.',
    };
  }
  if (falta < UMBRAL_ORO_MS) {
    // Se nombra el plazo, no solo el reloj: «queda 1 h» no dice qué se cierra ni
    // qué pasa después, y eso es justo lo que nadie sabía.
    return {
      clase: 'por-cerrar',
      texto: `Queda ${cuantoFalta(falta)} de la ventana de 24 h. Después solo entra una plantilla aprobada.`,
    };
  }
  return null;
}
