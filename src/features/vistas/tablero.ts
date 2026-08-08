import type { Etapa } from '../../lib/etapas';

/**
 * EL TABLERO HONESTO (#90) — la lógica pura del Pipeline, sin DOM.
 *
 * Interesados dejó de ser columna: es la bandeja de arriba (un contador real y
 * el acceso a Mensajes, donde ese trabajo de verdad se hace). Las columnas de
 * trabajo cargan POR etapa efectiva (`?etapa=`, #89) y acá se decide dónde cae
 * cada tarjeta cuando hay movimientos optimistas en el medio. VistaEmbudo solo
 * ejecuta; la política se fija con tests sin DOM (mismo patrón que
 * `compuertas.ts`).
 */

/**
 * Las columnas del tablero, en el orden del embudo. Interesado NO está: es
 * bandeja. Cada una lleva su `pista` (qué significa estar acá) y su `vacio` (qué
 * hacer para que deje de estar vacía) — una columna en cero que no explica cómo
 * se llena es la mitad del problema de esta pantalla.
 */
export const COLUMNAS_TRABAJO = [
  {
    id: 'contactado',
    titulo: 'Contactados',
    pista: 'Les hablaste y no volvieron. Se llena solo.',
    vacio: 'Cuando le respondas a alguien, aparece acá.',
  },
  {
    id: 'cotizado',
    titulo: 'Cotizados',
    pista: 'Saben el precio y el curso.',
    vacio: 'Marcá «Cotizado» en una tarjeta con precio enviado, o arrastrala acá.',
  },
  {
    id: 'cierre',
    titulo: 'Cierre',
    pista: 'No se declara: se gana con la venta.',
    vacio: 'Registrá la venta desde la ficha y la tarjeta llega sola.',
  },
  {
    id: 'perdido',
    titulo: 'Perdidos',
    pista: 'Lo dijiste vos. No vuelve solo.',
    vacio: 'Nada descartado.',
  },
] as const;

export type EtapaTrabajo = (typeof COLUMNAS_TRABAJO)[number]['id'];

const ETAPAS_TRABAJO: readonly string[] = COLUMNAS_TRABAJO.map((c) => c.id);

/** Lo mínimo que el tablero necesita saber de una tarjeta. */
export interface TarjetaTablero {
  clave: string;
  /** La etapa dicha por el server (ADR 0013). Sin ella no se inventa nada. */
  etapa_efectiva?: string | null;
}

/**
 * La etapa ACTUAL de una tarjeta para las compuertas: el movimiento optimista
 * en vuelo (si hay) le gana a la del server. Sin dato del server, `null` —
 * jamás el fallback `'interesado'` que hacía mentir al tablero viejo.
 */
export function etapaDeTarjeta(
  c: TarjetaTablero,
  overrides: Record<string, Etapa>,
): Etapa | null {
  return overrides[c.clave] ?? ((c.etapa_efectiva as Etapa | undefined) || null);
}

/**
 * Reparte lo cargado por columna en lo que se PINTA por columna:
 *
 *   · manda la etapa efectiva de la propia tarjeta (si el refetch del origen
 *     viene atrasado, la tarjeta no se duplica: cada clave se pinta una vez);
 *   · un movimiento optimista la muda ya — entra ARRIBA del destino (es lo que
 *     la vendedora acaba de tocar) y sale del origen;
 *   · una etapa fuera del tablero (interesado) no se pinta en ninguna columna.
 */
export function repartirColumnas<C extends TarjetaTablero>(
  cargadas: ReadonlyArray<readonly [EtapaTrabajo, readonly C[]]>,
  overrides: Record<string, Etapa>,
): Map<EtapaTrabajo, C[]> {
  const mapa = new Map<EtapaTrabajo, C[]>(COLUMNAS_TRABAJO.map((c) => [c.id, []]));
  const movidas = new Map<EtapaTrabajo, C[]>(COLUMNAS_TRABAJO.map((c) => [c.id, []]));
  const vistas = new Set<string>();

  for (const [columna, items] of cargadas) {
    for (const c of items) {
      if (vistas.has(c.clave)) continue;
      vistas.add(c.clave);
      const propia = ETAPAS_TRABAJO.includes(c.etapa_efectiva ?? '')
        ? (c.etapa_efectiva as EtapaTrabajo)
        : c.etapa_efectiva == null
          ? columna // server viejo sin la columna: se respeta la etapa pedida
          : null; // interesado u otra: fuera del tablero
      const destino = overrides[c.clave] ?? propia;
      if (destino == null || !ETAPAS_TRABAJO.includes(destino)) continue;
      (destino === propia ? mapa : movidas).get(destino as EtapaTrabajo)!.push(c);
    }
  }

  for (const [columna, items] of movidas) {
    if (items.length) mapa.get(columna)!.unshift(...items);
  }
  return mapa;
}

