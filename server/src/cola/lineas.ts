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
}

export interface RecorteDeLineas {
  /** Los números propios a los que se acota. **Vacío = todas**, como siempre. */
  lineas: string[];
  /** Se pidió «las mías» y el mapa no le asigna ninguna: se sirvió TODO, y se dice. */
  sinLineasPropias: boolean;
}

export function recorteDeLineas(pedido: PedidoDeLineas): RecorteDeLineas {
  const linea = (pedido.linea ?? "").trim();

  // Lo explícito le gana a lo implícito: si tocó «Walter» en el selector, quiere
  // ver Walter aunque Walter no sea suyo. Es la misma precedencia de todo el
  // repo (un mapeo por `adId` le gana al título inferido, lo manual le gana a lo
  // derivado): lo que una persona afirmó vale más que lo que una tabla dedujo.
  if (linea) return { lineas: [linea], sinLineasPropias: false };

  if (!pedido.misLineas) return { lineas: [], sinLineasPropias: false };

  // Ordenadas y sin repetidos: el `IN (...)` sale igual para el mismo conjunto,
  // así el plan de Postgres y el caché del front no dependen del orden en que
  // Cerberus insertó las filas.
  const asignadas = [...new Set((pedido.asignadas ?? []).map((n) => n.trim()).filter(Boolean))].sort();
  if (asignadas.length === 0) return { lineas: [], sinLineasPropias: true };
  return { lineas: asignadas, sinLineasPropias: false };
}
