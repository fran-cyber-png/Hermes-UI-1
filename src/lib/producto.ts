/**
 * LA IDENTIDAD DE UN CURSO — familia, edición y nombre corto (#129).
 *
 * El catálogo de la Escuela son **111 productos activos que en realidad son 38
 * familias con ediciones**: «Diploma de Especialización en Inteligencia y
 * Contrainteligencia **14**», «Diploma Internacional de Inteligencia y
 * Contrainteligencia», «diploma internacional de inteligencia y
 * contrainteligencia 26» son EL MISMO diploma con tres redacciones y tres
 * números. Un chip de 360 px no puede mostrar eso, y una vendedora no puede
 * elegir entre cinco «Diploma de Especializaci…» truncados iguales.
 *
 * Este módulo es la respuesta, y es PURO a propósito: lo necesitan el chip de
 * curso de la cola (#72), el autocompletado de intereses (#129), el interés
 * derivado del anuncio (#102) y el dashboard por curso (#128). Una sola
 * implementación para los cuatro.
 *
 *   · `familia`    — la identidad canónica: el PREFIJO ALFABÉTICO DEL SKU
 *                    (`DIPICOT014` → `DIPICOT`), que es más confiable que el
 *                    nombre. Sin SKU (el caso de la cola, que solo tiene texto),
 *                    el nombre corto normalizado sin acentos ni mayúsculas.
 *   · `edicion`    — el sufijo numérico del nombre, o `null`.
 *   · `nombreCorto`— lo que se lee: el nombre sin el calificativo de adelante
 *                    («Diploma Internacional de…») ni la edición de atrás.
 *
 * NO adivina: si el nombre es solo calificativos, devuelve el original antes que
 * una cadena vacía.
 */

export interface FamiliaProducto {
  /** Identidad canónica para agrupar y para elegir color. Nunca vacía si hay nombre. */
  familia: string;
  /** El número de edición del nombre, si lo tiene. */
  edicion: number | null;
  /** El nombre legible, sin calificativo ni edición. */
  nombreCorto: string;
}

/**
 * Las palabras que en el catálogo NO distinguen un curso de otro: aparecen al
 * principio de casi todos los nombres. Se sacan de adelante hasta topar con la
 * primera palabra que sí dice algo. Van sin acentos: la comparación normaliza.
 */
const CALIFICATIVOS = new Set([
  'diploma',
  'diplomado',
  'curso',
  'programa',
  'taller',
  'seminario',
  'certificacion',
  'especializacion',
  'internacional',
  'nacional',
  'elite',
  'tecnico',
  'tecnica',
  'superior',
  'avanzado',
  'profesional',
  'de',
  'del',
  'en',
  'la',
  'el',
  'los',
  'las',
]);

/** Sin acentos y en minúsculas — para comparar, nunca para mostrar. */
function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * La edición es el número CORTO del final (1–3 dígitos). Un año («I FORO DE
 * ESTADO 2026») tiene cuatro y no es una edición: confundirlos rompería el
 * nombre de un evento para inventar una edición que no existe.
 */
function partirEdicion(nombre: string): { base: string; edicion: number | null } {
  const m = /^(.*?)[\s.-]+(\d{1,3})$/.exec(nombre);
  if (!m) return { base: nombre, edicion: null };
  return { base: m[1], edicion: Number(m[2]) };
}

/** Saca de adelante la corrida de calificativos; para en la primera palabra útil. */
function sacarCalificativos(base: string): string {
  const palabras = base.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < palabras.length && CALIFICATIVOS.has(sinAcentos(palabras[i]))) i++;
  return palabras.slice(i).join(' ');
}

/** La clave de agrupación cuando no hay SKU: solo letras y dígitos, sin acentos. */
function claveDeNombre(nombreCorto: string): string {
  return sinAcentos(nombreCorto)
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase();
}

/**
 * El prefijo alfabético del SKU es la familia — salvo los `GEN*`, que son SKUs
 * genéricos SIN familia (`GEN9000F6`, `GEN5C2G3`): colapsarlos en un solo
 * «GEN» juntaría cosas que no tienen nada que ver. Cada uno es su propia familia.
 */
function familiaDeSku(sku: string): string | null {
  const limpio = sku.trim().toUpperCase();
  const m = /^([A-Z]+)/.exec(limpio);
  if (!m) return null;
  return m[1] === 'GEN' ? limpio : m[1];
}

export function familiaDeProducto(sku: string | null | undefined, nombre: string): FamiliaProducto {
  const entero = (nombre ?? '').trim().replace(/\s+/g, ' ');
  const { base, edicion } = partirEdicion(entero);
  const podado = sacarCalificativos(base).trim();
  // Si podar dejó la cadena vacía, el nombre ERA todo calificativo: se muestra
  // entero antes que un chip en blanco.
  const nombreCorto = podado || entero;

  const desdeSku = sku ? familiaDeSku(sku) : null;
  return { familia: desdeSku ?? claveDeNombre(nombreCorto), edicion, nombreCorto };
}
