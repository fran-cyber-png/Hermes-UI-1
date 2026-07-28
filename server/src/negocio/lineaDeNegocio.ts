/**
 * ESCUELA O CONSULTORÍA — de qué NEGOCIO es este lead.
 *
 * Goberna vende dos cosas distintas por el mismo WhatsApp: la **Escuela**
 * (cursos, diplomados, seminarios) y la **Consultoría & Estrategia** (diagnóstico
 * y acompañamiento de campaña). Hasta hoy Hermes solo sabía de la primera, así
 * que a un lead de consultoría **lo obligaba a ser un curso**: el sistema le
 * buscaba familia, no la encontraba, y terminaba mostrando el curso menos malo.
 *
 * Medido en producción el 27-jul-2026 sobre 30 días, así se veía en pantalla:
 *
 *   · Isabel  → «Oratoria para Políticos · del formulario» — un formulario de
 *               hace ONCE MESES ganándole al anuncio por el que escribió hoy.
 *   · Cliver  → «Bicameral · del formulario» — ídem, de hace dos meses.
 *   · ROYER   → «¿Estás listo para ganar esta elección? · del anuncio» — el copy
 *               del anuncio mostrado como si fuera un curso.
 *
 * Los tres habían escrito exactamente lo mismo: «Hola. Quiero más información
 * sobre el servicio de Consultoría.»
 *
 * Arreglar la precedencia no alcanzaba: aunque eligiera perfecto, seguiría
 * eligiendo **un curso para alguien que no quiere ningún curso**. Lo que faltaba
 * era poder decir «esto no es de la Escuela».
 *
 * ── POR QUÉ ESTO NO CONTRADICE «no se infiere leyendo el mensaje» ────────────
 *
 * `cursos/precedencia.ts` prohíbe deducir el CURSO del texto libre, y con razón:
 * una atribución inventada es peor que una fila sin atribuir. Acá no se infiere
 * nada de texto libre — se reconoce el **texto PRELLENADO por el anuncio**, que
 * es una cadena fija que escribe Meta, no la persona. Medido: 8 de 8 idénticas
 * carácter por carácter. Es evidencia, no interpretación.
 *
 * Por eso el reconocimiento es ESTRECHO a propósito (`servicio de consultoría`,
 * la frase entera) y no un `contains('consultor')`: en el mismo corpus hay un
 * volcado de formulario que incluye la palabra «Consult» suelta y un mensaje que
 * pregunta por un diploma. Ninguno de los dos es un lead de consultoría, y un
 * criterio ancho se los habría llevado puestos.
 *
 * ── DERIVADA, NO GUARDADA ───────────────────────────────────────────────────
 *
 * Como las señales (ADR 0015), la etapa efectiva (0013) y `no_leido` (0014): se
 * calcula en cada consulta. No hay columna, no hay job, no hay una segunda
 * escritura que pueda divergir.
 */

export const LINEAS_DE_NEGOCIO = ['escuela', 'consultoria'] as const;
export type LineaDeNegocio = (typeof LINEAS_DE_NEGOCIO)[number];

/** Cómo se llama cada una en pantalla. */
export const NOMBRE_NEGOCIO: Record<LineaDeNegocio, string> = {
  escuela: 'Escuela',
  consultoria: 'Consultoría',
};

/** Sin tildes y en minúsculas: «CONSULTORÍA» y «consultoria» son lo mismo. */
function plano(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * El prellenado del anuncio de Consultoría. La frase ENTERA, no la palabra:
 * ver la cabecera sobre por qué el criterio ancho da falsos positivos.
 */
const FRASE_CONSULTORIA = 'servicio de consultoria';

/**
 * El nombre de campaña dice el negocio cuando existe: `[JUL] CONSULTORÍA | CP |
 * WSP`. Es lo AFIRMADO por quien armó la pauta, así que le gana al texto.
 */
const CAMPANA_CONSULTORIA = 'consultoria';

export interface SenalesDeNegocio {
  /** El primer mensaje ENTRANTE de la conversación (el que trae el prellenado). */
  textoPrimerEntrante?: string | null;
  /** El nombre de la campaña del anuncio, si se conoce. */
  campana?: string | null;
}

/**
 * De qué negocio es. **`escuela` es el default y no es un empate**: es el
 * negocio de toda la vida y el 99 % del volumen — decir «consultoría» sin
 * evidencia sería mandar un lead de curso al guión equivocado.
 */
export function lineaDeNegocio(s: SenalesDeNegocio): LineaDeNegocio {
  if (plano(s.campana).includes(CAMPANA_CONSULTORIA)) return 'consultoria';
  if (plano(s.textoPrimerEntrante).includes(FRASE_CONSULTORIA)) return 'consultoria';
  return 'escuela';
}

/**
 * ¿Este lead es de consultoría? Azúcar para los llamadores, que casi siempre
 * preguntan esto y no «cuál de las dos».
 */
export function esConsultoria(s: SenalesDeNegocio): boolean {
  return lineaDeNegocio(s) === 'consultoria';
}
