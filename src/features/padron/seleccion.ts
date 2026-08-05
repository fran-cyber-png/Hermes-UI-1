/**
 * QUÉ ESTÁ ELEGIDO — y por qué no alcanza una lista de ids.
 *
 * Elegir «los 17.014 de este recorte» no se puede representar con los ids: son
 * 700 KB que el navegador no tiene (solo bajó 50) y que no hacen falta, porque
 * el server puede resolver el recorte con una consulta. Pero destildar tres a
 * mano después de marcar todo SÍ es una lista.
 *
 * De ahí las dos formas, y son excluyentes a propósito:
 *
 *   · `lista`   → «estos que fui tildando». Los ids viajan.
 *   · `recorte` → «todo lo filtrado, menos estos». Viaja el FILTRO y los excluidos.
 *
 * Modelarlo como un booleano `todos` al lado de un array fue la primera versión y
 * se descarta: deja representar «todos = true con 3 ids sueltos», que no
 * significa nada y que la pantalla tendría que interpretar en cada lugar donde
 * la mira.
 */

export type Seleccion =
  | { modo: 'lista'; ids: number[] }
  | { modo: 'recorte'; excluidos: number[] };

export const NADA: Seleccion = { modo: 'lista', ids: [] };

/**
 * Cuántos hay elegidos.
 *
 * En modo recorte se calcula contra el total del SERVER, no contra lo que se ve:
 * la pantalla muestra 50 filas y lo elegido son 17.014. El `Math.max(0, …)` no es
 * paranoia — el total llega de una consulta anterior y los excluidos se acumulan
 * en el navegador, así que un refresco a destiempo puede dejarlos cruzados por un
 * instante, y «−2 contactos elegidos» es peor que un cero.
 */
export function cuantos(s: Seleccion, totalDelRecorte: number): number {
  return s.modo === 'lista' ? s.ids.length : Math.max(0, totalDelRecorte - s.excluidos.length);
}

export function hayAlgo(s: Seleccion, totalDelRecorte: number): boolean {
  return cuantos(s, totalDelRecorte) > 0;
}

/** ¿Esta fila está elegida? En modo recorte lo está salvo que se la haya sacado. */
export function estaElegido(s: Seleccion, id: number): boolean {
  return s.modo === 'lista' ? s.ids.includes(id) : !s.excluidos.includes(id);
}

/**
 * Tilda o destilda UNA fila.
 *
 * ⚠️ Destildar en modo recorte **no rompe el modo**: sigue siendo «todo lo
 * filtrado menos estos». Volver a `lista` con los ids de la página sería el bug
 * clásico —el supervisor destilda uno de 17.014 y se queda con los 49 visibles—,
 * y no habría ningún síntoma hasta ver el acuse.
 */
export function alternarFila(s: Seleccion, id: number): Seleccion {
  if (s.modo === 'lista') {
    return {
      modo: 'lista',
      ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id],
    };
  }
  return {
    modo: 'recorte',
    excluidos: s.excluidos.includes(id) ? s.excluidos.filter((x) => x !== id) : [...s.excluidos, id],
  };
}

/** Tilda o destilda la página entera (la casilla de la cabecera). */
export function alternarPagina(s: Seleccion, idsDeLaPagina: number[], prender: boolean): Seleccion {
  if (s.modo === 'recorte') {
    // En modo recorte, «destildar la página» es excluir esas filas; «tildarla» es
    // dejar de excluirlas. El modo no cambia.
    return {
      modo: 'recorte',
      excluidos: prender
        ? s.excluidos.filter((x) => !idsDeLaPagina.includes(x))
        : [...new Set([...s.excluidos, ...idsDeLaPagina])],
    };
  }
  return {
    modo: 'lista',
    ids: prender
      ? [...new Set([...s.ids, ...idsDeLaPagina])]
      : s.ids.filter((x) => !idsDeLaPagina.includes(x)),
  };
}

/** «Seleccionar los 17.014» — el salto de la página al recorte entero. */
export function todoElRecorte(): Seleccion {
  return { modo: 'recorte', excluidos: [] };
}

/**
 * ¿Ofrecer el salto a «todo el recorte»?
 *
 * Solo cuando la página está entera tildada Y hay más afuera. Ofrecerlo siempre
 * sería ruido; ofrecerlo sin que la página esté completa invita a saltar de 3
 * elegidos a 17.014, que es un accidente esperando.
 */
export function ofrecerElRecorte(
  s: Seleccion,
  idsDeLaPagina: number[],
  total: number,
): boolean {
  if (s.modo === 'recorte') return false;
  if (idsDeLaPagina.length === 0) return false;
  if (total <= idsDeLaPagina.length) return false;
  return idsDeLaPagina.every((id) => s.ids.includes(id));
}

/**
 * A partir de cuántos se pide confirmar antes de repartir.
 *
 * La regla dura #7 pide la lista de destinatarios a la vista, y a partir de cierto
 * tamaño eso es imposible por definición: nadie revisa 500 filas. El número no
 * bloquea —repartir 17.014 es decisión del supervisor— pero deja de ser un clic
 * suelto y pasa a ser una confirmación con la cifra escrita.
 */
export const CONFIRMAR_DESDE = 500;

export function necesitaConfirmar(cantidad: number): boolean {
  return cantidad >= CONFIRMAR_DESDE;
}
