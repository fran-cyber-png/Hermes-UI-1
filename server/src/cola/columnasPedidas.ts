import type { ColumnaPedida } from "./consultarCola.js";

/**
 * ══ QUÉ COLUMNAS PIDE EL TABLERO, LEÍDO DEL QUERY STRING ══════════════════════
 *
 * El Pipeline pedía una columna por pedido (`?etapa=`) y eso costaba cinco
 * materializaciones de la tabla temporal más cara del repo. Ahora las pide todas
 * juntas y esto es lo que traduce ese pedido:
 *
 *     ?columnas=interesado,cotizado:seguir,cierre
 *
 * `etapa` a secas, o `etapa:recorte`. Vive aparte de la ruta y es **pura** para
 * poder interrogarla sobre los casos que en producción no se ven hasta que
 * muerden: la etapa repetida, el recorte con un dedazo, la lista vacía.
 *
 * 🔴 **CADA FORMA MAL ESCRITA ES UN 400, NUNCA UN VALOR IGNORADO.** Es la misma
 * regla que la guarda de `?linea=` de la ruta, y por el mismo motivo: un recorte
 * que se cae en silencio no deja la pantalla vacía —eso se vería— sino la columna
 * ENTERA debajo de un chip que dice que está recortada. La vendedora lee 3.051
 * tarjetas donde el chip le prometió 82, y no hay un solo síntoma que la mande a
 * mirar acá.
 */

/** Los cuatro recortes de columna del Pipeline (ADR 0044). */
export const RECORTES_DE_COLUMNA = ["precio", "ventana", "seguir", "seCallo"] as const;
export type RecorteDeColumna = (typeof RECORTES_DE_COLUMNA)[number];

/**
 * El tope de columnas en un pedido.
 *
 * ⚠️ **No es prolijidad: cada columna es una consulta de página sobre la misma
 * conexión.** El tablero pide cinco; sin tope, un `?columnas=` de doscientas
 * entradas son doscientas pasadas de la consulta más grande del repo, en serie,
 * dentro de una sola transacción — o sea, la forma más barata que hay de tumbar
 * la base desde afuera. Sobra para las cinco de hoy y para la sexta que ADR 0050
 * dejó anotada.
 */
export const MAX_COLUMNAS = 8;

export type ColumnasPedidas =
  | { ok: true; columnas: ColumnaPedida[] }
  | { ok: false; motivo: string };

/**
 * Traduce `?columnas=` a lo que `consultarCola` entiende.
 *
 * `etapasValidas` se inyecta (y no se importa) porque quien manda es
 * `ETAPAS_CONSULTABLES` —lo que el embudo puede DEVOLVER, no lo que se puede
 * declarar— y esa distinción ya costó un bug: `?etapa=sin_respuesta` respondía
 * 400 con los quince tests con base en verde.
 */
export function parsearColumnas(
  crudo: string,
  etapasValidas: readonly string[],
): ColumnasPedidas {
  const partes = crudo
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (!partes.length) {
    return { ok: false, motivo: "se espera al menos una columna (?columnas=etapa[:recorte],…)" };
  }
  if (partes.length > MAX_COLUMNAS) {
    return { ok: false, motivo: `demasiadas columnas (${partes.length}): el tope es ${MAX_COLUMNAS}` };
  }

  const columnas: ColumnaPedida[] = [];
  const vistas = new Set<string>();

  for (const parte of partes) {
    const trozos = parte.split(":");
    const etapa = (trozos[0] ?? "").trim();
    const recortes = trozos.slice(1).map((r) => r.trim()).filter((r) => r.length > 0);

    if (!etapasValidas.includes(etapa)) {
      return { ok: false, motivo: `etapa inválida (${etapa}): se espera ${etapasValidas.join(" | ")}` };
    }
    /**
     * ⚠️ **La etapa repetida es un 400 y no la última que gana.** El resultado se
     * indexa POR ETAPA (`ResultadoCola.columnas`), así que la segunda pisaría a la
     * primera: el server haría el trabajo de las dos y la pantalla dibujaría una
     * columna de menos, sin error y sin log.
     */
    if (vistas.has(etapa)) {
      return { ok: false, motivo: `la etapa ${etapa} viene dos veces` };
    }
    vistas.add(etapa);

    /**
     * ⚠️ **UN recorte por columna, no varios.** El eje es uno con varias
     * posiciones y no cuatro toggles (ADR 0044): cruzar «con precio» × «en
     * ventana» × «para seguir» daría ocho estados y la mitad no son listas que
     * nadie pida. Aceptar `cotizado:seguir:precio` acá inventaría del lado del
     * server una combinación que la pantalla no sabe ni dibujar ni apagar.
     */
    if (recortes.length > 1) {
      return { ok: false, motivo: `la columna ${etapa} pide ${recortes.length} recortes: va uno solo` };
    }
    const recorte = recortes[0];
    if (recorte !== undefined && !(RECORTES_DE_COLUMNA as readonly string[]).includes(recorte)) {
      return {
        ok: false,
        motivo: `recorte inválido (${recorte}): se espera ${RECORTES_DE_COLUMNA.join(" | ")}`,
      };
    }

    columnas.push({
      etapa,
      precio: recorte === "precio",
      ventana: recorte === "ventana",
      seguir: recorte === "seguir",
      seCallo: recorte === "seCallo",
    });
  }

  return { ok: true, columnas };
}
