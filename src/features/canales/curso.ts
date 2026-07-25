import { familiaDeProducto } from '../../lib/producto';
import { COLORES, type ColorCategoria } from '../gestion/paletaCategorias';

/**
 * EL CURSO DE UNA FILA DE LA COLA (#72) — qué quiere esta persona, en un chip.
 *
 * El «Pide info» de cada fila no ayuda a decidir a quién atender: lo dicen casi
 * todos los que escriben (el copy del anuncio de Click-to-WhatsApp ES «Hola
 * quiero más información del Diploma…»). Lo que SÍ decide es **qué curso**.
 *
 * La precedencia la cerró el dueño (#72, 2026-07-24) y la amplía el lead del
 * formulario, que es el dato masivo que hoy existe (26.075 leads):
 *
 *   1. **el interés registrado** — la vendedora lo escuchó y lo asentó: manda;
 *   2. **el curso del formulario** que la persona llenó (lead emparejado por
 *      teléfono) — lo eligió ella misma, es su declaración;
 *   3. **la campaña del anuncio** por el que escribió — es de dónde vino, no lo
 *      que dijo: respalda, no manda.
 *
 * Sin ninguna de las tres NO HAY CHIP. No se infiere el curso leyendo el texto
 * del mensaje (fuera de alcance de v1, decisión del dueño).
 *
 * El nombre se acorta con `familiaDeProducto` (#129): «Diploma de
 * Especialización en Inteligencia y Contrainteligencia 14» no entra en una fila
 * de 360 px, y sus tres redacciones son el mismo diploma.
 */

export type FuenteCurso = 'interes' | 'lead' | 'anuncio';

export interface CursoDeFila {
  /** El nombre corto, lo que se lee en el chip. */
  nombre: string;
  /** La identidad canónica de la familia — de acá sale el color. */
  familia: string;
  color: ColorCategoria;
  fuente: FuenteCurso;
}

/** Lo mínimo que el chip necesita de una conversación (así se testea sin el tipo entero). */
export interface EntradaCurso {
  /** El interés más reciente asentado para esta conversación (`intereses.curso`). */
  interes_curso?: string | null;
  /** El curso del formulario del lead emparejado por teléfono. */
  lead_curso?: string | null;
  ultima_origen?: { fuente: string; titulo?: string | null } | null;
}

/**
 * LA PALETA DEL CURSO: los `--cat-*` de #48 SIN el neutro (`pizarra`, que es
 * «etiqueta que no reconozco») y, por regla dura de la casa, **sin nada de la
 * familia del oro** — el oro en Hermes significa una sola cosa, tiempo que se
 * acaba. Un curso no es un reloj.
 */
export const PALETA_CURSO: readonly ColorCategoria[] = COLORES.filter((c) => c !== 'pizarra');

/**
 * Color por HASH del nombre de la familia: determinista (el mismo diploma se ve
 * siempre igual, en toda la cola y entre sesiones) y sin catálogo que mantener.
 * djb2, que reparte bien sobre pocos cubos.
 */
export function colorDeCurso(familia: string): ColorCategoria {
  let h = 5381;
  for (let i = 0; i < familia.length; i++) h = ((h << 5) + h + familia.charCodeAt(i)) >>> 0;
  return PALETA_CURSO[h % PALETA_CURSO.length];
}

/** Un texto sirve como fuente solo si dice algo. */
function util(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

export function cursoDeFila(c: EntradaCurso): CursoDeFila | null {
  const anuncio = c.ultima_origen?.fuente === 'anuncio' ? util(c.ultima_origen.titulo) : null;
  const candidatos: [FuenteCurso, string | null][] = [
    ['interes', util(c.interes_curso)],
    ['lead', util(c.lead_curso)],
    ['anuncio', anuncio],
  ];
  const elegido = candidatos.find(([, valor]) => valor !== null);
  if (!elegido) return null;

  const [fuente, crudo] = elegido;
  const { familia, nombreCorto } = familiaDeProducto(null, crudo!);
  return { nombre: nombreCorto, familia, color: colorDeCurso(familia), fuente };
}

/** El texto del `title`: dice de dónde salió el dato, para que el chip nunca mienta. */
export function detalleDeCurso(curso: CursoDeFila): string {
  if (curso.fuente === 'interes') return `Interés registrado: ${curso.nombre}`;
  if (curso.fuente === 'lead') return `Llenó el formulario de: ${curso.nombre}`;
  return `Vino del anuncio: ${curso.nombre}`;
}