/** El «Ver más» honesto: cuántas faltan de ESTA columna. Nunca negativo, nunca inventado. */
export function quedanPorTraer(total: number | undefined, cargadas: number): number {
  if (total == null) return 0;
  return Math.max(total - cargadas, 0);
}

/**
 * Una celda del desglose que sirve el server: etapa × ya-le-hablamos × precio ×
 * viva, con su conteo. Es la MISMA foto que las tarjetas, contada de una pasada
 * (`server/src/cola/consultarCola.ts`).
 */
export interface FilaDesglose {
  etapa: string;
  yaLeHablamos: boolean;
  precio: boolean;
  viva: boolean;
  /**
   * La ventana de conversación sigue abierta (server: `cola/ventana.ts`): se le
   * puede escribir texto libre AHORA, sin pagar una plantilla. Opcional porque
   * un server viejo no manda el campo — y ahí el chip no se dibuja, que es como
   * se comportaba antes.
   */
  ventana?: boolean;
  /**
   * «Para seguir» (server: `cola/tiempoEnEtapa.ts`): silencio nuestro + entre 3 y
   * 14 días en la etapa. Opcional por lo mismo que `ventana` — un server viejo no
   * manda el campo, y ahí el chip no se dibuja en vez de prometer un recorte que
   * el server no sabe aplicar.
   */
  paraSeguir?: boolean;
  n: number;
}

/**
 * LA BANDEJA, DICHA COMO ES. Hasta acá era un número gris con un rótulo que
 * mentía: «Levantaron la mano y nadie les respondió aún» — falso para la mitad.
 * Medido en producción el 2026-07-25, la bandeja son **476 conversaciones donde
 * la pelota es nuestra**, y son dos trabajos distintos:
 *
 *   · `nuevas` — nadie les contestó nunca. Se abren.
 *   · `retomadas` — ya les hablamos y volvieron a escribir. Se siguen.
 *
 * `vivas` es el número que decide el día: cuántas están escribiendo AHORA
 * (nivel 0, menos de 24 h). La mediana de primera respuesta es de 39 minutos;
 * ese número tiene que estar a la vista, no enterrado en una pila.
 */
export function resumirBandeja(
  desglose: readonly FilaDesglose[] | undefined,
  /**
   * Los conteos por etapa de siempre (#89). El front sale a producción SIN
   * reinicio del server (N4) y el server recién en el botón (N5): entre uno y
   * otro no hay desglose. Ahí la bandeja cuenta con lo que hay y CALLA el
   * detalle, en vez de mostrar un cero que no es cierto.
   */
  conteos?: Record<string, number>,
): { total: number; nuevas: number; retomadas: number; vivas: number; hayDetalle: boolean } {
  const r = { total: 0, nuevas: 0, retomadas: 0, vivas: 0, hayDetalle: false };
  if (!desglose) return { ...r, total: conteos?.interesado ?? 0 };
  r.hayDetalle = true;
  for (const fila of desglose) {
    if (fila.etapa !== 'interesado') continue;
    r.total += fila.n;
    if (fila.yaLeHablamos) r.retomadas += fila.n;
    else r.nuevas += fila.n;
    if (fila.viva) r.vivas += fila.n;
  }
  return r;
}

/**
 * El tamaño real de una columna y el de su recorte útil: cuántas de esas
 * conversaciones ya tienen un precio encima. Con 611 precios enviados y la
 * columna Cotizados en cero, ese subconjunto ES el trabajo del día.
 */
