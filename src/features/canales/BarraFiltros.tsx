import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Smartphone, Tags, X } from 'lucide-react';
import type { LineaWhatsapp } from './lineas';
import {
  CLASE_BORDE,
  CLASE_FONDO,
  CLASE_FONDO_SUAVE,
  CLASE_TEXTO,
  esColorCategoria,
} from '../gestion/paletaCategorias';
import { categoriasDeLaBarra, FILTROS_SEC, type CategoriaEnBarra, type FiltroSec } from './cola';
import { opcionesDeLinea, seDibujaElSelector } from './alcance';

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
 *  3. **El scroll se nota.** Si hay más chips a la derecha, un degradado lo dice.
 *     Sin barra de scroll a la vista (fea en un panel de 360 px), pero navegable
 *     con la rueda del mouse, con Tab y con las flechas ← →.
 *  4. **Un chip que siempre diría cero no se dibuja.** Los dos del bot solo
 *     aparecen cuando tienen algo que decir: el bot corre en una línea de
 *     cuatro, y en las otras tres serían dos chips muertos ocupando el ancho de
 *     los que sí se usan todos los días. Es la misma regla del selector de línea
 *     («un selector de un solo elemento no es una elección, es ruido»), y tiene
 *     un efecto que buscamos: **el chip apareciendo ES el aviso**.
 *
 * ══ DOS FILAS, NO UNA (6-ago-2026) ══
 * La línea y los filtros comparten forma —píldoras que se corren— pero no plano:
 * la línea elige **qué cola**, los chips recortan **dentro** de ella. Compartían
 * una sola pista y con cuatro líneas vivas el segmentado se comía los 336 px
 * enteros: en la captura del dueño, «Piden info» quedaba cortado contra el borde
 * y **«Sin responder» no se veía en absoluto** — había que descubrir a mano que
 * la barra scrolleaba.
 *
 * Eso pasó a ser inaceptable el día que la cola ordenó por la banda de leído
 * (`server/src/cola/estadoSql.ts`): desde ahí lo que ya se miró baja, y **«Sin
 * responder» es la red de seguridad** que devuelve la deuda entera. Una red de
 * seguridad detrás de un scroll horizontal invisible no es una red.
 *
 * Cuesta ~26 px de alto y los paga con que los tres chips del trabajo diario
 * —«Piden info», «Sin responder», «Ya compraron»— entran sin scrollear.
 */
/** ¿Hay más chips a la izquierda / a la derecha de lo que se ve? (los 4 px son ruido de subpíxel). */
function sombrasDe(el: HTMLElement): { izq: boolean; der: boolean } {
  return { izq: el.scrollLeft > 4, der: el.scrollWidth - el.clientWidth - el.scrollLeft > 4 };
}

/**
 * El ancho de los dos degradados de borde, en px — es el `w-8` de sus clases,
 * dicho como número porque el traer-a-la-vista tiene que HACER LA CUENTA con él.
 * Si alguien cambia el `w-8`, esta constante va en el mismo commit: si no, el
 * chip activo vuelve a quedar medio tapado y no hay test que lo vea (jsdom no
 * hace layout).
 */
const ANCHO_VELO = 32;

