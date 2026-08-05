import { esDespedida, huboRechazo } from "../autorespuesta/rechazo.js";

/**
 * A QUIÉN LE CORRESPONDE UNA CAMPAÑA — puro, y separado del script a propósito.
 *
 * ══ POR QUÉ ESTO SALIÓ DE `scripts/campana.ts` ══════════════════════════════
 *
 * El 4-ago-2026 salió la primera campaña real: 88 personas. El filtro de
 * rechazo vivía adentro de `main()` como cuatro `.filter()` sueltos, sin un
 * solo test, y le pasaba a `huboRechazo` **únicamente el primer mensaje** de
 * cada conversación:
 *
 *     if (huboRechazo([d.primerMensaje])) conRechazo.add(d.telefono);
 *
 * `huboRechazo(textos[])` está escrita para mirar la conversación ENTERA
 * (`textos.some(expresaRechazo)`). Con un solo texto, quien saludó con «Hola»
 * y dijo «Ya no quiero» tres mensajes después **calificaba como público**.
 *
 * Medido sobre los 88 que ya salieron: el filtro que corrió detectó **0**
 * rechazos y el correcto detecta **2** — `«Ya no quiero»` y `«no»`. Dos
 * personas que habían dicho que no recibieron una promoción. Es poco en
 * porcentaje y es indefendible en criterio: «nunca a quien dijo que no» es una
 * de las condiciones escritas con las que la auto-respuesta se ganó su
 * excepción a «un envío = una acción humana» (ADR 0015).
 *
 * ══ LAS TRES FORMAS DE DECIR QUE NO SE PREGUNTAN LAS TRES ═══════════════════
 *
 * `rechazo.ts` distingue tres, y el script sólo usaba una:
 *
 *   · el **rechazo explícito** y el **no con motivo** — `huboRechazo`, sobre
 *     TODOS los mensajes, porque un «no me interesa» del quinto mensaje vale
 *     igual que uno del primero;
 *   · el **cierre cortés** — `esDespedida`, sobre el ÚLTIMO solamente, porque
 *     una despedida describe cómo terminó la conversación, no cómo empezó.
 *     («gracias» a secas NO es una despedida; eso lo decide `rechazo.ts`.)
 *
 * No se escribe un criterio nuevo: se reusa el que ya tiene tests y está
 * sesgado al falso negativo a propósito.
 *
 * ══ ESTO NO ALCANZA, Y POR ESO EXISTE `vetoAlSalir.ts` ══════════════════════
 *
 * Todo lo de acá se evalúa UNA vez, al planificar. Un lote de 88 con 30 s de
 * espera dura una hora y media; con ritmo real, varias horas. En esa ventana
 * alguien puede contestar «sacame de esta lista» y recibir el flyer igual,
 * porque su lugar en la fila se decidió antes de que hablara.
 *
 * **Un veto sobre una persona se evalúa en el instante del envío.** Este
 * módulo arma el público; `vetoAlSalir.ts` lo vuelve a preguntar fila por fila.
 * Los dos hacen falta: sin éste el lote sería enorme, sin aquél sería viejo.
 */

/** Un candidato, con los hechos crudos que la selección necesita. */
export interface Candidato {
  telefono: string;
  /** TODOS sus mensajes entrantes, en orden. No sólo el primero (ver cabecera). */
  mensajes: readonly (string | null | undefined)[];
  /** El anuncio por el que llegó. `null` = entró por otra vía. */
  anuncio: string | null;
  /** Ya recibió ESTA pieza en una corrida anterior. */
  yaLeLlego: boolean;
  /** Tiene una compra que la respalda (`icarus.sales`, nunca `n_purchases`). */
  yaCompro: boolean;
}

/**
 * POR QUÉ ALGUIEN NO ENTRA. Es una lista cerrada: un motivo que no está acá no
 * se puede descartar en silencio, y el simulacro los imprime todos agrupados.
 */
export const MOTIVOS_DE_DESCARTE = [
  "rechazo",
  "despedida",
  "ya_compro",
  "sin_anuncio",
  "ya_le_llego",
] as const;
export type MotivoDeDescarte = (typeof MOTIVOS_DE_DESCARTE)[number];

export interface Descartado {
  telefono: string;
  motivo: MotivoDeDescarte;
}

