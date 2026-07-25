/**
 * DEL TEXTO DE LA CAMPAÑA A LA FAMILIA DE CURSO — el diccionario, y es PURO.
 *
 * El lead de Click-to-WhatsApp llega diciendo qué quiere: la conversación trae
 * «Vino del anuncio · campaña **[JUL] INTELIGENCIA | WSP**» y el formulario que
 * llenó dice «Diploma técnico en Osint & Socmint». El CRM tenía ese dato a la
 * vista y no lo usaba: **1 interés registrado en 1.876 conversaciones**, mientras
 * la compuerta de Cotizado exige uno. Este módulo es el traductor que faltaba.
 *
 * Lo que hace es una sola cosa: **texto suelto → familia de curso** (el prefijo
 * de SKU de Cerberus, `DIPICOT`, que es la identidad canónica medida en #129:
 * 111 productos = 38 familias). No mira la base, no llama a nadie, no adivina —
 * si ningún alias matchea devuelve `null` y quien lo llame muestra el título
 * crudo del anuncio, que es la verdad disponible.
 *
 * ── LAS DOS REGLAS DEL MATCHEO ──────────────────────────────────────────────
 *
 * 1. **Por palabra entera, nunca por pedazo.** `contrainteligencia` CONTIENE
 *    `inteligencia` como substring; con matcheo de substring, una familia se
 *    comería a la otra. Se comparan secuencias de palabras contiguas.
 * 2. **Gana el alias más específico** (más palabras). «Diploma de Inteligencia
 *    Artificial y Marketing Político» matchea `inteligencia` (DIPICOT) y también
 *    `inteligencia artificial y marketing politico` (DIPIAMP): manda el segundo.
 *    Sin esta regla, media campaña de la Escuela sería «Inteligencia».
 *
 * La normalización tolera lo que la gente de pauta le pone alrededor al nombre
 * del curso: el prefijo del mes (`[JUL]`), el sufijo del canal (`| WSP`), los
 * acentos, las mayúsculas y los `&`. Nada de eso distingue un curso de otro.
 *
 * La tabla `alias_curso` (schema.ts) es la que manda en tiempo de ejecución —
 * se edita sin deploy. `ALIAS_SEMILLA` es con lo que nace: los cursos reales del
 * catálogo, sembrados de forma idempotente (`semilla.ts`).
 */

export interface AliasCurso {
  /** El texto que se busca en la campaña/anuncio/formulario. Se normaliza al comparar. */
  alias: string;
  /** La familia: el prefijo alfabético del SKU de Cerberus (`DIPICOT014` → `DIPICOT`). */
  familia: string;
  /** El nombre legible del curso — lo que ve la vendedora en el chip. */
  nombreCurso: string;
}

/**
 * Sin acentos, sin mayúsculas y con TODO lo que no es letra o número convertido
 * en espacio: `[JUL] INTELIGENCIA | WSP` → `jul inteligencia wsp`. Así el
 * corchete del mes, la barra del canal y el `&` de «Osint & Socmint» dejan de
 * ser un problema de parsing y pasan a ser separadores.
 */
