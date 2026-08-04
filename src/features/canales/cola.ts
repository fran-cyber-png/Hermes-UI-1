/**
 * LA LÓGICA PURA DE LA COLA POTENCIADA (#49) — sin React, testeable con vitest.
 *
 * Los tabs (`Todo · No leídos · Favoritos`) son el EJE de la cola; los filtros
 * SECUNDARIOS angostan dentro del tab, y la categoría es el tercer eje (modo
 * Listas). Acá vive el mapeo tab/filtro → query-params, la migración del valor
 * viejo de localStorage y el resumen de qué está recortando la cola ahora mismo.
 *
 * ── QUÉ PASÓ CON «POR VENCER» (censo de producción, 25-jul-2026) ──
 * «Por vencer» filtraba `ventana_abierta`, que solo es cierto para comentarios
 * de FB/IG de menos de 7 días. En las 1.867 conversaciones de la ventana de 30
 * días había **0** (la cola es 100% WhatsApp). Un filtro que siempre devuelve
 * cero no es un filtro: es un callejón sin salida con nombre confuso —«por
 * vencer» nunca dijo QUÉ vence—. Se retira del panel. La ventana de Meta sigue
 * viéndose donde importa: el reloj dorado de la fila, que dice los días que
 * quedan. El server sigue aceptando `intencion=por-vencer` (el contrato no se
 * rompe), simplemente ya no hay chip que lo dispare.
 *
 * En su lugar entra **«Sin responder»** (`NOT respondida`): 478 de 1.867 en el
 * mismo censo — la deuda real de la mesa, y se entiende sin explicación.
 */

export type Tab = 'todo' | 'no-leidos' | 'favoritos';

/** Los filtros secundarios: angostan dentro del tab (#49). */
export type FiltroSec = '' | 'pide-info' | 'sin-responder' | 'ya-compraron' | 'bot-escalada' | 'bot-caliente';

export const TABS: { valor: Tab; label: string; vacio: string }[] = [
  { valor: 'todo', label: 'Todo', vacio: 'No entró nada por ningún canal.' },
  { valor: 'no-leidos', label: 'No leídos', vacio: 'Nada sin leer.' },
  { valor: 'favoritos', label: 'Favoritos', vacio: 'No marcaste favoritos.' },
];

export const FILTROS_SEC: { valor: Exclude<FiltroSec, ''>; label: string; ayuda: string }[] = [
  { valor: 'pide-info', label: 'Piden info', ayuda: 'Lo último que escribió fue un pedido de información' },
  { valor: 'sin-responder', label: 'Sin responder', ayuda: 'Nadie del equipo contestó todavía' },
  /**
   * «Ya compraron» (#133) va PRIMERO de los tres cuando la vendedora elige a
   * quién atender: son 140 de 1.997 y convierten mucho más barato que un frío.
   * Va último en la barra igual, porque los otros dos son el trabajo del día
   * (deuda y pedidos) y este es una oportunidad — pero con su número al lado, que
   * es lo que hace que se lo mire.
   */
  { valor: 'ya-compraron', label: 'Ya compraron', ayuda: 'Ya te compró alguna vez: el lead más barato de convertir' },
  /**
   * ══ LOS DOS DEL BOT — y por qué SOLO aparecen cuando tienen algo que decir ══
   *
   * El bot corre en UNA línea de cuatro. En las otras tres estos dos chips
   * dirían «0» para siempre, y la barra ya está llena: es la misma regla por la
   * que el selector de línea entero no se dibuja con una sola línea («un
   * selector de un solo elemento no es una elección, es ruido»). `BarraFiltros`
   * los esconde con conteo cero, así que **el chip apareciendo ES el aviso**:
   * cuando el bot escala algo, sale un chip que antes no estaba, con su número.
   *
   * Son dos y no uno porque se atienden distinto: una escalada dejó al bot
   * mudo y al lead esperando (hay que ENTRAR), una caliente sin escalar es una
   * oportunidad que el bot sigue trabajando (hay que MIRAR). Juntarlas
   * enterraría las tres urgentes del día entre las catorce calientes.
   */
  {
    valor: 'bot-escalada',
    label: 'Pidió ayuda',
    ayuda: 'El bot se frenó y espera a una persona: mientras nadie entre, el lead no recibe nada',
  },
  {
    valor: 'bot-caliente',
    label: 'El bot los ve calientes',
    ayuda: 'El bot los calificó calientes: preguntaron precio, cuotas o forma de pago',
  },
];

const TABS_VALIDOS: readonly string[] = TABS.map((t) => t.valor);

export function esTab(x: unknown): x is Tab {
  return typeof x === 'string' && TABS_VALIDOS.includes(x);
}

/**
 * Sanea el valor persistido del tab a uno VÁLIDO. El default de la cola dejó de
 * ser `puedo-escribirle` y pasó a `Todo` (#49): cualquier valor viejo o basura
 * cae en `todo`, así el caché persistido no abre mostrando la página de un
 * filtro que ya no existe como tab.
 */
export function migrarFiltroViejo(raw: string | null | undefined): Tab {
  return esTab(raw) ? raw : 'todo';
}

