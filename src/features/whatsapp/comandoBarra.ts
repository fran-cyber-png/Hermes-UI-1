/**
 * EL `/` EN EL COMPOSER — dónde empieza y dónde termina el comando.
 *
 * Vive afuera del componente por lo de siempre (ADR 0024): esto es una máquina
 * de bordes, y los bordes son casi toda la superficie. Adentro de un `onChange`
 * no se puede interrogar «¿y si escribe una fecha 12/08?», «¿y si el cursor está
 * atrás del `/`?», «¿y si hay dos barras?». Acá sí.
 *
 * ── LA REGLA, Y POR QUÉ NO ES «EL TEXTO EMPIEZA CON /» ──────────────────────
 *
 * Un comando es una barra **pegada al principio de una palabra** —principio del
 * texto, o después de un espacio o un salto de línea— y lo que le sigue hasta el
 * cursor. Con la regla ingenua («empieza con /»), escribir «el link es
 * https://pagos...» abriría el selector en medio de una URL, y «12/08» también.
 * Con esta regla, no: la barra de una URL viene pegada a una letra o a `:`.
 *
 * ── Y POR QUÉ SE MIRA EL CURSOR Y NO EL FINAL DEL TEXTO ─────────────────────
 *
 * La vendedora escribe el mensaje entero, se da cuenta de que quiere meter el
 * dato de las cuotas al principio, y vuelve con las flechas. Si el comando se
 * buscara al final del texto, ahí no pasaría nada. El tramo `[desde, hasta)` es
 * lo que se reemplaza al elegir, y por eso viaja: sin él habría que volver a
 * encontrarlo, y esa segunda búsqueda es la que se desincroniza.
 */

/** Lo que hay que saber para dibujar el selector y para reemplazar al elegir. */
export interface ComandoEnCurso {
  /** Lo tipeado después de la barra, en minúsculas. `''` recién abierta la barra. */
  consulta: string;
  /** Índice de la `/` en el texto. */
  desde: number;
  /** Índice del cursor: el final del tramo que se reemplaza. */
  hasta: number;
}

/**
 * Corta el comando que el cursor está escribiendo, o `null` si no hay ninguno.
 *
 * Se corta en el primer espacio: «/cuotas y también» ya no es un comando, es una
 * frase que arrancó con uno. Cerrar ahí es lo que hace que el selector no quede
 * abierto mientras se sigue escribiendo — y de paso permite que un mensaje
 * legítimo empiece con barra sin quedar atrapado.
 */
export function comandoEnCurso(texto: string, cursor: number): ComandoEnCurso | null {
  const pos = Math.max(0, Math.min(cursor, texto.length));
  const antes = texto.slice(0, pos);

  const desde = antes.lastIndexOf('/');
  if (desde === -1) return null;

  // La barra tiene que abrir palabra. `undefined` cuando `desde` es 0, y ahí vale.
  const anterior = desde === 0 ? undefined : texto[desde - 1];
  if (anterior !== undefined && !/\s/.test(anterior)) return null;

  const consulta = antes.slice(desde + 1);
  // Un espacio cierra el comando: lo que sigue ya es prosa.
  if (/\s/.test(consulta)) return null;

  return { consulta: consulta.toLowerCase(), desde, hasta: pos };
}

/** Lo mínimo que el filtro necesita de una respuesta guardada. */
export interface RespuestaBuscable {
  clave: string;
  rotulo: string;
  texto: string;
}

/**
 * Las respuestas que matchean lo tipeado, en el orden en que conviene verlas.
 *
 * Se busca en la CLAVE, en el RÓTULO y en el TEXTO, porque la vendedora no se
 * acuerda de la clave: se acuerda de la frase. Escribir `/cuota` tiene que
 * encontrar «Se puede pagar en dos cuotas» aunque su clave sea `financiacion`.
 *
 * El orden pone primero lo que empieza con lo tipeado —que es lo que uno espera
 * cuando escribe un atajo— y después lo que solo lo contiene. Dentro de cada
 * grupo se respeta el orden que ya traía el catálogo, que es el que el equipo
 * decidió; reordenar por «relevancia» inventada haría que la misma consulta dé
 * resultados distintos según cambios que nadie ve.
 *
 * ⚠️ Sin consulta devuelve TODO, no los tres del panel: `elegirHechos` recorta a
 * 3 por momento de venta para el chip, y ese recorte acá sería un catálogo
 * mutilado — el sentido del `/` es llegar a las 27, no a las 3 de siempre.
 */
export function filtrarRespuestas<T extends RespuestaBuscable>(
  respuestas: readonly T[],
  consulta: string,
): T[] {
  const q = consulta.trim().toLowerCase();
  if (!q) return [...respuestas];

  const empiezan: T[] = [];
  const contienen: T[] = [];
  for (const r of respuestas) {
    const clave = r.clave.toLowerCase();
    const rotulo = r.rotulo.toLowerCase();
    if (clave.startsWith(q) || rotulo.startsWith(q)) empiezan.push(r);
    else if (clave.includes(q) || rotulo.includes(q) || r.texto.toLowerCase().includes(q)) contienen.push(r);
  }
  return [...empiezan, ...contienen];
}

/**
 * El texto con el comando reemplazado por la respuesta, y dónde queda el cursor.
 *
 * Se agrega un espacio detrás **solo si no lo hay ya**: la vendedora suele seguir
 * escribiendo, y quedar pegado a la última palabra obliga a apretar la barra
 * espaciadora en un lugar donde nadie la espera. Duplicarlo sería peor.
 */
export function aplicarRespuesta(
  texto: string,
  comando: ComandoEnCurso,
  respuesta: string,
): { texto: string; cursor: number } {
  const cola = texto.slice(comando.hasta);
  const separador = cola.startsWith(' ') || cola === '' ? '' : ' ';
  const nuevo = texto.slice(0, comando.desde) + respuesta + separador + cola;
  return { texto: nuevo, cursor: comando.desde + respuesta.length + separador.length };
}