export function normalizarTexto(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Cuántas palabras tiene un alias — la medida de «qué tan específico es». */
function palabras(norm: string): number {
  return norm === "" ? 0 : norm.split(" ").length;
}

/**
 * El alias que mejor describe este texto, o `null` si ninguno lo hace.
 *
 * El contenido se prueba con la secuencia de palabras rodeada de espacios
 * (` inteligencia `), que es la forma barata y exacta de exigir palabra entera
 * sin armar un regex por alias. Entre los que matchean gana el de más palabras;
 * a igual cantidad, el más largo; y a igual largo, el orden alfabético de la
 * familia — para que el resultado sea determinista y no dependa del orden en que
 * Postgres devolvió las filas.
 */
export function familiaDeTexto(
  aliases: readonly AliasCurso[],
  texto: string | null | undefined,
): AliasCurso | null {
  const norm = normalizarTexto(texto);
  if (norm === "") return null;
  const aguja = ` ${norm} `;

  let mejor: AliasCurso | null = null;
  let mejorNorm = "";
  for (const a of aliases) {
    const an = normalizarTexto(a.alias);
    if (an === "" || !aguja.includes(` ${an} `)) continue;
    if (
      mejor === null ||
      palabras(an) > palabras(mejorNorm) ||
      (palabras(an) === palabras(mejorNorm) && an.length > mejorNorm.length) ||
      (palabras(an) === palabras(mejorNorm) &&
        an.length === mejorNorm.length &&
        a.familia < mejor.familia)
    ) {
      mejor = a;
      mejorNorm = an;
    }
  }
  return mejor;
}

/**
 * CON LO QUE NACE LA TABLA — las familias reales del catálogo de la Escuela
 * (#129, medidas contra Cerberus el 25-jul-2026) con las formas en que la pauta
 * las escribe: el nombre del diploma, el de la campaña y el del formulario.
 *
 * Criterio para agregar un alias acá: **que exista en la realidad** (una campaña,
 * un anuncio o un formulario que se llame así). Un alias inventado «por si
 * acaso» es una propuesta equivocada esperando a que alguien la confirme de un
 * clic — y la confirmación registra un interés de verdad.
 */
export const ALIAS_SEMILLA: readonly AliasCurso[] = [
  // DIPICOT — 12+9+1 ediciones bajo tres redacciones distintas: la familia con
  // más volumen de la Escuela y la del pedido del dueño («llegó inteligencia»).
  ...aliasesDe("DIPICOT", "Inteligencia y Contrainteligencia", [
    "inteligencia",
    "contrainteligencia",
    "inteligencia y contrainteligencia",
    "inteligencia estrategica",
    "operaciones clandestinas de inteligencia",
  ]),
  // DIPTEEI — «Analista de Inteligencia»: comparte la palabra con DIPICOT y por
  // eso el matcheo tiene que preferir el alias largo (hay test que lo fija).
  ...aliasesDe("DIPTEEI", "Analista de Inteligencia", [
    "analista de inteligencia",
    "analistas de inteligencia",
  ]),
  ...aliasesDe("DIPOSOC", "OSINT & SOCMINT", [
    "osint",
    "socmint",
    "osint y socmint",
    "osint socmint",
  ]),
  ...aliasesDe("DIPIAMP", "IA y Marketing Político", [
    "ia y marketing politico",
    "inteligencia artificial y marketing politico",
    "marketing politico",
  ]),
  ...aliasesDe("DIPCPOL", "Consultor Político", ["consultor politico", "consultoria politica"]),
  ...aliasesDe("EPCOORP", "Oratoria para Políticos", [
    "oratoria",
    "oratoria para politicos",
    "oratoria politica",
  ]),
  ...aliasesDe("DIPDIRS", "Director de Seguridad", [
    "director de seguridad",
    "direccion de seguridad",
  ]),
  ...aliasesDe("DIPSTC", "Director de Comunicaciones", [
    "director de comunicaciones",
    "direccion de comunicaciones",
  ]),
  ...aliasesDe("INCOPIE", "Criminología y Ciencias Forenses", [
    "criminologia",
    "ciencias forenses",
    "criminologia y ciencias forenses",
  ]),
  ...aliasesDe("DIPASEPRE", "Asesor Presidencial", ["asesor presidencial", "asesoria presidencial"]),
  ...aliasesDe("DIPCOCO", "Contraterrorismo", ["contraterrorismo", "antiterrorismo"]),
];

/** Azúcar para que la semilla se lea como lo que es: una familia y sus formas de escribirla. */
function aliasesDe(familia: string, nombreCurso: string, alias: readonly string[]): AliasCurso[] {
  return alias.map((a) => ({ alias: a, familia, nombreCurso }));
}
