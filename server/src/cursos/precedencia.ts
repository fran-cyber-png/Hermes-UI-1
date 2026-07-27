/**
 * LA PRECEDENCIA DEL CURSO DE UNA CONVERSACIÓN — una sola vez, y acá.
 *
 * «¿Qué curso quiere esta persona?» se la hacen CUATRO pantallas: el chip de la
 * cola (#72), la propuesta de la ficha (#102), el acuse nocturno (ADR 0016) y el
 * Dashboard por curso (#128). La respuesta tiene que ser la misma en las cuatro,
 * y hasta hoy no lo era: el Dashboard miraba **solo el formulario**, así que
 * decía «Sin curso identificado: 68 de 70 (97 %)» mientras la fila de al lado
 * mostraba el chip «Inteligencia Estratég…» sacado del anuncio. Dos partes del
 * sistema mirando el mismo dato y contando cosas distintas — la divergencia de
 * #37 con otro nombre, y la tercera vez que pasa en este repo.
 *
 * ── EL ORDEN (lo cerró el dueño en #72, no se reinventa) ────────────────────
 *
 *   1. **el interés REGISTRADO** — alguien lo escuchó y lo asentó: manda;
 *   2. **el curso del FORMULARIO** que la persona llenó — lo eligió ella;
 *   3. **el ANUNCIO** por el que escribió — es de dónde vino, no lo que dijo.
 *
 * Sin ninguno de los tres, no hay curso: **no se infiere leyendo el mensaje**.
 * Una fila «sin atribuir» honesta vale más que una atribución inventada.
 *
 * ── PURO, Y CON GEMELO EN SQL ───────────────────────────────────────────────
 *
 * Esta función es la definición legible; su gemelo para las consultas de listado
 * vive en `cola/cursoSql.ts` (`cursoCrudoSql` / `fuenteCursoSql`). Que sean dos
 * escrituras es inevitable —una decide sobre una fila ya traída, la otra agrupa
 * dentro de Postgres—, así que lo que las mantiene juntas es un test de paridad
 * (`dashboard/curso.paridad.test.db.ts`), igual que la urgencia del ADR 0009.
 *
 * Lo que devuelve es el texto CRUDO, no una familia: traducir texto → familia es
 * otro trabajo y tiene su propio hogar (`cursos/alias.ts`). Mezclarlos haría que
 * un cambio en el diccionario pareciera un cambio de precedencia.
 */

export type FuenteCurso = "interes" | "lead" | "anuncio";

/** El anuncio del que vino la conversación, tal como lo guardó `whatsapp/origen.ts`. */
export interface AnuncioDeConversacion {
  fuente?: string | null;
  titulo?: string | null;
  adId?: string | null;
}

export interface CandidatosDeCurso {
  /** El interés más reciente asentado en `intereses` para esta conversación. */
  interesCurso?: string | null;
  /** El curso del formulario del lead emparejado por teléfono. */
  leadCurso?: string | null;
  /** El origen del mensaje (`events.payload->'origen'`). Solo cuenta si es un anuncio. */
  anuncio?: AnuncioDeConversacion | null;
}

export interface CursoDeConversacion {
  /** El texto tal cual vino. Vacío solo cuando el anuncio no tiene título pero sí `adId`. */
  crudo: string;
  fuente: FuenteCurso;
  /** El `adId` de Meta cuando el curso salió del anuncio: la llave del mapeo humano. */
  adId: string | null;
}

/** Un texto sirve como fuente solo si dice algo. */
function util(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

export function cursoDeConversacion(c: CandidatosDeCurso): CursoDeConversacion | null {
  const interes = util(c.interesCurso);
  if (interes) return { crudo: interes, fuente: "interes", adId: null };

  const lead = util(c.leadCurso);
  if (lead) return { crudo: lead, fuente: "lead", adId: null };

  if (c.anuncio?.fuente === "anuncio") {
    const titulo = util(c.anuncio.titulo);
    const adId = util(c.anuncio.adId);
    // Un anuncio SIN título pero con `adId` sigue siendo un candidato: los
    // genéricos («Adquiérelo ahora») se resuelven por id, no por lo que dicen.
    if (titulo || adId) return { crudo: titulo ?? "", fuente: "anuncio", adId };
  }

  return null;
}
