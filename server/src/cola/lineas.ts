/**
 * A QUÉ LÍNEAS SE ACOTA LA COLA — la regla, pura y en un solo lugar (#50 + el
 * frente de `numero_vendedora`).
 *
 * ── Por qué es UNA sola función y no dos caminos ──
 * Hay dos formas de NOMBRAR el mismo recorte: el selector de línea («solo lo de
 * Walter», `?linea=`) y «las mías» (`?mias=1`, que resuelve el mapa
 * `numero_vendedora`). Son dos maneras de decir lo mismo, así que hay un solo
 * recorte y una sola implementación — si cada una armara su propio `WHERE`,
 * mañana una dejaría caer los comentarios de FB/IG y la otra no, y la cola
 * mostraría cosas distintas según por dónde se pidió (la lección de #37).
 *
 * ── FAIL-OPEN, y es la decisión que hace que esto sirva o rompa ──
 * Una vendedora SIN filas en `numero_vendedora` ve TODO. Si no, la primera que
 * se loguee después del deploy abre una cola vacía y lo que ve es «se perdieron
 * las conversaciones», no «no tenés líneas asignadas». El mapa lo puebla
 * Cerberus y puede estar incompleto en cualquier momento: un mapa incompleto
 * tiene que degradar en «ves de más», nunca en «no ves nada».
 *
 * Y el «se sirvió todo» no se traga: sale en `sinLineasPropias` para que la
 * pantalla lo pueda decir. Un filtro que no filtra y no avisa es exactamente el
 * defecto que la ruta ya evita con el 400 de `?linea=` inválida.
 *
 * ── ES UN FILTRO, NO UN PERMISO ── (ver `db/schema.ts` §numeroVendedora)
 * Acota lo que se MIRA, no lo que se puede mirar. El porqué está escrito en el
 * schema y en el CLAUDE.md: Hermes no tiene modelo de permisos —
 * `requiereVendedora` dice «es una vendedora», no «cuál»— y todo el resto de la
 * API (el hilo, la ficha, el envío) sigue sirviendo cualquier conversación a
 * cualquier token. Un recorte de cola que se presentara como permiso sería una
 * frontera imaginaria: peor que ninguna, porque se le cree.
 */

export interface PedidoDeLineas {
  /** La línea elegida a mano en el selector, ya normalizada por la ruta. */
  linea?: string;
  /** «Las mías»: acotar a lo que `numero_vendedora` le asigna a quien mira. */
  misLineas?: boolean;
  /** Lo que el mapa dice HOY de esta vendedora (`numeros/repositorio.ts`). */
  asignadas?: readonly string[];
  /**
   * ¿Esta persona ve SOLO sus líneas, sin la opción de mirar el resto?
   *
   * Lo prende `soloSusLineas` cuando alguna de sus líneas es de **campaña**
   * (`numeros_wa.proposito`). Un operador del comando de un candidato no tiene
   * nada que hacer en la cola de la Escuela, y al revés tampoco.
   *
   * ⚠️ **SIGUE SIENDO UN FILTRO, NO UN PERMISO** — y esto hay que decirlo cada
   * vez, porque es justo el recorte que se ve como una frontera. `/conversacion`,
   * la ficha y el envío siguen sirviendo cualquier conversación a cualquier
   * token: lo que cambia es qué se OFRECE y qué trae la cola, no qué se puede
   * pedir. Presentarlo como aislamiento sería una frontera imaginaria, peor que
   * ninguna porque se le cree.
   */
  exclusivas?: boolean;
}

/** El propósito que hace exclusiva a una línea. Lo empuja Cerberus. */
export const PROPOSITO_CAMPANA = "campana";

/**
 * ¿La persona que mira ve SOLO sus líneas?
 *
 * El criterio es el **propósito de la línea**, no una lista de usuarios a mano:
 * el dato ya existe, lo mantiene quien da de alta el número, y no hay una
 * segunda lista que se pueda desincronizar. Quien no tiene ninguna línea de
 * campaña se comporta EXACTAMENTE como antes de este cambio — las vendedoras de
 * la Escuela siguen viendo todo, que es lo que hoy necesitan.
 */
export function soloSusLineas(
  asignadas: readonly { proposito: string }[] | undefined,
): boolean {
  return (asignadas ?? []).some((l) => l.proposito === PROPOSITO_CAMPANA);
}

export interface RecorteDeLineas {
  /** Los números propios a los que se acota. **Vacío = todas**, como siempre. */
  lineas: string[];
  /** Se pidió «las mías» y el mapa no le asigna ninguna: se sirvió TODO, y se dice. */
  sinLineasPropias: boolean;
}

export function recorteDeLineas(pedido: PedidoDeLineas): RecorteDeLineas {
  const linea = (pedido.linea ?? "").trim();

  // ── EXCLUSIVA: el recorte le gana al selector, y ese orden ES el recorte ──
  // Abajo, una `?linea=` explícita gana porque «lo que una persona afirmó vale
  // más que lo que una tabla dedujo». Acá se invierte a propósito: si el
  // selector pudiera nombrar una línea ajena, el recorte se saltearía con un
  // query-param y no recortaría nada. Una `?linea=` que SÍ es suya se respeta
  // —es elegir entre las propias, que es para lo que está el selector.
  if (pedido.exclusivas) {
    const propias = normalizar(pedido.asignadas);
    // Sin asignadas no se puede saber cuáles son «las suyas». Se cae al
    // comportamiento de siempre (fail-open) en vez de servir una cola vacía:
    // el mapa lo puebla Cerberus y puede estar incompleto en cualquier momento.
    if (propias.length === 0) return { lineas: [], sinLineasPropias: true };
    if (linea && propias.includes(linea)) return { lineas: [linea], sinLineasPropias: false };
    return { lineas: propias, sinLineasPropias: false };
  }

  // Lo explícito le gana a lo implícito: si tocó «Walter» en el selector, quiere
  // ver Walter aunque Walter no sea suyo. Es la misma precedencia de todo el
  // repo (un mapeo por `adId` le gana al título inferido, lo manual le gana a lo
  // derivado): lo que una persona afirmó vale más que lo que una tabla dedujo.
  if (linea) return { lineas: [linea], sinLineasPropias: false };

  if (!pedido.misLineas) return { lineas: [], sinLineasPropias: false };

  const asignadas = normalizar(pedido.asignadas);
  if (asignadas.length === 0) return { lineas: [], sinLineasPropias: true };
  return { lineas: asignadas, sinLineasPropias: false };
}

/**
 * Ordenadas y sin repetidos: el `IN (...)` sale igual para el mismo conjunto,
 * así el plan de Postgres y el caché del front no dependen del orden en que
 * Cerberus insertó las filas.
 */
function normalizar(asignadas: readonly string[] | undefined): string[] {
  return [...new Set((asignadas ?? []).map((n) => n.trim()).filter(Boolean))].sort();
}
