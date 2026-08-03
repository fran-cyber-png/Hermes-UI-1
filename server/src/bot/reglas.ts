import { normalizarTexto } from "../autorespuesta/rechazo.js";

/**
 * LAS REGLAS DURAS DEL PROMPT, COMO VEREDICTO AUTOMÁTICO (#258).
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * El prompt tiene 13 reglas duras y el bot las desobedece. Medido sobre las 171
 * respuestas que salieron de verdad en producción:
 *
 *   · regla 0b (nunca preguntes el país) ......................  9 violaciones
 *   · regla 6b (nunca anuncies a otra persona) ................  3
 *   · identidad (se nombró como otra asesora) ................. 39
 *   · regla 2 (nunca inventes datos: inventó una sede) ........  1
 *
 * Nadie las contó a mano: se contaron con expresiones como éstas. Ponerlas acá
 * convierte «el bot se porta mejor» en un número que se compara entre Corridas,
 * y lo saca gratis — antes de gastar el juicio humano, que es el recurso caro.
 *
 * ══ LO QUE ESTO NO ES ════════════════════════════════════════════════════════
 *
 * **No mide si la respuesta VENDE.** Una respuesta puede cumplir las 13 reglas y
 * ser inútil. Eso lo dice una vendedora (#262) y ninguna expresión regular lo va
 * a saber. Acá solo se atrapa lo que es objetivamente contrario a una regla
 * escrita.
 *
 * ══ EL FALSO POSITIVO ES EL ENEMIGO ══════════════════════════════════════════
 *
 * Una regla que marca de más se desactiva sola: nadie le cree a un tablero que
 * grita. Por eso cada patrón de acá abajo está acotado a la forma en que el
 * defecto apareció DE VERDAD en el corpus, y hay un test que fija los textos
 * correctos que NO se pueden marcar. Ante la duda, no marcar.
 *
 * Todo puro: entra un `string`, sale un veredicto. Sin base, sin reloj, sin red.
 */

export type ClaveRegla =
  | "identidad"
  | "pregunta_pais"
  | "anuncia_otra_persona"
  | "cifra_de_precio"
  | "dice_ser_bot"
  | "sede_inexistente";

export interface Violacion {
  regla: ClaveRegla;
  /** Qué se le reprocha, en una línea y sin jerga. */
  lectura: string;
  /** El fragmento que la disparó, para poder discutirla. */
  fragmento: string;
}

/** La única asesora que el bot puede ser (decisión del dueño, 3-ago-2026). */
const ASESORA = "sofia rodriguez";

/**
 * Las sedes que existen, en `CONTEXTO_NEGOCIO`. Cualquier otra que el bot
 * nombre como sede es inventada — el caso real fue «Nuestra sede en la región
 * es en Panamá», que no existe y además era falso sobre desde dónde escribe.
 */
const SEDES_REALES = ["miami", "mexico", "lima", "guayaquil", "santa cruz", "janeiro", "peru"];

interface Patron {
  regla: ClaveRegla;
  lectura: string;
  re: RegExp;
  /** Si devuelve false, no se marca. Para los casos que la expresión sola no separa. */
  confirmar?: (texto: string, m: RegExpMatchArray) => boolean;
}