export interface Seleccion {
  /** A quién le corresponde el mensaje (aunque ya lo haya recibido). */
  publico: Candidato[];
  /** A quién se le manda: el público menos quien ya lo recibió, hasta el tope. */
  elegibles: Candidato[];
  /**
   * A QUIÉN SE LE ASIGNA LA CONVERSACIÓN — y no es `publico`.
   *
   * ⚠️ Acá había un defecto que sólo se ve cuando hay `tope`, y se vio con la
   * campaña del Foro: el script asignaba sobre `publico` entero y anunciaba
   * «3.069 conversaciones · las 1.000 que reciben el mensaje MÁS las 2.069 que
   * ya lo habían recibido». Las 2.069 **no habían recibido nada**: eran las que
   * el tope dejó afuera. El texto era falso y la asignación, peor — le ponía
   * dueña a dos mil personas a las que nadie les escribió, y esa dueña las ve
   * en «Míos» como trabajo suyo.
   *
   * Lo que justifica asignar sin mandar es una sola cosa: **que el mensaje ya
   * haya salido** en una corrida anterior, porque cuando esa persona conteste
   * tiene que caer en la cola de alguien. Recortar por tope no es eso.
   *
   * `aAsignar` = los que reciben ahora + los que ya lo recibieron antes.
   */
  aAsignar: Candidato[];
  descartados: Descartado[];
}

export interface OpcionesDeSeleccion {
  /** Sólo quienes llegaron por un anuncio. Default `true`. */
  soloDeAnuncio?: boolean;
  /** Excluir a quien ya compró. Default `true`. */
  excluirClientes?: boolean;
  /** Techo de destinatarios de esta corrida. */
  tope?: number;
}

/**
 * EL ORDEN DE LOS DESCARTES IMPORTA, y no es estético.
 *
 * Cada persona sale con UN motivo, el primero que la agarra. El orden va de lo
 * más grave a lo más circunstancial: que alguien «dijo que no» explica mejor
 * por qué no le escribimos que «no vino de un anuncio», aunque las dos sean
 * verdad. Con el orden al revés, el simulacro reportaría 40 «sin_anuncio» y
 * ningún rechazo, y nadie miraría dos veces.
 */
export function elegirPublico(
  candidatos: readonly Candidato[],
  opciones: OpcionesDeSeleccion = {},
): Seleccion {
  const soloDeAnuncio = opciones.soloDeAnuncio ?? true;
  const excluirClientes = opciones.excluirClientes ?? true;

  const publico: Candidato[] = [];
  const descartados: Descartado[] = [];
  const yaLoRecibieron: Candidato[] = [];

  for (const c of candidatos) {
    const motivo = motivoDeDescarte(c, { soloDeAnuncio, excluirClientes });
    if (motivo !== null) {
      descartados.push({ telefono: c.telefono, motivo });
      continue;
    }
    // El público incluye a quien ya lo recibió: la conversación es suya igual, y
    // dejarla sin dueña porque el envío llegó primero es al revés de lo que hace
    // falta cuando conteste.
    publico.push(c);
    if (c.yaLeLlego) yaLoRecibieron.push(c);
  }

  // `ya_le_llego` se reporta como descarte del ENVÍO, no del público.
  for (const c of yaLoRecibieron) descartados.push({ telefono: c.telefono, motivo: "ya_le_llego" });

  const sinRepetir = publico.filter((c) => !c.yaLeLlego);
  const elegibles = opciones.tope === undefined ? sinRepetir : sinRepetir.slice(0, opciones.tope);

  // Los que reciben ahora, más los que ya lo habían recibido — nunca los que el
  // tope dejó afuera. Ver el comentario de `aAsignar` en `Seleccion`.
  return { publico, elegibles, aAsignar: [...elegibles, ...yaLoRecibieron], descartados };
}

function motivoDeDescarte(
  c: Candidato,
  o: { soloDeAnuncio: boolean; excluirClientes: boolean },
): MotivoDeDescarte | null {
  // TODOS los mensajes, no el primero. Ese era el defecto.
  if (huboRechazo(c.mensajes)) return "rechazo";
  // Sólo el último: una despedida dice cómo TERMINÓ la conversación.
  if (esDespedida(c.mensajes[c.mensajes.length - 1])) return "despedida";
  if (o.excluirClientes && c.yaCompro) return "ya_compro";
  if (o.soloDeAnuncio && !c.anuncio) return "sin_anuncio";
  return null;
}

/** Cuántos cayeron por cada motivo, para el renglón del simulacro. */
export function contarPorMotivo(descartados: readonly Descartado[]): Record<MotivoDeDescarte, number> {
  const cuenta = Object.fromEntries(MOTIVOS_DE_DESCARTE.map((m) => [m, 0])) as Record<
    MotivoDeDescarte,
    number
  >;
  for (const d of descartados) cuenta[d.motivo]++;
  return cuenta;
}
