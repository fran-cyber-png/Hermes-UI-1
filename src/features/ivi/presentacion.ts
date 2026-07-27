/**
 * CÓMO SE DIBUJA UNA RESPUESTA DE IVI — puro, para poder discutirlo con un test.
 *
 * ══ POR QUÉ ESTO NO ES UN `switch` ADENTRO DEL JSX ═══════════════════════════
 *
 * El 2026-07-25 se midió en vivo que Ivi reportaba datos de **12 días** como `HECHO`. Toda
 * la capa de honestidad de Ivi —los tres tipos, `grounding_ok`, `edad_del_dato`— existe por
 * ese incidente. Si la app la aplana, la capa no protege a nadie: solo hace sentir que sí.
 *
 * Lo que hace que ESO no pase no es el CSS, es la regla de ruteo. Y una regla que vive
 * adentro de un componente no se puede interrogar sobre el caso que importa: **qué hace con
 * un tipo que todavía no existe**. Acá se puede, y el test lo fija.
 *
 * ══ LA REGLA, EN UNA LÍNEA ═══════════════════════════════════════════════════
 *
 * Un tipo desconocido se degrada a `CONTEXTO` — lo conservador. **Nunca a `HECHO`, nunca un
 * throw.** Ivi hace crecer su enum sin coordinar releases con Hermes (por eso su schema es
 * `z.object()` y no `.strict()`); la contraparte de esa libertad es que el consumidor tolere
 * el valor nuevo sin ascenderlo de categoría.
 */

export const TIPO_IVI = {
  /** Un número del SDK `governa.*`, determinista. Se muestra con confianza, citando la fuente. */
  HECHO: 'HECHO',
  /** Texto de un documento citado. Se muestra como contexto, NO como cifra. */
  CONTEXTO: 'CONTEXTO',
  /** Ivi no sabe. Se muestra tal cual: es una respuesta, no una falla. */
  SIN_EVIDENCIA: 'SIN_EVIDENCIA',
} as const;

export type TipoIvi = (typeof TIPO_IVI)[keyof typeof TIPO_IVI];

export interface Presentacion {
  /** Con qué cara se dibuja. Un tipo nuevo se dibuja como `CONTEXTO`. */
  tipo: TipoIvi;
  /** `false` = Ivi mandó un tipo que esta versión de Hermes no conoce. */
  reconocido: boolean;
  /** Lo que vino, tal cual. Se muestra en letra chica cuando no se reconoce, en vez de tragárselo. */
  crudo: string;
}

const CONOCIDOS = new Set<string>(Object.values(TIPO_IVI));

/**
 * A qué rama va una respuesta según su `tipo`.
 *
 * El casing y los espacios se toleran —son ruido de transporte, no un tipo distinto— pero
 * nada más: `HECHO_DEBIL` es una palabra nueva y va a la rama conservadora.
 */
export function presentacionDe(crudo: unknown): Presentacion {
  const texto = typeof crudo === 'string' ? crudo : crudo === undefined || crudo === null ? '' : String(crudo);
  const normal = texto.trim().toUpperCase();
  if (CONOCIDOS.has(normal)) return { tipo: normal as TipoIvi, reconocido: true, crudo: texto };
  return { tipo: TIPO_IVI.CONTEXTO, reconocido: false, crudo: texto };
}

// ── Las fuentes ──────────────────────────────────────────────────────────────

export interface Fuente {
  /** `sdk` = una tool determinista; `documento` = una cita del corpus. Se dibujan distinto. */
  clase: 'sdk' | 'documento';
  etiqueta: string;
  /** El camino adentro del documento («Pagos › Cuotas»), o `null`. */
  detalle: string | null;
}

/** Las claves con las que una fuente-objeto se nombra a sí misma, en orden de preferencia. */
const CLAVES_DE_FUENTE = ['cita', 'fuente', 'titulo', 'nombre', 'ref'] as const;

/**
 * Traduce las fuentes crudas de Ivi a algo que una vendedora pueda leer.
 *
 * La gramática real (`rag/ask.py:497` y `:554`) es de STRINGS: `SDK:<tool>` para lo que
 * salió de una herramienta determinista, y `<doc> › <sección> › <subsección>` para lo citado
 * del corpus. El contrato de Hermes las tipa como `unknown[]` a propósito (no rechazar una
 * respuesta buena por la forma de un adorno), así que acá se aguanta cualquier cosa —
 * pero **nada se descarta en silencio**: una fuente que no se entiende se muestra igual.
 * Una cita que desaparece es peor que una cita fea.
 */
export function fuentesLegibles(fuentes: unknown[] | undefined): Fuente[] {
  if (!Array.isArray(fuentes)) return [];
  return fuentes.map(unaFuente).filter((f): f is Fuente => f !== null);
}