const PATRONES: Patron[] = [
  {
    regla: "pregunta_pais",
    lectura: "Preguntó el país, que ya viene en el teléfono (regla 0b)",
    re: /\b(de qu[eé] pa[ií]s|desde qu[eé] pa[ií]s|cu[aá]l es tu pa[ií]s|en qu[eé] pa[ií]s (est[aá]s|te encuentras|resides|vives))\b/i,
  },
  {
    regla: "anuncia_otra_persona",
    lectura: "Anunció que otra persona lo va a contactar (regla 6b)",
    // Acotado a la forma real: alguien MÁS que contacta. «te confirmo yo» y
    // «déjame revisarlo» son justamente lo que la regla PIDE, y no pueden caer.
    re: /\b(un[a]? (asesor[a]?|especialista|ejecutiv[oa])\s+(te|se)\s+\w+|nuestro equipo te (escribe|contacta|llama)|te derivo con|se (comunicar[aá]|contactar[aá]) contigo|te (contactar[aá]|llamar[aá])n?)\b/i,
  },
  {
    regla: "dice_ser_bot",
    lectura: "Dijo o insinuó que es un bot / una IA (regla 3)",
    re: /\b(soy un[a]? (bot|robot|ia|inteligencia artificial|asistente virtual|sistema)|mensaje autom[aá]tico|respuesta autom[aá]tica)\b/i,
  },
  {
    regla: "cifra_de_precio",
    lectura: "Escribió una cifra de precio en el texto (regla 1: va por la pieza)",
    // Una cifra CON marca de moneda. Un número suelto («8 sesiones», «120 horas»)
    // no es un precio, y marcarlo sería el falso positivo más fácil de cometer.
    re: /(S\/\s?\d|US\$\s?\d|\$\s?\d{2,}|\b\d{2,}\s?(d[oó]lares|soles|pesos|bs\b))/i,
  },
  {
    regla: "sede_inexistente",
    lectura: "Nombró una sede que no existe en el contexto de negocio (regla 2)",
    // **Sin el flag `i` a propósito**: el lugar tiene que empezar en MAYÚSCULA,
    // porque un nombre propio la lleva y un sustantivo común no. Con `i`, en
    // «nuestra sede en la región es en Panamá» capturaba «la» —el primer `en`
    // que encontraba— y el caso real se escapaba entero.
    re: /\bsede\b[^.]{0,60}?\ben\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/,
    confirmar: (_t, m) => {
      const lugar = normalizarTexto(m[1] ?? "");
      return lugar.length > 2 && !SEDES_REALES.some((s) => lugar.includes(normalizarTexto(s)));
    },
  },
];

/**
 * ¿Qué reglas rompe este texto?
 *
 * La identidad se evalúa aparte porque su forma es distinta: no es «aparece un
 * patrón malo», es «se presenta con un nombre que no es el suyo».
 */
export function evaluarReglas(texto: string | null): Violacion[] {
  if (!texto || texto.trim() === "") return [];
  const violaciones: Violacion[] = [];

  for (const p of PATRONES) {
    const m = texto.match(p.re);
    if (!m) continue;
    if (p.confirmar && !p.confirmar(texto, m)) continue;
    violaciones.push({ regla: p.regla, lectura: p.lectura, fragmento: m[0].trim().slice(0, 80) });
  }

  const identidad = violacionDeIdentidad(texto);
  if (identidad) violaciones.push(identidad);

  return violaciones;
}

/**
 * Se presentó con un nombre que no es el suyo.
 *
 * Se mira solo donde el bot SE PRESENTA («soy X», «te saluda X»): nombrar a otra
 * persona en el cuerpo del mensaje no es adoptar su identidad, y marcarlo sería
 * el falso positivo que apaga la regla.
 */
function violacionDeIdentidad(texto: string): Violacion | null {
  const m = texto.match(/\b(?:soy|te saluda|le saluda|habla)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]+)?)/);
  if (!m) return null;
  const nombre = normalizarTexto(m[1] ?? "");
  if (nombre === "" || ASESORA.startsWith(nombre) || nombre.startsWith(ASESORA)) return null;
  // Un nombre de pila solo («soy Sofía») también cuenta como correcto.
  if (ASESORA.split(" ").includes(nombre)) return null;
  return {
    regla: "identidad",
    lectura: `Se presentó como «${m[1]}» y no como Sofía Rodríguez`,
    fragmento: m[0].trim().slice(0, 80),
  };
}

/** El conteo por regla de un conjunto de respuestas — lo que se compara entre Corridas. */
export function contarViolaciones(textos: (string | null)[]): Record<ClaveRegla, number> {
  const cuenta = {
    identidad: 0,
    pregunta_pais: 0,
    anuncia_otra_persona: 0,
    cifra_de_precio: 0,
    dice_ser_bot: 0,
    sede_inexistente: 0,
  } satisfies Record<ClaveRegla, number>;

  for (const t of textos) {
    for (const v of evaluarReglas(t)) cuenta[v.regla] += 1;
  }
  return cuenta;
}
