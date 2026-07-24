/**
 * LA LÍNEA DE TIEMPO DEL INTERÉS (#57) — lógica pura, testeable sin DOM.
 *
 * Un contacto que un día pregunta por un curso y a la semana por otro es un
 * perfil que se construye EN EL TIEMPO. Estas funciones toman la respuesta del
 * endpoint —la NUEVA con fecha o la VIEJA sin fecha (por el caché persistido en
 * IndexedDB, ADR 0007)— y la dejan lista para pintar: normalizada y agrupada por
 * día, en orden cronológico.
 *
 * El tiempo acá es HISTORIA, no urgencia: NADA de oro. El color lo pone el
 * componente, neutro (el dorado significa solo «tiempo que se acaba»).
 */

export interface InteresRegistrado {
  curso: string;
  /** ISO. `null` cuando viene del caché viejo (forma plana, sin fecha). */
  creadoAt: string | null;
}

export interface RespuestaIntereses {
  /** Forma vieja/retrocompat: clave → cursos (sin fecha). */
  intereses?: Record<string, string[]>;
  /** Forma nueva (#57): clave → intereses con su fecha. */
  interesesDetalle?: Record<string, { curso: string; creadoAt: string }[]>;
}

/**
 * Normaliza la respuesta del endpoint para UNA clave. Tolera las dos formas: la
 * nueva (`interesesDetalle`, con fecha) y la vieja/cacheada (`intereses`, plana).
 * Así un caché persistido de la versión anterior sigue pintando (sin fecha) en
 * vez de romper.
 */
export function normalizarIntereses(d: RespuestaIntereses, clave: string): InteresRegistrado[] {
  const detalle = d.interesesDetalle?.[clave];
  if (detalle) return detalle.map((i) => ({ curso: i.curso, creadoAt: i.creadoAt }));
  const planos = d.intereses?.[clave] ?? [];
  return planos.map((curso) => ({ curso, creadoAt: null }));
}

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export interface GrupoLineaDeTiempo {
  /** Clave de día `YYYY-MM-DD` en la zona dada; `''` para los sin fecha. */
  dia: string;
  /** «1 jul» — vacío cuando el interés no trae fecha. */
  etiqueta: string;
  cursos: string[];
}

/**
 * El día local de un ISO, en la zona dada (evita que el UTC corra la fecha).
 * `dia` queda en ISO `YYYY-MM-DD` (sirve de `dateTime` del `<time>`). La etiqueta
 * omite el año cuando es el año en curso y lo agrega si no («15 dic 25»): dentro
 * del ciclo de venta el año es ruido, pero un interés viejo tiene que delatarse.
 */
function diaLocal(
  creadoAt: string,
  timeZone: string,
  anioActual: number,
): { dia: string; etiqueta: string } | null {
  const t = new Date(creadoAt).getTime();
  if (Number.isNaN(t)) return null;
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(t));
  const val = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const anio = Number(val('year'));
  const mes = Number(val('month'));
  const dia = Number(val('day'));
  const sufijoAnio = anio !== anioActual ? ` ${String(anio).slice(-2)}` : '';
  return {
    dia: `${val('year')}-${val('month')}-${val('day')}`,
    etiqueta: `${dia} ${MESES_ES[mes - 1]}${sufijoAnio}`,
  };
}

/**
 * Ordena cronológicamente (el más viejo primero) y agrupa por día: si dos cursos
 * cayeron el mismo día, comparten fecha. Los sin fecha (caché viejo) van al final,
 * sin etiqueta. Zona por defecto America/Lima (la vendedora es peruana) y `hoy`
 * por defecto ahora — ambos inyectables para tests deterministas.
 */
export function agruparInteresesPorDia(
  items: readonly InteresRegistrado[],
  timeZone = 'America/Lima',
  hoy: Date = new Date(),
): GrupoLineaDeTiempo[] {
  const anioActual = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(hoy),
  );
  const conFecha: { dia: string; etiqueta: string; curso: string; t: number }[] = [];
  const sinFecha: string[] = [];
  for (const it of items) {
    if (!it?.curso) continue;
    const d = it.creadoAt ? diaLocal(it.creadoAt, timeZone, anioActual) : null;
    if (d) conFecha.push({ ...d, curso: it.curso, t: new Date(it.creadoAt as string).getTime() });
    else sinFecha.push(it.curso);
  }
  conFecha.sort((a, b) => a.t - b.t);

  const grupos: GrupoLineaDeTiempo[] = [];
  const porDia = new Map<string, GrupoLineaDeTiempo>();
  for (const it of conFecha) {
    let g = porDia.get(it.dia);
    if (!g) {
      g = { dia: it.dia, etiqueta: it.etiqueta, cursos: [] };
      porDia.set(it.dia, g);
      grupos.push(g);
    }
    if (!g.cursos.includes(it.curso)) g.cursos.push(it.curso);
  }
  if (sinFecha.length) {
    const cursos: string[] = [];
    for (const c of sinFecha) if (!cursos.includes(c)) cursos.push(c);
    grupos.push({ dia: '', etiqueta: '', cursos });
  }
  return grupos;
}