function unaFuente(cruda: unknown): Fuente | null {
  const texto = textoDeFuente(cruda);
  if (!texto) return null;
  if (texto.startsWith('SDK:')) {
    return { clase: 'sdk', etiqueta: texto.slice('SDK:'.length).trim() || texto, detalle: null };
  }
  const partes = texto.split('›').map((p) => p.trim()).filter(Boolean);
  if (partes.length > 1) return { clase: 'documento', etiqueta: partes[0], detalle: partes.slice(1).join(' › ') };
  return { clase: 'documento', etiqueta: texto, detalle: null };
}

function textoDeFuente(cruda: unknown): string {
  if (typeof cruda === 'string') return cruda.trim();
  if (typeof cruda === 'number' || typeof cruda === 'boolean') return String(cruda);
  if (cruda && typeof cruda === 'object') {
    const obj = cruda as Record<string, unknown>;
    for (const clave of CLAVES_DE_FUENTE) {
      if (typeof obj[clave] === 'string' && obj[clave].trim()) return obj[clave].trim();
    }
    // Ni una clave conocida: se muestra el JSON antes que perder la cita.
    try {
      return JSON.stringify(cruda);
    } catch {
      return '(fuente ilegible)';
    }
  }
  return '';
}

// ── La frescura ──────────────────────────────────────────────────────────────

export interface Frescura {
  /** `false` = Ivi NO midió la edad del dato. No es «fresco»: es «no se sabe». */
  medido: boolean;
  texto: string;
}

const NO_MEDIDO: Frescura = {
  medido: false,
  texto: 'no se puede confirmar cuán fresco es este dato',
};

/**
 * Qué decir sobre la edad del dato.
 *
 * `edad_del_dato: null` es **no medido**, y eso NO es «fresco». Hoy Ivi manda `null` casi
 * siempre (el SDK todavía no emite la cabecera de frescura), así que este es el camino
 * normal y no el raro — razón de más para que se lea y no para que se calle. El silencio
 * ahí es exactamente lo que dejó pasar un dato de 12 días como si fuera de hoy.
 */
export function lecturaDeFrescura(edad: string | number | null | undefined): Frescura {
  if (edad === null || edad === undefined) return NO_MEDIDO;
  if (typeof edad === 'string') {
    const t = edad.trim();
    return t ? { medido: true, texto: t } : NO_MEDIDO;
  }
  if (!Number.isFinite(edad) || edad < 0) return NO_MEDIDO;
  const s = Math.floor(edad);
  if (s < 60) return { medido: true, texto: 'del último minuto' };
  if (s < 3_600) return { medido: true, texto: hace(s / 60, 'minuto') };
  if (s < 86_400) return { medido: true, texto: hace(s / 3_600, 'hora') };
  return { medido: true, texto: hace(s / 86_400, 'día') };
}

function hace(cantidad: number, unidad: 'minuto' | 'hora' | 'día'): string {
  const n = Math.round(cantidad);
  return `de hace ${n} ${unidad}${n === 1 ? '' : 's'}`;
}

// ── Las cifras que el grounding no pudo verificar ────────────────────────────

/** Normaliza `numeros_no_verificados` a texto señalable. Lo que no se puede señalar, se cae. */
export function cifrasDudosas(lista: unknown[] | undefined): string[] {
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  for (const item of lista) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const t = String(item).trim();
    if (t) vistas.add(t);
  }
  return [...vistas];
}

export interface Tramo {
  texto: string;
  /** `true` = esta cifra no se pudo casar contra los datos. */
  dudoso: boolean;
}

const ESPECIALES = /[.*+?^${}()|[\]\\]/g;

/**
 * Parte el texto de la respuesta en tramos, marcando las cifras que el grounding no
 * verificó. Ese es el pedido literal de Ivi: **marcalas, no descartes la respuesta entera**
 * — el resto del texto puede estar perfecto, y tirarlo por una cifra sería exagerar en la
 * dirección opuesta al incidente.
 *
 * Las cifras se ordenan de más larga a más corta antes de armar la alternancia: si no, «12»
 * se comería la mitad de «12 %» y la marca quedaría partida a la vista.
 */
export function tramosMarcados(texto: string, cifras: string[]): Tramo[] {
  const utiles = [...cifras].filter(Boolean).sort((a, b) => b.length - a.length);
  if (utiles.length === 0) return [{ texto, dudoso: false }];

  const patron = new RegExp(utiles.map((c) => c.replace(ESPECIALES, '\\$&')).join('|'), 'g');
  const tramos: Tramo[] = [];
  let cursor = 0;
  for (const m of texto.matchAll(patron)) {
    const i = m.index;
    if (i > cursor) tramos.push({ texto: texto.slice(cursor, i), dudoso: false });
    tramos.push({ texto: m[0], dudoso: true });
    cursor = i + m[0].length;
  }
  if (cursor < texto.length) tramos.push({ texto: texto.slice(cursor), dudoso: false });
  return tramos.length ? tramos : [{ texto, dudoso: false }];
}
