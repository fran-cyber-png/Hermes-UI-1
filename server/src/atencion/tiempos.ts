/**
 * CUÁNTO TARDAMOS EN CONTESTARLE A ALGUIEN QUE ESCRIBIÓ.
 *
 * ══ POR QUÉ ESTO SE MIDE DESDE HOY Y NO SE PUEDE RECONSTRUIR DESPUÉS ════════
 *
 * El tiempo de atención es un dato de FLUJO: existe mientras la espera está
 * abierta. Una vez que alguien contesta —o que la persona se va— la pregunta
 * «¿cuánto la hicimos esperar?» sólo se puede responder si quedaron guardados
 * los dos extremos. Los dos ya están (`interactions` y `envios_wa`); lo que
 * faltaba era la regla que los junta, y esa regla es este archivo.
 *
 * Se escribió el 4-ago-2026, cuando la campaña 3x1 salió a 88 personas y la
 * primera respuesta —«Quiero el paquete», al minuto— quedó sin contestar. La
 * decisión del dueño fue explícita: *«ya se encargarán de atenderlos, para eso
 * monitoreamos los tiempos para después decirle con pruebas»*. Esto es esas
 * pruebas.
 *
 * ══ LAS TRES REGLAS, Y EL DEFECTO QUE CADA UNA EVITA ════════════════════════
 *
 * **1 · La espera arranca en el PRIMER mensaje de la seguidilla, no en el
 * último.** Alguien que escribe a las 9:00, 9:01 y 9:02 y recibe respuesta a
 * las 9:30 esperó **30 minutos**, no 28. Medir desde el último premia
 * exactamente al caso peor: cuanto más insiste alguien porque nadie le
 * contesta, más corta se ve la espera.
 *
 * **2 · Una máquina NO cierra una espera.** El acuse nocturno (ADR 0015), la
 * plantilla de una campaña y —el día que se prenda— el bot, son mensajes
 * NUESTROS que no son atención. Si contaran, la métrica diría que atendemos en
 * un minuto justo la noche en que nadie miró el CRM. Tampoco la reinician: la
 * persona sigue esperando a un humano, y el reloj sigue corriendo.
 *
 * **3 · Lo que sigue sin respuesta NO se descarta: se cuenta aparte.** Es la
 * regla que decide si el número sirve o miente. Con 50 esperas de las que se
 * contestaron 5, la mediana de esas 5 es una mediana de nuestros mejores
 * casos — y presentada sola dice lo contrario de lo que pasó. Por eso
 * `Mediana` no se puede construir sin `sobre` y `de`: el tipo lo impide, no
 * una convención (mismo criterio que `Medicion` en `resultados/medicion.ts`).
 *
 * ══ LO QUE ESTE MÓDULO NO AFIRMA ════════════════════════════════════════════
 *
 * No dice si la respuesta fue BUENA, ni si la venta se cerró, ni de quién es
 * la culpa de una demora. Mide una sola cosa: cuánto pasó entre que la persona
 * escribió y que una persona nuestra le contestó. Los nombres no prometen más
 * que eso, a propósito.
 */

/** Quién mandó un saliente. Sólo `persona` cuenta como atención. */
export type QuienMando = "persona" | "maquina";

export interface MensajeDelHilo {
  cuando: Date;
  direccion: "entrante" | "saliente";
  /** Sólo en salientes. En un entrante se ignora. */
  quien?: QuienMando;
}

/** Una vez que alguien escribió y quedó esperando. */
export interface Espera {
  /** Cuándo empezó a esperar (su PRIMER mensaje sin responder). */
  escribioEn: Date;
  /** Minutos hasta la primera respuesta humana. `null` = todavía espera. */
  minutos: number | null;
}

const MS_POR_MINUTO = 60_000;

/**
 * Las esperas de UN hilo, en orden.
 *
 * `mensajes` tiene que venir ordenado por fecha; ordenarlo acá escondería que
 * la consulta no lo hizo, y una consulta sin `ORDER BY` es un defecto que se
 * paga en otro lado.
 */
export function esperasDelHilo(mensajes: readonly MensajeDelHilo[], ahora: Date): Espera[] {
  const esperas: Espera[] = [];
  let esperandoDesde: Date | null = null;

  for (const m of mensajes) {
    if (m.direccion === "entrante") {
      // Regla 1: sólo el primero de la seguidilla abre la espera.
      if (esperandoDesde === null) esperandoDesde = m.cuando;
      continue;
    }
    // Regla 2: una máquina no cierra nada, y tampoco reinicia el reloj.
    if (m.quien !== "persona") continue;
    if (esperandoDesde === null) continue; // saliente sin nadie esperando: no es respuesta
    esperas.push({
      escribioEn: esperandoDesde,
      minutos: (m.cuando.getTime() - esperandoDesde.getTime()) / MS_POR_MINUTO,
    });
    esperandoDesde = null;
  }

  // Regla 3: la que sigue abierta es un dato, no un hueco.
  if (esperandoDesde !== null) esperas.push({ escribioEn: esperandoDesde, minutos: null });
  return esperas;
}

/**
 * UNA MEDIANA NO SE PUEDE SERIALIZAR SIN SU DENOMINADOR.
 *
 * `sobre` son las esperas respondidas (las únicas que tienen duración) y `de`
 * son todas. Cuando `sobre` es una fracción chica de `de`, la mediana describe
 * a los que tuvieron suerte y a nadie más.
 */
export interface Mediana {
  minutos: number;
  sobre: number;
  de: number;
}

export interface ResumenDeAtencion {
  esperas: number;
  respondidas: number;
  sinResponder: number;
  /** `null` cuando no se respondió ni una: no hay mediana de un conjunto vacío. */
  mediana: Mediana | null;
  p90: Mediana | null;
  /** La espera abierta más vieja, en minutos. Es la que hay que atender ya. */
  masViejaSinResponder: number | null;
  /** Respondidas dentro de cada tramo. Acumulativos. */
  en5Min: number;
  en1Hora: number;
  en24Horas: number;
}

function percentil(ordenados: readonly number[], p: number): number {
  // Rango más cercano: con pocas muestras es el que menos inventa.
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, i)];
}

export function resumirAtencion(esperas: readonly Espera[], ahora: Date): ResumenDeAtencion {
  const conMinutos = esperas
    .map((e) => e.minutos)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);

  const abiertas = esperas.filter((e) => e.minutos === null);
  const masVieja = abiertas.reduce<number | null>((peor, e) => {
    const edad = (ahora.getTime() - e.escribioEn.getTime()) / MS_POR_MINUTO;
    return peor === null || edad > peor ? edad : peor;
  }, null);

  const de = esperas.length;
  const sobre = conMinutos.length;
  const conDenominador = (minutos: number): Mediana => ({ minutos, sobre, de });

  return {
    esperas: de,
    respondidas: sobre,
    sinResponder: abiertas.length,
    mediana: sobre === 0 ? null : conDenominador(percentil(conMinutos, 50)),
    p90: sobre === 0 ? null : conDenominador(percentil(conMinutos, 90)),
    masViejaSinResponder: masVieja,
    en5Min: conMinutos.filter((m) => m <= 5).length,
    en1Hora: conMinutos.filter((m) => m <= 60).length,
    en24Horas: conMinutos.filter((m) => m <= 1440).length,
  };
}