/** La key vieja de la cola (el filtro por intención, pre-#49). */
export const KEY_FILTRO_VIEJO = 'hermes.colaFiltro';
/** La key nueva: el tab es otro eje, no el mismo valor con otro nombre. */
export const KEY_TAB = 'hermes.colaTab';
/**
 * La línea elegida (#50). PERSISTE, y no por comodidad: quien vende por su
 * propio número abre la app para trabajar SU cola, y hacérsela elegir cada
 * mañana es pedirle que se acuerde de un filtro para no leer los chats de otra
 * persona. Es la misma razón por la que el tab se guarda.
 */
export const KEY_LINEA = 'hermes.colaLinea';
/**
 * «Míos» (reparto) también PERSISTE, y por la misma razón que la línea: quien
 * atiende sus leads asignados abre la app para trabajar SU cola, y hacérselo
 * elegir cada mañana es pedirle que se acuerde de un filtro para no leer los
 * chats de sus seis compañeros.
 */
export const KEY_MIOS = 'hermes.colaMios';

/**
 * «LAS MÍAS» — el valor reservado del MISMO eje de línea, no un estado aparte.
 *
 * `numero_vendedora` (poblada desde #50 y sin lectores hasta hoy) dice qué
 * líneas atiende cada vendedora. Elegir «las mías» y elegir «Walter» son la
 * misma pregunta —¿qué cola miro?—, así que comparten el estado: dos banderas
 * independientes habilitarían el estado imposible «las mías Y solo Walter» y
 * alguien tendría que inventar quién gana.
 *
 * No es un número, así que **no viaja como `?linea=`** (la ruta lo rechazaría
 * con 400, y con razón): `parametrosDeCola` lo traduce a `?mias=1` y el server
 * resuelve el mapa. Que lo resuelva el server no es un detalle: si el front
 * mandara la lista de números, habría dos lugares decidiendo cuáles son «las
 * mías» (la lección de #37).
 *
 * No puede colisionar con una línea real: las líneas son solo dígitos.
 */
export const LINEA_MIAS = 'mias';

/**
 * Qué debería ver, la primera vez, alguien que YA venía usando la cola vieja.
 *
 * La key cambió, así que sin esto la migración no migra nada: quien tenía
 * «Piden info» elegido abre en Todo y su filtro desaparece sin explicación. Se
 * traduce UNA vez, al arrancar, y el valor viejo se borra para no volver a
 * pisar lo que la vendedora elija después.
 *
 *   · `pide-info`        → tab Todo + el filtro secundario «Piden info» (existe).
 *   · `puedo-escribirle` → tab Todo, SIN filtro. Su reencarnación de #49 era
 *     «Por vencer», que hoy devuelve cero filas en producción: aterrizar en una
 *     cola vacía es peor que aterrizar en la cola entera.
 *   · cualquier otra cosa → Todo, sin filtro.
 *
 * Devuelve `null` si no hay nada que migrar (usuaria nueva, o ya migrada).
 */
export function migracionDesdeKeyVieja(
  leer: (k: string) => string | null,
  borrar: (k: string) => void,
): { tab: Tab; filtroSec: FiltroSec } | null {
  const crudo = leer(KEY_FILTRO_VIEJO);
  if (crudo == null) return null;
  borrar(KEY_FILTRO_VIEJO);

  // Se guardó con JSON.stringify (useLocalStorage), así que viene entrecomillado.
  let valor = crudo;
  try {
    const parseado: unknown = JSON.parse(crudo);
    if (typeof parseado === 'string') valor = parseado;
  } catch {
    // Valor sin JSON válido: se usa tal cual y, si no matchea, cae en el default.
  }

  if (valor === 'pide-info') return { tab: 'todo', filtroSec: 'pide-info' };
  return { tab: 'todo', filtroSec: '' };
}

/** Un recorte activo sobre la cola, con el rótulo que la vendedora ve. */
export interface FiltroActivo {
  clave: 'tab' | 'filtro' | 'categoria' | 'busqueda';
  label: string;
}

/**
 * QUÉ ESTÁ RECORTANDO LA COLA AHORA MISMO — la lista de recortes activos, en el
 * orden en que se aplican.
 *
 * Existe porque una cola de 1.867 filas que muestra 12 sin decir por qué es una
 * trampa: la vendedora cree que no hay trabajo. Con esto la cabecera puede
 * nombrar cada recorte y ofrecer salir de todos con un gesto. El tab `todo` y
 * una búsqueda en blanco NO son recortes: no esconden nada.
 */
export function filtrosActivos(e: {
  tab: Tab | string;
  filtroSec: FiltroSec | string;
  categoria: string | null;
  busqueda: string;
}): FiltroActivo[] {
  const activos: FiltroActivo[] = [];
  const tab = TABS.find((t) => t.valor === e.tab);
  if (tab && tab.valor !== 'todo') activos.push({ clave: 'tab', label: tab.label });
  const filtro = FILTROS_SEC.find((f) => f.valor === e.filtroSec);
  if (filtro) activos.push({ clave: 'filtro', label: filtro.label });
  if (e.categoria) activos.push({ clave: 'categoria', label: e.categoria });
  const q = e.busqueda.trim();
  if (q) activos.push({ clave: 'busqueda', label: `«${q}»` });
  return activos;
}

