import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Smartphone, Tags, X } from 'lucide-react';
import type { LineaWhatsapp } from '../../dominio/lineas';
import {
  CLASE_BORDE,
  CLASE_FONDO,
  CLASE_FONDO_SUAVE,
  CLASE_TEXTO,
  esColorCategoria,
} from '../../dominio/paletaCategorias';
import { categoriasDeLaBarra, FILTROS_SEC, type CategoriaEnBarra, type FiltroSec } from '../../dominio/cola';
import { opcionesDeLinea, seDibujaElSelector } from './alcance';
import { usePopover } from '../../lib/teclado/usePopover';

/**
 * LA BARRA DE FILTROS DE LA COLA — una sola fila que se corre de izquierda a
 * derecha con los filtros que sirven Y las listas de la vendedora.
 *
 * Antes eran dos chips sueltos («Piden info» y «Por vencer») debajo de los tabs,
 * y las categorías vivían escondidas detrás del botón de Listas. El dueño pidió
 * juntarlo: «podemos mejorar el "piden info" y "por vencer" que no me termina de
 * convencer, y además agregar etiquetas ahí en scroll de izquierda a derecha».
 *
 * Tres reglas de esta barra:
 *
 *  1. **Cada chip trae su número.** Un filtro sin la cifra obliga a probarlo para
 *     saber si vale la pena; con 1.866 conversaciones eso es un salto al vacío.
 *  2. **El chip encendido se apaga solo.** El activo lleva su propia ✕: salir del
 *     filtro es un gesto, en el mismo lugar donde se entró.
 *  3. **El scroll se nota.** Sin barra de scroll a la vista (fea en un panel de
 *     360 px), pero navegable con la rueda del mouse, con Tab y con las flechas
 *     ← →. Hasta el 20-ago-2026 lo avisaba un degradado en el borde (ver abajo,
 *     «SIN VELO»): se retiró porque el círculo con la flecha —ver «VER TODOS»
 *     más abajo— ya es el aviso, y uno explícito no necesita uno ambiguo al lado.
 *  4. **Un chip que siempre diría cero no se dibuja.** Los dos del bot solo
 *     aparecen cuando tienen algo que decir: el bot corre en una línea de
 *     cuatro, y en las otras tres serían dos chips muertos ocupando el ancho de
 *     los que sí se usan todos los días. Es la misma regla del selector de línea
 *     («un selector de un solo elemento no es una elección, es ruido»), y tiene
 *     un efecto que buscamos: **el chip apareciendo ES el aviso**.
 *
 * ══ LA LÍNEA YA NO VIVE ACÁ (era «DOS FILAS, NO UNA» del 6-ago-2026) ══
 * Hasta el 20-ago esta barra dibujaba DOS filas: la línea arriba (qué cola),
 * los chips abajo (qué recorte dentro de ella) — compartir una sola pista con
 * cuatro líneas vivas se comía los 336 px enteros y, en la captura del dueño,
 * **«Sin responder» no se veía en absoluto** detrás de un scroll invisible.
 * Eso era inaceptable porque ese chip —hoy «Preguntaron precio»/«Te
 * escribieron»— es la red de seguridad de la deuda vieja desde que la cola
 * ordena por la banda de leído (`server/src/cola/estadoSql.ts`).
 *
 * El pedido del 20-ago fue volver a una sola fila junto con los tabs
 * (`Todo`/`No leídos`/`Favoritos`, en `ColaUnificada.tsx`). La línea sola no
 * podía volver como segmentado —repetiría exactamente el problema de arriba,
 * ahora compitiendo con los tabs en vez de con estos chips— así que pasó a
 * **`SelectorLinea`**, un dropdown de ancho fijo (ver su docblock, más abajo
 * en este archivo): mide lo mismo con una línea que con diez. Esta barra
 * quedó con una sola fila, la de siempre — los tres chips del trabajo diario
 * —«Preguntaron precio», «Te escribieron», «Puedo escribirle»— entran sin
 * scrollear. Desde el 11-ago-2026 son tres y no cinco: dos chips se retiraron
 * por mentir o por no caber en un turno (ver el docblock de `FILTROS_SEC`).
 */
/**
 * El aire que deja el traer-a-la-vista entre el chip activo y el borde de la
 * pista, en px. Hasta el 20-ago-2026 este número ERA el ancho del degradado de
 * borde (`w-8`): los dos velos se pintaban ENCIMA de la pista, así que dejar
 * menos aire dejaba el chip activo medio desteñido. Sin velo (ver «SIN VELO»,
 * más abajo) ya no hay nada que tapar — el número queda como un margen de
 * respiro, para que el chip no quede pegado al filo exacto del recorte.
 */
const AIRE_AL_TRAER_A_LA_VISTA = 12;

