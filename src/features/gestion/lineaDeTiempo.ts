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

/** La propuesta que manda el server (#102): lo que se deduce, sin asentar. */
export interface InteresDerivado {
  /** El curso al que mapeó el anuncio/formulario. `null` = no mapeó (no se inventa). */
  curso: string | null;
  familia: string | null;
  fuente: 'lead' | 'anuncio';
  /** El texto crudo del que salió: la campaña del anuncio o el curso del formulario. */
  textoOrigen: string;
}

export interface RespuestaIntereses {
  /** Forma vieja/retrocompat: clave → cursos (sin fecha). */
  intereses?: Record<string, string[]>;
  /** Forma nueva (#57): clave → intereses con su fecha. */
  interesesDetalle?: Record<string, { curso: string; creadoAt: string }[]>;
  /** Más nueva (#102): el interés DERIVADO del anuncio, para las que no tienen ninguno. */
  derivados?: Record<string, InteresDerivado>;
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

/** Lo que la ficha necesita para pintar la propuesta, ya resuelto. */
export interface PropuestaCurso {
  /** Lo que se lee en el chip: el curso mapeado o, si no mapeó, el título crudo. */
  texto: string;
  /** «del anuncio» | «del formulario» — de dónde salió, dicho siempre. */
  origen: string;
  /** ¿Hay curso al que confirmar? Sin mapeo no hay botón: se busca y se registra a mano. */
  confirmable: boolean;
  /** El `title` completo, con el texto crudo a la vista para poder desconfiar. */
  detalle: string;
}

/**
 * LA PROPUESTA DE CURSO PARA UNA CONVERSACIÓN (#102), o `null` si no hay ninguna.
 *
 * El server ya aplica la precedencia (lo registrado manda), pero acá se vuelve a
 * aplicar sobre `registrados` a propósito: el caché persistido (ADR 0007) puede
 * traer una respuesta vieja con propuesta mientras la lista de intereses ya se
 * refrescó, y proponer al lado de un interés asentado sería discutirle a quien
 * habló con la persona.
 *
 * NUNCA inventa: sin mapeo, el chip muestra el título del anuncio tal cual y no
 * ofrece confirmar nada.
 */
export function propuestaDeCurso(
  d: RespuestaIntereses,
  clave: string,
  registrados: readonly InteresRegistrado[],
): PropuestaCurso | null {
  if (registrados.length > 0) return null;
  const derivado = d.derivados?.[clave];
  if (!derivado) return null;

  const origen = derivado.fuente === 'anuncio' ? 'del anuncio' : 'del formulario';
  const confirmable = Boolean(derivado.curso);
  return {
    texto: derivado.curso ?? derivado.textoOrigen,
    origen,
    confirmable,
    detalle: confirmable
      ? `${derivado.curso} — deducido ${origen} «${derivado.textoOrigen}». Confirmá para registrarlo.`
      : `Vino ${origen} «${derivado.textoOrigen}», que no está mapeado a ningún curso: buscalo y registralo.`,
  };
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
