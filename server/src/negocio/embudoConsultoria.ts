/**
 * EL EMBUDO DE CONSULTORÍA — tres estados, y el que importa es el del medio.
 *
 * Consultoría no se vende como un curso. No hay precio que pasar ni temario que
 * mandar: Walter se presenta y **pide dos datos** —nombre completo y a qué
 * campaña se postula— para armar un diagnóstico gratuito que después toma un
 * Consultor Senior. Así que el embudo de la Escuela (interesado → cotizado →
 * cierre) no lo describe; forzarlo ahí obliga a «cotizar» algo que no se cotiza.
 *
 * Los tres estados, tal como se ven en un chat real (27-jul-2026):
 *
 *   viernes 23:45  ella  → «Hola. Quiero más información sobre el servicio…»   NUEVO
 *   sábado  10:20  él    → presentación + pedido de datos                       ESPERANDO
 *   sábado  14:26  ella  → «Makay arévalo»
 *                         «Postulo a la municipalidad provincial de ucayali»
 *                         «Por el partido de renovación popular»                CALIENTE 🔥
 *
 * **Contestar el pedido de datos es la señal de calificación más barata que
 * tiene este negocio.** No hay que interpretarla ni pedirle nada más a nadie:
 * quien se tomó el trabajo de escribir su nombre y su municipalidad ya decidió
 * que quiere hablar. Ese es el que va primero, y el que se le pasa al Consultor
 * Senior.
 *
 * ── DERIVADO, NO GUARDADO ───────────────────────────────────────────────────
 *
 * Como las señales (ADR 0015), la etapa efectiva (0013) y `no_leido` (0014): se
 * calcula sobre el hilo en cada consulta. No hay columna que mantener ni job que
 * se pueda atrasar, y —lo que importa— **no hay una segunda escritura que pueda
 * divergir** de lo que el chat dice (la lección de #37).
 *
 * ── LO QUE ESTO NO HACE ─────────────────────────────────────────────────────
 *
 * No lee QUÉ contestó: no intenta sacar el nombre ni la campaña del texto. Eso
 * sería inferir de texto libre, que es justo lo que `cursos/precedencia.ts`
 * prohíbe y por buenas razones. Acá solo se afirma **que contestó**, que es un
 * hecho del hilo y no una interpretación. Extraer los datos es otro trabajo, y
 * si algún día se hace, tiene que poder equivocarse sin ensuciar esto.
 */

export const ESTADOS_CONSULTORIA = ['nuevo', 'esperando', 'caliente'] as const;
export type EstadoConsultoria = (typeof ESTADOS_CONSULTORIA)[number];

/** Cómo se lee cada estado, y por qué está ahí. */
export const LECTURA_CONSULTORIA: Record<EstadoConsultoria, { rotulo: string; porque: string }> = {
  nuevo: {
    rotulo: 'Sin contestar',
    porque: 'Escribió pidiendo información y todavía nadie le respondió.',
  },
  esperando: {
    rotulo: 'Esperando sus datos',
    porque: 'Ya se le pidió nombre y campaña; todavía no contestó.',
  },
  caliente: {
    rotulo: 'Mandó sus datos',
    porque: 'Contestó el pedido de datos: está listo para un Consultor Senior.',
  },
};

export interface HiloDeConsultoria {
  /** ¿Salió al menos un mensaje nuestro? */
  leEscribimos: boolean;
  /**
   * ¿Hay un entrante POSTERIOR al último saliente? Es la misma pregunta que
   * `resultados/medicion.ts` responde para medir una pieza, y a propósito: si
   * «contestó» significara dos cosas distintas en dos lugares del sistema,
   * cualquier reporte que las cruce sería basura.
   */
  contestoDespues: boolean;
}

/**
 * En qué punto del embudo está. **`caliente` exige las dos cosas**: que le
 * hayamos escrito Y que haya contestado después. Sin la primera, el entrante
 * inicial —que es lo que TODO lead manda— se leería como una respuesta, y
 * entonces estarían todos calientes y la marca no significaría nada.
 */
export function estadoDeConsultoria(h: HiloDeConsultoria): EstadoConsultoria {
  if (!h.leEscribimos) return 'nuevo';
  return h.contestoDespues ? 'caliente' : 'esperando';
}

/** ¿Va arriba de todo? Es lo que el negocio quiere atender primero. */
export function esCaliente(h: HiloDeConsultoria): boolean {
  return estadoDeConsultoria(h) === 'caliente';
}