/** Lo mínimo que la barra necesita de una categoría del catálogo (#48). */
export interface CategoriaEnBarra {
  nombre: string;
  color: string;
  orden: number;
  esFavorito: boolean;
  conteo: number;
}

/** Cuántos chips de categoría entran antes de que la barra deje de ser una barra. */
export const TOPE_CATEGORIAS_BARRA = 12;

/**
 * QUÉ CATEGORÍAS VAN EN LA BARRA, Y EN QUÉ ORDEN.
 *
 * Las FAVORITAS primero: para eso existe `es_favorito` en #48 —marcar cuáles
 * merecen estar a un clic—. Dentro de cada grupo manda el orden manual de la
 * vendedora. Se corta en un tope: una barra de 30 chips deja de ser navegable y
 * para eso está el modo Listas, que las muestra todas.
 *
 * La categoría ACTIVA entra siempre, aunque el tope la dejara afuera: si se está
 * filtrando por ella, tiene que verse y tiene que poder apagarse desde la barra.
 */
export function categoriasDeLaBarra(
  catalogo: readonly CategoriaEnBarra[] | undefined,
  activa?: string | null,
): CategoriaEnBarra[] {
  if (!catalogo || catalogo.length === 0) return [];
  const ordenadas = [...catalogo].sort((a, b) => {
    if (a.esFavorito !== b.esFavorito) return a.esFavorito ? -1 : 1;
    return a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');
  });
  const visibles = ordenadas.slice(0, TOPE_CATEGORIAS_BARRA);
  if (activa && !visibles.some((c) => c.nombre === activa)) {
    const suelta = ordenadas.find((c) => c.nombre === activa);
    if (suelta) return [suelta, ...visibles.slice(0, TOPE_CATEGORIAS_BARRA - 1)];
  }
  return visibles;
}

export interface EstadoCola {
  tab: Tab;
  filtroSec: FiltroSec;
  /** El nombre (minúsculas) de la categoría en el modo Listas; null = sin filtro. */
  categoria: string | null;
  canal?: string;
  /** Filtra por etapa efectiva en el server: la carga POR COLUMNA del Pipeline
   *  (#89/#90). Solo entra a la queryKey/URL cuando se pide, así las queries de
   *  siempre (Mensajes) conservan su clave y su caché persistido. */
  etapa?: string;
  /** Solo las que ya tienen un precio encima — el recorte del Pipeline. */
  precio?: boolean;
  /**
   * Recorta a UNA línea de WhatsApp: el número propio de Goberna por el que
   * entró la conversación (#50). Vacío/ausente = todas, que es lo que había
   * cuando había una sola línea. `LINEA_MIAS` = las que `numero_vendedora` le
   * asigna a quien está logueada (lo resuelve el server).
   */
  linea?: string;
  /**
   * «MÍOS» — solo las conversaciones que el REPARTO me asignó (4-ago-2026).
   *
   * ⚠️ **Es otro eje que `linea === LINEA_MIAS`.** Aquél recorta por LÍNEA («las
   * mías» = los números que atiendo); éste, por CONVERSACIÓN («míos» = los leads
   * que me tocaron). Se combinan sin problema y son preguntas distintas: con siete
   * personas en UNA línea, la línea ya no separa a nadie.
   *
   * Viaja como `?mios=1`. El `vendedoraId` lo resuelve el server desde el token —
   * si el front mandara el id, habría dos lugares decidiendo de quién es cada cosa
   * (la lección de #37) y cualquiera podría pedir la cola de otra persona.
   */
  mios?: boolean;
}

/**
 * Traduce el estado de la cola a los query-params de `/api/conversaciones`. Solo
 * emite lo que se aparta del default (tab `todo` no viaja): así la queryKey de
 * react-query es estable y el default no ensucia la URL.
 */
export function parametrosDeCola(e: EstadoCola): Record<string, string> {
  const p: Record<string, string> = {};
  if (e.tab !== 'todo') p.tab = e.tab;
  if (e.filtroSec) p.intencion = e.filtroSec;
  if (e.categoria) p.categoria = e.categoria;
  if (e.canal) p.canal = e.canal;
  if (e.etapa) p.etapa = e.etapa;
  if (e.precio) p.precio = '1';
  // ⚠️ `mias` (LÍNEAS) y `mios` (CONVERSACIONES asignadas) son DOS recortes, se
  // escriben con una vocal de diferencia y salen los dos de acá. Confundirlos no
  // rompe nada visible: devuelve otra cola. Van juntos y comentados a propósito.
  //
  // «Las mías» es el mismo eje de la línea con otro nombre, y sale por otro
  // parámetro: no es un teléfono, así que mandarlo como `?linea=` sería un 400.
  if (e.linea === LINEA_MIAS) p.mias = '1';
  else if (e.linea) p.linea = e.linea;
  if (e.mios) p.mios = '1';
  return p;
}