export function resumirColumna(
  desglose: readonly FilaDesglose[] | undefined,
  etapa: string,
  /** El conteo de siempre, para el rato en que el front va adelante del server. */
  conteos?: Record<string, number>,
): ResumenColumna {
  if (!desglose) return { total: conteos?.[etapa] ?? 0, conPrecio: 0, enVentana: 0, paraSeguir: 0 };
  const r = { total: 0, conPrecio: 0, enVentana: 0, paraSeguir: 0 };
  for (const fila of desglose) {
    if (fila.etapa !== etapa) continue;
    r.total += fila.n;
    if (fila.precio) r.conPrecio += fila.n;
    // `ventana` ausente (server viejo) NO suma: el chip se esconde en cero, que
    // es preferible a ofrecer un recorte que el server no sabe aplicar.
    if (fila.ventana) r.enVentana += fila.n;
    if (fila.paraSeguir) r.paraSeguir += fila.n;
  }
  return r;
}

export interface ResumenColumna {
  total: number;
  conPrecio: number;
  enVentana: number;
  paraSeguir: number;
}

/**
 * ══ EL RECORTE ES POR COLUMNA, Y ESO ES EL CAMBIO ══════════════════════════
 *
 * Hasta acá el recorte era **uno solo y global a la vista**, y solo se dibujaba
 * arriba de Contactados. Eso alcanzaba mientras Contactados era la única columna
 * con tarjetas; desde que el embudo se DERIVA (8-ago-2026), la pila se mudó a
 * Cotizados —3.064 tarjetas— y la única columna con recorte quedó con 534.
 *
 * El plan lo dice mejor que cualquier comentario
 * (`docs/plan-pipeline-funcional.md` §3.1): *una columna con 3.064 tarjetas no
 * es una lista de trabajo, es la misma pila con otro rótulo*. Y el número grande
 * («cuántos hay») no responde ninguna pregunta que alguien se haga: la pregunta
 * es **cuántos de esos son trabajo de hoy**.
 *
 * ── POR QUÉ NO SE OFRECEN LOS MISMOS EJES EN LAS CUATRO ──────────────────
 * `cierre` y `perdido` no llevan recorte, y no es que dieran cero:
 *   · **Perdidos es ARCHIVO, no trabajo** (§3.1, la fila que dice «nada»).
 *     Un «Para seguir» ahí contradiría que `perdido` es terminal humano.
 *   · **Cierre** sí tiene un recorte que vale —«vendido y todavía sin registrar
 *     en Cerberus»— pero ese depende del lazo de ventas, que es otro frente
 *     (§3.3). Ofrecer el eje equivocado ahora costaría más que no ofrecer nada.
 *
 * ── LA REGLA DEL CERO, Y SU OTRA MITAD ───────────────────────────────────
 * Un recorte que daría CERO no se ofrece. Es la regla de los chips del bot en la
 * barra de la cola, y es la que hace que «Con precio» desaparezca solo de
 * Contactados: con la derivación, esas conversaciones ya viven en Cotizados.
 *
 * 🔴 **Y uno que daría EL TOTAL tampoco**, que es la mitad que faltaba y que la
 * primera captura de evidencia dejó a la vista: en Cotizados, «Con precio 3.051»
 * sobre una columna de 3.051 no recorta nada —toda esa columna tiene precio, es
 * lo que la derivó— y encima empujaba los chips a un segundo renglón. Los dos
 * casos son el mismo defecto dicho de dos formas: **un botón que no cambia lo
 * que se ve**. Y los dos tienen la misma excepción: el chip ACTIVO se ofrece
 * siempre, o la vendedora se queda sin el botón que lo apaga.
 */
export type Recorte = 'todas' | 'precio' | 'ventana' | 'seguir';

/** Las columnas donde recortar tiene sentido. Ver el porqué de las otras dos arriba. */
export const COLUMNAS_CON_RECORTE: readonly EtapaTrabajo[] = ['contactado', 'cotizado'];

export interface OpcionRecorte {
  id: Recorte;
  label: string;
  /** `null` en «Todas»: es el universo, no un subconjunto que se pueda contar aparte. */
  n: number | null;
  ayuda?: string;
}

