import { cursoDeFila, type CursoDeFila, type EntradaCurso } from '../canales/curso';

/**
 * QUÉ QUIERE — el bloque donde se traba el CRM entero.
 *
 * ── El número que lo explica todo ──
 * **611 conversaciones con precio enviado y UN (1) interés registrado.** La
 * compuerta de «Cotizado» exige interés, así que ese 1 contra 611 es el embudo
 * mintiendo todos los días. No es que las vendedoras no sepan qué curso quiere
 * cada quien: es que registrarlo cuesta abrir un buscador, tipear y elegir —
 * mientras el sistema **ya tiene el dato en la mano**, impreso dos centímetros
 * más arriba en la misma pantalla (el chip de la fila, el cintillo «Vino del
 * anuncio», el bloque del formulario).
 *
 * Entonces la decisión es: cuando el interés ya está registrado, se muestra;
 * cuando NO está pero el sistema lo sabe, **se propone y se registra con un
 * clic**, diciendo de dónde salió. Nunca se registra solo: sigue siendo una
 * acción humana, porque lo que se asienta acá abre una compuerta del embudo.
 *
 * La precedencia de las fuentes NO se decide acá: ya vive en `canales/curso.ts`
 * (#72, cerrada por el dueño) — interés > formulario > anuncio. Reusarla es lo
 * que garantiza que el chip de la cola y esta propuesta digan lo mismo. Cuando
 * `feat/interes-derivado` enriquezca el curso que llega del anuncio, entra por
 * `ultima_origen` y este bloque lo hereda sin tocar una línea.
 */

export type DecisionInteres =
  /** Ya está asentado: se muestran los chips reales (con su línea de tiempo). */
  | { modo: 'registrado' }
  /** No está, pero lo sabemos: un clic y queda. */
  | { modo: 'propuesta'; curso: CursoDeFila; porque: string }
  /** No está y no lo sabemos: se pide, no se adivina. */
  | { modo: 'vacio' };

/** De dónde salió la propuesta, en la voz de la vendedora. */
export function porQueSePropone(curso: CursoDeFila): string {
  if (curso.fuente === 'lead') return 'Lo puso en el formulario';
  return 'Vino de este anuncio';
}

export function decidirInteres(
  registrados: readonly string[],
  fila: EntradaCurso,
): DecisionInteres {
  if (registrados.length > 0) return { modo: 'registrado' };

  const curso = cursoDeFila(fila);
  // `fuente: 'interes'` significa que la fila trae un interés asentado; si la
  // lista vino vacía es que el caché de la fila está viejo. Proponer lo que ya
  // está registrado sería ofrecerle a la vendedora que registre dos veces.
  if (!curso || curso.fuente === 'interes') return { modo: 'vacio' };

  return { modo: 'propuesta', curso, porque: porQueSePropone(curso) };
}
