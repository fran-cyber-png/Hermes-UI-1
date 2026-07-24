/**
 * PARSER INCREMENTAL DE SERVER-SENT EVENTS.
 *
 * Existe porque EventSource no puede mandar el header `Authorization`, y desde
 * el cierre del issue #36 `/api/stream` exige el Bearer de la vendedora como
 * todo /api. Así que el stream se consume con `fetch` (que sí manda el header)
 * y este parser reconstruye los eventos del protocolo SSE a partir de los
 * chunks crudos del body.
 *
 * Cubre exactamente lo que `routes/stream.ts` emite: bloques `data: ...`
 * separados por línea en blanco, comentarios keep-alive (`: ...`) y la
 * directiva `retry:` — esas dos últimas se ignoran (el reintento lo maneja
 * `tiempoReal.ts`, porque acá no hay un EventSource que obedezca `retry`).
 */

/**
 * Devuelve una función que se alimenta con cada chunk del stream y llama a
 * `onData` una vez por evento completo, con el `data` ya ensamblado (las líneas
 * `data:` múltiples se unen con `\n`, como manda la spec).
 */
export function crearParserSSE(onData: (data: string) => void): (chunk: string) => void {
  let resto = '';
  return (chunk: string): void => {
    // CRLF → LF sobre el buffer entero: un `\r\n` partido entre chunks se
    // recompone solo (el `\r` colgante espera en `resto` a su `\n`).
    resto = (resto + chunk).replace(/\r\n/g, '\n');
    let corte: number;
    while ((corte = resto.indexOf('\n\n')) !== -1) {
      const bloque = resto.slice(0, corte);
      resto = resto.slice(corte + 2);
      const datos = bloque
        .split('\n')
        .filter((linea) => linea.startsWith('data:'))
        .map((linea) => linea.slice(linea.startsWith('data: ') ? 6 : 5));
      if (datos.length > 0) onData(datos.join('\n'));
    }
  };
}
