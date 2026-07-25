import { familiaDeTexto, type AliasCurso } from "./alias.js";

/**
 * EL INTERÉS DERIVADO — qué curso PROPONER cuando nadie lo asentó todavía (#102).
 *
 * El lead de Click-to-WhatsApp ya llegó diciendo qué quiere. La propuesta que
 * sale de acá es exactamente eso, dicho en voz alta: «vino por INTELIGENCIA,
 * ¿lo anoto?». **No es un asiento**: se calcula en cada consulta y no se guarda
 * (misma decisión que las señales automáticas, ADR 0015 — derivar lo derivable).
 * La ÚNICA cosa que escribe una fila en `intereses` es un clic humano.
 *
 * ── LA PRECEDENCIA (la misma de #72, y no se reinventa) ─────────────────────
 *
 *   1. **El interés REGISTRADO manda.** Si la vendedora ya asentó uno, no hay
 *      nada que proponer: se calla. Proponer al lado de lo asentado sería
 *      discutirle a quien habló con la persona.
 *   2. Entre lo deducible, **lo que la persona ELIGIÓ** (el curso del formulario
 *      que llenó) va antes que **DE DÓNDE VINO** (la campaña del anuncio): el
 *      formulario es su declaración; el anuncio, la puerta por la que entró.
 *   3. **Sin alias que matchee no se inventa**: la propuesta vuelve con
 *      `curso: null` y el texto crudo, y la UI muestra el título del anuncio tal
 *      cual con el buscador normal al lado. Un curso adivinado sería peor que
 *      ninguno: se confirma de un clic y queda asentado como si alguien lo
 *      hubiera escuchado.
 *
 * Es PURO a propósito (patrón puro+wrapper, `arquitectura.md` §5.3): la
 * precedencia se discute con un test en la mano. El SQL que junta los candidatos
 * vive aparte, en `consultarDerivados.ts`.
 */

/** De dónde salió el texto del que se dedujo el curso. La UI lo dice, nunca lo esconde. */
export type FuenteDerivada = "lead" | "anuncio";

/** Un texto candidato a nombrar un curso, con su procedencia. */
export interface CandidatoCurso {
  fuente: FuenteDerivada;
  /** El texto crudo: la campaña del anuncio o el curso del formulario. */
  texto: string | null;
}

export interface InteresDerivado {
  /** El nombre legible del curso, o `null` si ningún alias matcheó (no se inventa). */
  curso: string | null;
  /** La familia (prefijo de SKU) — con esto se resuelve la última edición al confirmar. */
  familia: string | null;
  fuente: FuenteDerivada;
  /** El texto del que salió, tal cual vino. Es lo que se muestra cuando no hay mapeo. */
  textoOrigen: string;
}

/**
 * La propuesta para UNA conversación, o `null` si no hay ninguna que hacer.
 *
 * `candidatos` llega **en orden de precedencia** (el llamador lo arma; el SQL de
 * `consultarDerivados.ts` pone el formulario antes que el anuncio).
 */
export function derivarInteres(v: {
  /** Los cursos ya asentados en `intereses` para esta conversación. */
  registrados: readonly string[];
  candidatos: readonly CandidatoCurso[];
  aliases: readonly AliasCurso[];
}): InteresDerivado | null {
  if (v.registrados.length > 0) return null;

  const utiles = v.candidatos
    .map((c) => ({ fuente: c.fuente, texto: (c.texto ?? "").trim() }))
    .filter((c) => c.texto !== "");
  if (utiles.length === 0) return null;

  for (const c of utiles) {
    const alias = familiaDeTexto(v.aliases, c.texto);
    if (alias) {
      return {
        curso: alias.nombreCurso,
        familia: alias.familia,
        fuente: c.fuente,
        textoOrigen: c.texto,
      };
    }
  }

  // Ninguno mapeó: se muestra el de más precedencia tal como vino.
  return { curso: null, familia: null, fuente: utiles[0].fuente, textoOrigen: utiles[0].texto };
}