/**
 * Los chips que se dibujan arriba de una columna, ya filtrados por la regla del
 * cero. Puro y con tests: qué se ofrece es una política, no un detalle de JSX —
 * y el caso que importa (el chip activo que se queda sin conteo y desaparecería,
 * dejando el recorte encendido sin forma de apagarlo) no se ve en una captura.
 */
export function recortesDeColumna(
  etapa: EtapaTrabajo,
  resumen: ResumenColumna,
  activo: Recorte,
): OpcionRecorte[] {
  if (!COLUMNAS_CON_RECORTE.includes(etapa)) return [];
  const todos: OpcionRecorte[] = [
    { id: 'todas', label: 'Todas', n: null },
    {
      id: 'ventana',
      label: 'En ventana',
      n: resumen.enVentana,
      /* Lo que hace valioso al recorte es el «sin pagar»: en la línea de la Cloud
         API, fuera de la ventana solo entra una plantilla aprobada, y esa se cobra. */
      ayuda:
        'Se les puede escribir AHORA sin pagar una plantilla: escribieron hace menos de 24 h (o comentaron hace menos de 7 días)',
    },
    {
      id: 'seguir',
      label: 'Para seguir',
      n: resumen.paraSeguir,
      ayuda:
        'Les hablaste y no contestaron, y hace entre 3 y 14 días que están en esta columna: es a quienes toca insistirles hoy',
    },
    {
      id: 'precio',
      label: 'Con precio',
      n: resumen.conPrecio,
      ayuda: 'Ya les mandaste el precio o la forma de pagar: están cotizadas de hecho',
    },
  ];
  return todos.filter((r) => {
    if (r.id === 'todas' || r.id === activo) return true;
    const n = r.n ?? 0;
    // Ni vacío ni completo: las dos puntas son un botón que no cambia nada.
    return n > 0 && n < resumen.total;
  });
}

/**
 * CUÁNTO MIDE LA COLUMNA Y CUÁNTO SU RECORTE — las dos cifras, nunca una sola.
 *
 * Con un recorte puesto, el número grande es el del RECORTE (es la lista que se
 * está mirando) y el total viaja al lado como «de 3.064». Mostrar solo el
 * recortado escondería el tamaño real del montón; mostrar solo el total haría
 * que el número no describa lo que hay abajo.
 *
 * `total` sale del recorte servido (`columna.total`) porque el desglose cuenta el
 * universo entero de la etapa: con el recorte puesto son dos cifras distintas y
 * hay que tomar cada una de donde es verdadera.
 */
/**
 * QUÉ SE LEE EN UNA COLUMNA VACÍA. Con un recorte puesto, el vacío de la etapa
 * («Cuando le respondas a alguien, aparece acá») es FALSO: hay conversaciones, lo
 * que no hay es ninguna que pase el recorte. Decir el vacío equivocado hace creer
 * que la columna está vacía de verdad, y el chip «Todas» —que es la salida— queda
 * a la vista sin que nadie entienda para qué.
 */
export function vacioDeColumna(recorte: Recorte, vacioDeEtapa: string): string {
  switch (recorte) {
    case 'precio':
      return 'Ninguna con el precio ya enviado. Tocá «Todas» para ver la columna entera.';
    case 'ventana':
      return 'A ninguna se le puede escribir gratis ahora mismo. Tocá «Todas» para ver la columna entera.';
    case 'seguir':
      return 'Nada que seguir hoy: ninguna lleva entre 3 y 14 días esperando respuesta. Tocá «Todas» para ver la columna entera.';
    default:
      return vacioDeEtapa;
  }
}

export function cifrasDeColumna(
  resumen: ResumenColumna,
  recorte: Recorte,
  /** El total que devolvió la consulta de ESTA columna, ya recortada. */
  totalServido: number | undefined,
  /** Cuántas tarjetas hay pintadas — el respaldo cuando el server no dio total. */
  cargadas: number,
): { principal: number; de: number | null } {
  const universo = resumen.total || totalServido || cargadas;
  if (recorte === 'todas') return { principal: universo, de: null };
  const recortado = totalServido ?? cargadas;
  // Si el recorte no achica nada, decir «de N» dos veces con el mismo número es
  // ruido: se muestra una sola cifra.
  return { principal: recortado, de: recortado === universo ? null : universo };
}