/**
 * UNA FILA QUE SE CORRE — el andamio compartido por los dos ejes de la barra: el
 * scroll horizontal, el degradado que avisa que hay más, la rueda del mouse y las
 * flechas ← →. Está acá afuera porque las dos filas necesitan **su propio** estado
 * de sombra y su propia navegación por teclado: con un solo `ref` compartido, el
 * degradado de una fila mentiría sobre la otra y las flechas saltarían de la
 * línea a los filtros a mitad de recorrido.
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
  const [sombra, setSombra] = useState({ izq: false, der: false });

  /** Solo re-renderiza si la respuesta CAMBIÓ: el scroll dispara decenas de eventos. */
  function medir() {
    const el = pista.current;
    if (!el) return;
    const nueva = sombrasDe(el);
    setSombra((prev) => (prev.izq === nueva.izq && prev.der === nueva.der ? prev : nueva));
  }

  useEffect(() => {
    const el = pista.current;
    if (!el) return;
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);

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
    return () => {
      observador.disconnect();
      el.removeEventListener('wheel', rueda);
    };
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
   *
   * El aire es **el ancho del degradado** (`w-8`), no un número lindo: los dos
   * velos se pintan ENCIMA de la pista, así que dejar menos deja el chip activo
   * medio desteñido — que es peor que no traerlo, porque parece deshabilitado.
   * Cuando el activo es el último, sumar 32 se pasa del scroll máximo, el
   * navegador lo recorta al final y ahí el degradado se apaga solo: el chip queda
   * entero y sin velo. La cuenta ya lleva su propio caso borde resuelto.
   */
  useEffect(() => {
    const cont = pista.current;
    const el = cont?.querySelector<HTMLElement>('[data-chip][aria-pressed="true"]');
    if (!cont || !el) return;
    const caja = cont.getBoundingClientRect();
    const chip = el.getBoundingClientRect();
    // jsdom no hace layout: todos los rects son 0 y no se mueve nada. Correcto.
    if (chip.left < caja.left) cont.scrollLeft -= caja.left - chip.left + ANCHO_VELO;
    else if (chip.right > caja.right) cont.scrollLeft += chip.right - caja.right + ANCHO_VELO;
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
    /* `-mx-3` + `px-3` en la pista: la barra SANGRA hasta el borde del panel. Si
       se quedara dentro del padding, el último chip se cortaría en seco contra
       el borde y el degradado quedaría 12 px adentro, sin tapar el corte —que es
       justo lo que tiene que disimular—. */
    <div className="relative -mx-3">
      <div
        ref={pista}
        role="toolbar"
        aria-label={etiqueta}
        onScroll={medir}
        onKeyDown={onTeclas}
        className="sin-riel flex items-center gap-1.5 overflow-x-auto scroll-smooth px-3 py-0.5"
      >
        {children}
      </div>

      {/* Que se note que hay más: degradado en el borde, nunca una barra de scroll. */}
      <div
        aria-hidden="true"
        className={
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card via-card/80 to-transparent transition-opacity duration-200 ' +
          (sombra.izq ? 'opacity-100' : 'opacity-0')
        }
      />
      <div
        aria-hidden="true"
        className={
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card via-card/80 to-transparent transition-opacity duration-200 ' +
          (sombra.der ? 'opacity-100' : 'opacity-0')
        }
      />
    </div>
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
  lineas = [],
  lineaActiva = '',
  onLinea,
  hayMias = false,
}: {
  filtroSec: FiltroSec;
  onFiltro: (f: FiltroSec) => void;
  /** Cuántas filas daría cada filtro dentro del recorte actual (el server los cuenta). */
  conteos?: {
    pideInfo: number;
    sinResponder: number;
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
  /** Las líneas de WhatsApp vivas (#50). Con menos de dos, el selector no se dibuja. */
  lineas?: readonly LineaWhatsapp[];
  /** El número propio elegido; `''` = todas, `LINEA_MIAS` = las asignadas a quien mira. */
  lineaActiva?: string;
  onLinea?: (numero: string) => void;
  /** `numero_vendedora` le asigna alguna línea viva: recién ahí se ofrece «Las mías». */
  hayMias?: boolean;
}) {
  const categorias = categoriasDeLaBarra(catalogo, categoriaActiva);
  const conteoDe = (valor: string) =>
    valor === 'pide-info'
      ? conteos?.pideInfo
      : valor === 'sin-responder'
        ? conteos?.sinResponder
        : valor === 'puedo-escribirle'
          ? conteos?.puedoEscribirle
          : valor === 'ya-compraron'
            ? conteos?.yaCompraron
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
   * Las opciones del segmentado, y **son las TUYAS cuando el mapa te asigna
   * alguna**: la regla vive pura y con tests en `alcance.ts`. Con una sola línea
   * propia queda una opción y el control no se dibuja — no hay elección que tomar.
   */
  const opciones = opcionesDeLinea(lineas, hayMias);

  return (
    <div className="flex flex-col gap-1">
      {/* ══ FILA 1 — LA LÍNEA: NO ES UN FILTRO, ELIGE QUÉ COLA ═══════════════
          La fila de abajo recorta la cola; esto elige CUÁL. Con dos números
          vendiendo, «Piden info» sobre la cola de todas es una pregunta distinta
          que sobre la de Walter — así que la línea se decide antes, y por eso va
          arriba. Tiene fila propia desde el 6-ago: compartiendo pista, cuatro
          líneas vivas empujaban «Sin responder» fuera de la vista (ver el
          docblock del archivo).
          Segmentado y no chips sueltos porque las opciones son excluyentes: en
          un toggle, «Escuela» y «Walter» apagados a la vez tendrían que
          significar «ninguna», y significan «todas». Se ven todas a la vez
          —volver a «Todas» cuesta un click desde donde estés—, que es lo mismo
          que hace el chip de la auto-respuesta con sus dos modos.
          «Las mías» (`numero_vendedora`) es una opción MÁS de este mismo
          segmentado, no un toggle aparte: elegir «las mías» y elegir «Walter»
          son la misma pregunta —¿qué cola miro?—, y con dos controles
          existiría el estado imposible «las mías Y solo Walter».
          Sin oro: acá no se está acabando ningún tiempo. */}
      {seDibujaElSelector(opciones) && onLinea && (
        <Pista etiqueta="Elegir la cola" activo={lineaActiva}>
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/40 p-0.5"
            role="group"
            aria-label="Línea de WhatsApp"
          >
            <Smartphone size={11} className="ml-1.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {opciones.map((l) => {
              const activa = lineaActiva === l.numero;
              return (
                <button
                  key={l.numero || 'todas'}
                  data-chip
                  type="button"
                  aria-pressed={activa}
                  title={l.titulo}
                  onClick={() => onLinea(l.numero)}
                  className={
                    /* `max-w` + `truncate`: el rótulo lo escribe Cerberus y puede
                       venir largo («Escuela — línea principal»). El nombre entero
                       sigue en el `title`. */
                    'max-w-[7.5rem] shrink-0 truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold ' +
                    'transition-[background-color,color] duration-200 ease-house active:scale-[0.97] ' +
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' +
                    (activa
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {l.etiqueta}
                </button>
              );
            })}
          </div>
        </Pista>
      )}

      {/* ══ FILA 2 — LOS FILTROS: recortan DENTRO de la cola elegida ═════════
          Acá vive «Sin responder», que desde la banda de leído es la red de
          seguridad de la cola entera: lo que ya miré baja, y este chip lo trae
          de vuelta con su número. Por eso tiene que entrar sin scrollear. */}
      <Pista etiqueta="Afinar la cola" activo={filtroSec + '|' + (categoriaActiva ?? '')}>
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
      </Pista>
    </div>
  );
}
