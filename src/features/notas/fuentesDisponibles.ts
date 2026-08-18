/**
 * QUÉ FUENTES OFRECER — las que EXISTEN en esta máquina, medidas.
 *
 * ══ POR QUÉ NO SE PREGUNTA AL SISTEMA ═══════════════════════════════════════
 *
 * La API que enumera las fuentes instaladas es `window.queryLocalFonts()`, y no
 * sirve acá por tres motivos independientes:
 *
 *   · es **experimental y solo de Chromium** — la cáscara corre WKWebView en
 *     macOS, donde directamente no existe;
 *   · **dispara un permiso** al usuario, adentro de un CRM, para elegir una
 *     fuente;
 *   · exige contexto seguro, y en desarrollo se entra por `http://localhost`.
 *
 * ══ LO QUE SÍ FUNCIONA: MEDIR ══════════════════════════════════════════════
 *
 * Se dibuja el mismo texto con la fuente candidata y con una genérica, y se
 * comparan los anchos. Si la fuente no está instalada, el navegador cae a la
 * genérica y los dos anchos dan **idénticos**. Es la técnica que usan por dentro
 * `fontfaceobserver` y `font-detective`; son ~25 líneas, así que no se suma una
 * dependencia — el mismo criterio con el que ADR 0038 dejó ffmpeg self-hosted en
 * vez de traerlo de un CDN.
 *
 * 🔴 **Se miden las TRES genéricas, no una.** Con una sola, cualquier fuente que
 * por casualidad mida igual que `monospace` se reporta ausente — y al revés, una
 * ausente cuya genérica de respaldo mida distinto se reporta presente. Con tres,
 * hace falta que las tres coincidan para declararla ausente.
 *
 * ══ LO QUE ESTO COMPRA, Y ES EL PEDIDO ═════════════════════════════════════
 *
 * La lista deja de tener fuentes que en esa máquina **se ven todas iguales**:
 * si `Optima` no está instalada, no aparece. Sin esto, el selector ofrece
 * treinta nombres y la mitad pinta exactamente lo mismo, que es imposible de
 * entender mirando.
 */

export interface Fuente {
  /** Lo que se lee en el selector. */
  nombre: string;
  /** Lo que se guarda y va a `style`. */
  css: string;
}

/**
 * LAS CANDIDATAS.
 *
 * Cubren Windows y macOS, que son las dos plataformas donde corre la cáscara, más
 * **Montserrat**, que es la de la marca y viaja con la app (`@fontsource`), así
 * que está siempre.
 *
 * La lista es de CANDIDATAS, no de resultados: lo que llega al selector es lo que
 * sobrevive a la medición. Agregar una acá no rompe nada — si no está instalada,
 * no se ofrece.
 */
export const FUENTES_CANDIDATAS: readonly Fuente[] = [
  { nombre: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { nombre: 'Montserrat', css: 'Montserrat, sans-serif' },
  { nombre: 'Calibri', css: 'Calibri, sans-serif' },
  { nombre: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { nombre: 'Helvetica Neue', css: '"Helvetica Neue", Helvetica, sans-serif' },
  { nombre: 'Segoe UI', css: '"Segoe UI", sans-serif' },
  { nombre: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { nombre: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
  { nombre: 'Trebuchet MS', css: '"Trebuchet MS", sans-serif' },
  { nombre: 'Gill Sans', css: '"Gill Sans", "Gill Sans MT", sans-serif' },
  { nombre: 'Futura', css: 'Futura, sans-serif' },
  { nombre: 'Optima', css: 'Optima, sans-serif' },
  { nombre: 'Avenir', css: 'Avenir, sans-serif' },
  { nombre: 'Avenir Next', css: '"Avenir Next", Avenir, sans-serif' },
  { nombre: 'Franklin Gothic', css: '"Franklin Gothic Medium", sans-serif' },
  { nombre: 'Century Gothic', css: '"Century Gothic", sans-serif' },
  { nombre: 'Candara', css: 'Candara, sans-serif' },
  { nombre: 'Corbel', css: 'Corbel, sans-serif' },
  { nombre: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { nombre: 'Georgia', css: 'Georgia, serif' },
  { nombre: 'Garamond', css: 'Garamond, serif' },
  { nombre: 'Cambria', css: 'Cambria, serif' },
  { nombre: 'Constantia', css: 'Constantia, serif' },
  { nombre: 'Palatino', css: 'Palatino, "Palatino Linotype", serif' },
  { nombre: 'Book Antiqua', css: '"Book Antiqua", Palatino, serif' },
  { nombre: 'Baskerville', css: 'Baskerville, serif' },
  { nombre: 'Didot', css: 'Didot, serif' },
  { nombre: 'Courier New', css: '"Courier New", Courier, monospace' },
  { nombre: 'Consolas', css: 'Consolas, monospace' },
  { nombre: 'Monaco', css: 'Monaco, monospace' },
  { nombre: 'Menlo', css: 'Menlo, monospace' },
  { nombre: 'Lucida Console', css: '"Lucida Console", monospace' },
  { nombre: 'Comic Sans MS', css: '"Comic Sans MS", cursive' },
  { nombre: 'Brush Script MT', css: '"Brush Script MT", cursive' },
  { nombre: 'Impact', css: 'Impact, fantasy' },
  { nombre: 'Papyrus', css: 'Papyrus, fantasy' },
];

/** La que se usa cuando nadie eligió nada. Tiene que estar en las candidatas. */
export const FUENTE_POR_DEFECTO = 'Arial';

const GENERICAS = ['monospace', 'sans-serif', 'serif'] as const;
/** Mezcla anchos y angostos: una diferencia chica se nota más sobre muchas letras. */
const MUESTRA = 'mmmmmmmmmmlliWWWQQ';
const CUERPO = '72px';

/**
 * El nombre de la familia, sin la cascada de respaldo: medir `"Optima, sans-serif"`
 * siempre da presente, porque el respaldo existe. Hay que medir `Optima` sola.
 */
function familiaSola(css: string): string {
  const primera = css.split(',')[0]!.trim();
  return primera.replace(/^["']|["']$/g, '');
}

/**
 * Cuáles de las candidatas están instaladas.
 *
 * Recibe el contexto de canvas para poder testear la decisión sin navegador: el
 * patrón puro+wrapper de la casa. Sin canvas —jsdom no lo trae— devuelve la lista
 * entera, que es el degradado honesto: se ofrecen de más, nunca de menos.
 */
export function fuentesInstaladas(
  candidatas: readonly Fuente[] = FUENTES_CANDIDATAS,
  medir?: (texto: string, font: string) => number,
): Fuente[] {
  if (!medir) return [...candidatas];

  const base = new Map(GENERICAS.map((g) => [g, medir(MUESTRA, `${CUERPO} ${g}`)]));

  return candidatas.filter((f) => {
    const familia = familiaSola(f.css);
    // Está instalada si con ALGUNA genérica de respaldo el ancho cambia. Si con
    // las tres da igual, el navegador está cayendo al respaldo: no está.
    return GENERICAS.some((g) => medir(MUESTRA, `${CUERPO} "${familia}", ${g}`) !== base.get(g));
  });
}

/** El medidor real. Vive aparte porque toca el DOM. */
export function medidorDeCanvas(): ((texto: string, font: string) => number) | undefined {
  if (typeof document === 'undefined') return undefined;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return undefined;
  return (texto, font) => {
    ctx.font = font;
    return ctx.measureText(texto).width;
  };
}