/**
 * UNA FILA QUE SE CORRE — el andamio compartido por los dos ejes de la barra: el
 * scroll horizontal, el degradado que avisa que hay más, la rueda del mouse y las
 * flechas ← →. Está acá afuera porque las dos filas necesitan **su propia**
 * navegación por teclado: con un solo `ref` compartido, las flechas saltarían
 * de la línea a los filtros a mitad de recorrido.
 */
function Pista({
  etiqueta,
  activo,
  children,
}: {
  etiqueta: string;
  /**
   * Lo que está encendido en esta pista. NO se dibuja: es la DEPENDENCIA que
   * dispara el traer-a-la-vista de abajo. Va como valor y no como booleano para
   * que cambiar de una opción activa a otra también cuente.
   */
  activo?: string;
  children: ReactNode;
}) {
  const pista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = pista.current;
    if (!el) return;

    /**
     * La rueda del mouse: en un trackpad el gesto horizontal ya llega como
     * `deltaX`, pero con una rueda común solo hay `deltaY` — y sin esto la
     * página entera se movía mientras la barra se quedaba quieta. Va con
     * `passive: false` a mano porque React registra `onWheel` como pasivo y ahí
     * `preventDefault()` no hace nada.
     */
    function rueda(e: WheelEvent) {
      const barra = pista.current;
      if (!barra || barra.scrollWidth <= barra.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // gesto ya horizontal: que lo maneje el navegador
      e.preventDefault();
      barra.scrollLeft += e.deltaY;
    }
    el.addEventListener('wheel', rueda, { passive: false });
    return () => el.removeEventListener('wheel', rueda);
    // Se cablea una vez sobre el nodo de la pista: no depende de nada del render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * LO ENCENDIDO SE TRAE A LA VISTA. A 360 px con cuatro líneas vivas, la línea
   * ACTIVA quedaba scrolleada fuera de la pista: se veía «Todas · Ventas Perú ·
   * Walter…» y ni rastro de en cuál estabas parada. Un control cuyo estado activo
   * no se ve no informa, desinforma — se lee como si estuviera en la primera
   * opción.
   *
   * 🔴 **A MANO SOBRE `scrollLeft`, NUNCA con `scrollIntoView`.** Se probó con
   * `scrollIntoView({ block: 'nearest' })` y **scrollea los ancestros igual**: al
   * cargar, los chips activos de las barras de más abajo arrastraban la PÁGINA
   * ENTERA hacia ellos y la cola aparecía empezada por la mitad (se ve en la
   * captura que lo detectó). `nearest` acota cuánto, no a quién. Tocando solo el
   * `scrollLeft` de esta pista, no hay ancestro que se entere.
   */
  useEffect(() => {
    const cont = pista.current;
    const el = cont?.querySelector<HTMLElement>('[data-chip][aria-pressed="true"]');
    if (!cont || !el) return;
    const caja = cont.getBoundingClientRect();
    const chip = el.getBoundingClientRect();
    // jsdom no hace layout: todos los rects son 0 y no se mueve nada. Correcto.
    if (chip.left < caja.left) cont.scrollLeft -= caja.left - chip.left + AIRE_AL_TRAER_A_LA_VISTA;
    else if (chip.right > caja.right) cont.scrollLeft += chip.right - caja.right + AIRE_AL_TRAER_A_LA_VISTA;
  }, [activo]);

  /** Flechas ← → entre chips (patrón `toolbar` de ARIA); Inicio/Fin a los extremos. */
  function onTeclas(e: KeyboardEvent<HTMLDivElement>) {
    const teclas = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!teclas.includes(e.key)) return;
    const chips = Array.from(pista.current?.querySelectorAll<HTMLButtonElement>('[data-chip]') ?? []);
    if (chips.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const actual = chips.findIndex((c) => c === document.activeElement);
    const destino =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? chips.length - 1
          : Math.min(Math.max((actual < 0 ? 0 : actual) + (e.key === 'ArrowRight' ? 1 : -1), 0), chips.length - 1);
    chips[destino]?.focus();
    chips[destino]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  return (
    /* `-ml-4` + `pl-4`: la pista sangra SOLO a la IZQUIERDA, hasta el borde del
       panel — si se quedara dentro del padding, el primer chip se cortaría en
       seco contra el borde. A la DERECHA no sangra: el botón «ver todas» vive
       afuera de esta pista, como hermano en el mismo `flex`, y sangrar ahí le
       comía la mitad al botón (el padding sí sigue subiendo junto con el del
       header en `ColaUnificada.tsx` — solo el lado izquierdo).
       🔴 **SIN VELO** (20-ago-2026, pedido explícito): hasta acá un degradado
       en cada borde avisaba «hay más» detrás del scroll — se retiró porque el
       círculo con la flecha (`BarraFiltros`, «VER TODOS») ya es ese aviso, uno
       explícito. Con los dos, el degradado tapaba media punta del chip activo
       (era «un chip apagado» leído como deshabilitado) y encima duplicaba la
       señal. Con eso se fue también el estado de `sombra` y su medición por
       scroll/resize: nada en esta pista necesitaba saber si hay más, solo
       AVISARLO — y eso ahora lo hace el botón de afuera. */
    <div className="relative -ml-4">
      <div
        ref={pista}
        role="toolbar"
        aria-label={etiqueta}
        onKeyDown={onTeclas}
        className="sin-riel flex items-center gap-1.5 overflow-x-auto scroll-smooth pl-4 pr-1 py-0.5"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * LA LÍNEA, COMO DROPDOWN Y NO COMO SEGMENTADO (20-ago-2026, pedido explícito).
 *
 * Vivía como fila propia arriba de `BarraFiltros` (ver el docblock del
 * archivo, «DOS FILAS, NO UNA» del 6-ago): un segmentado de 4 líneas se comía
 * los 336 px enteros y «Sin responder» —hoy «Preguntaron precio»— quedaba
 * invisible detrás de scroll. Volver a una sola fila con los tabs pedía que la
 * línea dejara de crecer con el número de líneas vivas: un botón-disparador
 * mide lo mismo con una línea que con diez, a diferencia del segmentado.
 *
 * Molde: `SelectorEtapa` (`gestion/BarraGestion.tsx`) — mismo `usePopover`,
 * mismo `role="menu"`, mismo check en la opción activa.
 */
export function SelectorLinea({
  lineas = [],
  lineaActiva = '',
  onLinea,
  hayMias = false,
}: {
  lineas?: readonly LineaWhatsapp[];
  lineaActiva?: string;
  onLinea?: (numero: string) => void;
  hayMias?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const { propsOverlay } = usePopover(abierto, () => setAbierto(false));
  const opciones = opcionesDeLinea(lineas, hayMias);
  if (!seDibujaElSelector(opciones) || !onLinea) return null;
  const activa = opciones.find((l) => l.numero === lineaActiva) ?? opciones[0];

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-expanded={abierto}
        aria-label="Elegir la cola"
        title="Elegir la cola"
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-sm font-normal text-muted-foreground transition-colors hover:text-foreground"
      >
        <Smartphone size={12} className="shrink-0" aria-hidden="true" />
        <span className="max-w-[6rem] truncate">{activa.etiqueta}</span>
        <ChevronDown size={13} className="shrink-0 opacity-70" aria-hidden="true" />
      </button>

      {abierto && (
        <>
          <span {...propsOverlay} />
          <div role="menu" className="absolute left-0 top-8 z-30 w-48 rounded-xl bg-card p-1 shadow-panel">
            {opciones.map((l) => {
              const seleccionada = lineaActiva === l.numero;
              return (
                <button
                  key={l.numero || 'todas'}
                  type="button"
                  role="menuitem"
                  title={l.titulo}
                  onClick={() => {
                    onLinea(l.numero);
                    setAbierto(false);
                  }}
                  className={
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] font-semibold hover:bg-muted ' +
                    (seleccionada ? 'text-foreground' : 'text-muted-foreground')
                  }
                >
                  <span className="flex-1 truncate">{l.etiqueta}</span>
                  {seleccionada && <Check size={11} className="shrink-0 text-success" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}

export function BarraFiltros({
  filtroSec,
  onFiltro,
  conteos,
  catalogo,
  categoriaActiva,
  onCategoria,
  onListas,
}: {
  filtroSec: FiltroSec;
  onFiltro: (f: FiltroSec) => void;
  /** Cuántas filas daría cada filtro dentro del recorte actual (el server los cuenta). */
  conteos?: {
    preguntoPrecio: number;
    teEscribieron: number;
    /** Sin chip desde el 11-ago-2026 (eran 505, el 93 % de más de una semana). */
    sinResponder?: number;
    yaCompraron?: number;
    botEscalada?: number;
    botCaliente?: number;
    /** Cuántas tienen la ventana abierta (server: `cola/ventana.ts`). */
    puedoEscribirle?: number;
  };
  catalogo?: readonly CategoriaEnBarra[];
  categoriaActiva: string | null;
  onCategoria: (c: { nombre: string; color: string } | null) => void;
  /** Abre el modo Listas, donde están TODAS las categorías y su edición. */
  onListas: () => void;
}) {
  const categorias = categoriasDeLaBarra(catalogo, categoriaActiva);
  const conteoDe = (valor: string) =>
    valor === 'pregunto-precio'
      ? conteos?.preguntoPrecio
      : valor === 'te-escribieron'
        ? conteos?.teEscribieron
        : valor === 'puedo-escribirle'
          ? conteos?.puedoEscribirle
          : valor === 'bot-escalada'
            ? conteos?.botEscalada
            : valor === 'bot-caliente'
              ? conteos?.botCaliente
              : undefined;

  /**
   * Los dos del bot se esconden en cero (regla 4 del docblock). El ACTIVO se
   * dibuja siempre, aunque el recorte lo haya dejado en cero: si desapareciera
   * al filtrar, la vendedora se quedaría mirando una cola vacía sin el chip que
   * la apaga — el mismo motivo por el que la categoría activa entra a la barra
   * aunque el tope la dejara afuera.
   */
  const visibles = FILTROS_SEC.filter((f) => {
    if (f.valor !== 'bot-escalada' && f.valor !== 'bot-caliente') return true;
    return filtroSec === f.valor || (conteoDe(f.valor) ?? 0) > 0;
  });

  /**
   * VER TODOS (20-ago-2026, pedido explícito): la pista de abajo se corre
   * horizontal y hay más etiquetas de las que entran a la vista sin tocarla
   * — el degradado del borde avisa que hay más, pero nadie lo descubre solo
   * mirando. El círculo con la flecha las baja TODAS envueltas (`flex-wrap`,
   * tantas filas como haga falta) en vez de obligar a scrollear una por una;
   * tocarlo de nuevo vuelve a la pista de siempre. No reemplaza «Listas»
   * (el botón punteado del final, que abre TODO el catálogo para editar) —
   * esto es solo para MIRAR lo que ya está armado, sin abrir nada aparte.
   */
  const [expandido, setExpandido] = useState(false);

  const chips = (
    <>
      {visibles.map((f) => {
        const activo = filtroSec === f.valor;
        const n = conteoDe(f.valor);
        return (
          <button
            key={f.valor}
            data-chip
            type="button"
            aria-pressed={activo}
            title={activo ? `Quitar el filtro «${f.label}»` : f.ayuda}
            onClick={() => onFiltro(activo ? '' : f.valor)}
            className={
              'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ' +
              'transition-[background-color,border-color,color] duration-200 ease-house active:scale-[0.97] ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
              (activo
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground')
            }
          >
            {f.label}
            {typeof n === 'number' && (
              <span className={'font-mono tabular-nums ' + (activo ? 'text-primary-foreground/70' : 'text-muted-foreground/70')}>
                {n.toLocaleString('es')}
              </span>
            )}
            {activo && <X size={11} className="shrink-0" aria-hidden="true" />}
          </button>
        );
      })}

      {categorias.length > 0 && <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />}

      {categorias.map((c) => {
        const color = esColorCategoria(c.color) ? c.color : 'pizarra';
        const activa = categoriaActiva === c.nombre;
        return (
          <button
            key={c.nombre}
            data-chip
            type="button"
            aria-pressed={activa}
            title={activa ? `Salir de la lista «${c.nombre}»` : `Ver solo «${c.nombre}»`}
            onClick={() => onCategoria(activa ? null : { nombre: c.nombre, color: c.color })}
            className={
              'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ' +
              'transition-[background-color,border-color,color] duration-200 ease-house active:scale-[0.97] ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
              CLASE_BORDE[color] +
              ' ' +
              (activa ? CLASE_FONDO_SUAVE[color] + ' ' + CLASE_TEXTO[color] : 'text-muted-foreground hover:text-foreground')
            }
          >
            <span className={'size-2 shrink-0 rounded-full ' + CLASE_FONDO[color]} aria-hidden="true" />
            {c.nombre}
            {c.conteo > 0 && (
              <span className="font-mono tabular-nums text-muted-foreground/70">{c.conteo.toLocaleString('es')}</span>
            )}
            {activa && <X size={11} className="shrink-0" aria-hidden="true" />}
          </button>
        );
      })}

      {/* La salida honesta al final de la barra: acá están TODAS las listas y su edición. */}
      <button
        data-chip
        type="button"
        onClick={onListas}
        title="Ver y administrar todas las listas"
        className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors duration-200 ease-house hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Tags size={11} />
        {catalogo && catalogo.length > 0 ? 'Listas' : 'Crear listas'}
      </button>
    </>
  );

  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        {expandido ? (
          <div className="flex flex-wrap items-center gap-1.5 py-0.5">{chips}</div>
        ) : (
          <Pista etiqueta="Afinar la cola" activo={filtroSec + '|' + (categoriaActiva ?? '')}>
            {chips}
          </Pista>
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        aria-expanded={expandido}
        title={expandido ? 'Mostrar menos etiquetas' : 'Ver todas las etiquetas'}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          size={13}
          className={'shrink-0 transition-transform duration-200 ease-house ' + (expandido ? 'rotate-180' : '')}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
