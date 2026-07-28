/**
 * LAS VARIABLES DE UNA PLANTILLA — `{nombre}`, `{curso}`, `{precio}`.
 *
 * Puro (patrón §5.3): el reemplazo se testea sin Postgres ni red. El IO —traer la
 * ficha de Cerberus y el precio del catálogo— lo hace la ruta.
 *
 * ══ LA REGLA QUE NO SE NEGOCIA ═══════════════════════════════════════════════
 *
 * **Un precio inventado es peor que un hueco.** Si Cerberus no responde, si el
 * producto no tiene precio, o si el precio viene SIN MONEDA (issue #43: el
 * payload público de Cerberus todavía no la trae), la variable queda como el
 * hueco visible `[precio]` y se reporta en `faltantes`. Nunca un número cacheado,
 * nunca un `0`, nunca una cifra sin moneda — «S/ 250» y «USD 250» son cursos
 * distintos y en LATAM esa confusión es plata perdida.
 *
 * El hueco es a propósito FEO: `[precio]` en medio de un mensaje se ve, y la
 * vendedora lo completa a mano antes de mandar. Un `0` no se ve.
 */

export interface VariablesPlantilla {
  /** El nombre real de la persona (ficha de Cerberus, o el del chat). */
  nombre?: string | null;
  /** El nombre del curso de la familia atada a la plantilla. */
  curso?: string | null;
  /** El precio EN VIVO. `null`/`0` ⇒ hueco. */
  precio?: number | null;
  /** El símbolo o código («S/», «USD»). Vacío ⇒ hueco, aunque haya número. */
  moneda?: string | null;
  /**
   * El reloj para `{saludo}`. Se inyecta para poder testearlo; por default, ahora.
   */
  ahora?: Date;
}

export interface TextoExpandido {
  texto: string;
  /** Qué variables quedaron como hueco. La UI avisa suave; no bloquea. */
  faltantes: string[];
}

/**
 * Las variables que existen. Cualquier otra cosa entre llaves se deja intacta.
 *
 * `saludo` es distinta de las otras tres y por eso se aclara: **nunca queda
 * hueco**. Las demás dependen de datos que pueden faltar —Cerberus no contesta,
 * el producto no tiene precio— y ahí un `[precio]` visible es lo honesto. El
 * saludo depende del reloj, que siempre está: dejar `[saludo]` en un mensaje que
 * sale sería romper algo que no tenía cómo fallar.
 *
 * Existe porque el guión de Consultoría abre con «Buenos días» y se manda a
 * cualquier hora. Un «buenos días» a las 11 de la noche es la clase de detalle
 * que le dice al lead que del otro lado hay un machote, no una persona.
 */
export const VARIABLES = ["nombre", "curso", "precio", "saludo"] as const;
export type Variable = (typeof VARIABLES)[number];

/** El hueco visible de una variable que no se pudo resolver. */
export function hueco(v: Variable): string {
  return `[${v}]`;
}

/**
 * «Buenos días» · «Buenas tardes» · «Buenas noches», por la hora LOCAL.
 *
 * Los cortes son los de acá, no los del libro: hasta las 12 es mañana, hasta las
 * 19 es tarde, después es noche. A las 19:00 en Lima ya está oscuro y «buenas
 * tardes» suena a que nadie miró la hora.
 */
export function saludoDeLaHora(ahora: Date = new Date()): string {
  const h = ahora.getHours();
  if (h < 12) return "Buenos días";
  return h < 19 ? "Buenas tardes" : "Buenas noches";
}

/**
 * Formatea el precio, o devuelve `null` si no hay nada honesto que mostrar.
 * Exportado porque la regla «sin moneda no hay precio» se testea sola.
 */
export function formatearPrecio(
  precio: number | null | undefined,
  moneda: string | null | undefined,
): string | null {
  if (precio == null || !Number.isFinite(precio) || precio <= 0) return null;
  const m = (moneda ?? "").trim();
  if (!m) return null;
  const cifra = Number.isInteger(precio)
    ? String(precio)
    : precio.toFixed(2).replace(/\.00$/, "");
  // «S/250» y «$250» van pegados; «USD 250» separado — un CÓDIGO de tres letras
  // pide aire, un símbolo no. Es como se escribe la plata de este lado.
  return /^[A-Za-z]+$/.test(m) ? `${m} ${cifra}` : `${m}${cifra}`;
}

/**
 * Reemplaza las variables del cuerpo. Lo que no se puede resolver queda como
 * hueco y se lista en `faltantes` — en el orden en que aparecen las variables.
 */
export function expandirCuerpo(cuerpo: string, v: VariablesPlantilla): TextoExpandido {
  const faltantes: string[] = [];

  const resolver = (variable: Variable): string => {
    const valor =
      variable === "saludo"
        ? saludoDeLaHora(v.ahora)
        : variable === "nombre"
          ? (v.nombre ?? "").trim() || null
          : variable === "curso"
            ? (v.curso ?? "").trim() || null
            : formatearPrecio(v.precio, v.moneda);

    if (valor === null) {
      if (!faltantes.includes(variable)) faltantes.push(variable);
      return hueco(variable);
    }
    return valor;
  };

  const texto = cuerpo.replace(/\{(nombre|curso|precio|saludo)\}/g, (_m, nombre: Variable) =>
    resolver(nombre),
  );

  return { texto, faltantes };
}

/**
 * ¿Este cuerpo necesita un curso atado? `{curso}` y `{precio}` no se pueden
 * resolver sin familia — la ruta lo rechaza al crear, como #45 lo rechaza para
 * las respuestas rápidas.
 */
export function exigeCurso(cuerpo: string): boolean {
  return /\{(curso|precio)\}/.test(cuerpo);
}
