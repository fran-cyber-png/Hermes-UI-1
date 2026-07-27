import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Tags, X } from 'lucide-react';
import {
  CLASE_BORDE,
  CLASE_FONDO,
  CLASE_FONDO_SUAVE,
  CLASE_TEXTO,
  esColorCategoria,
} from '../gestion/paletaCategorias';
import { categoriasDeLaBarra, FILTROS_SEC, type CategoriaEnBarra, type FiltroSec } from './cola';

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
 */
/** ¿Hay más chips a la izquierda / a la derecha de lo que se ve? (los 4 px son ruido de subpíxel). */
function sombrasDe(el: HTMLElement): { izq: boolean; der: boolean } {
  return { izq: el.scrollLeft > 4, der: el.scrollWidth - el.clientWidth - el.scrollLeft > 4 };
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
  conteos?: { pideInfo: number; sinResponder: number; yaCompraron?: number };
  catalogo?: readonly CategoriaEnBarra[];
  categoriaActiva: string | null;
  onCategoria: (c: { nombre: string; color: string } | null) => void;
  /** Abre el modo Listas, donde están TODAS las categorías y su edición. */
  onListas: () => void;
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

  const categorias = categoriasDeLaBarra(catalogo, categoriaActiva);
  const conteoDe = (valor: string) =>
    valor === 'pide-info'
      ? conteos?.pideInfo
      : valor === 'sin-responder'
        ? conteos?.sinResponder
        : valor === 'ya-compraron'
          ? conteos?.yaCompraron
          : undefined;

  return (
    /* `-mx-3` + `px-3` en la pista: la barra SANGRA hasta el borde del panel. Si
       se quedara dentro del padding, el último chip se cortaría en seco contra
       el borde y el degradado quedaría 12 px adentro, sin tapar el corte —que es
       justo lo que tiene que disimular—. */
    <div className="relative -mx-3">
      <div
        ref={pista}
        role="toolbar"
        aria-label="Afinar la cola"
        onScroll={medir}
        onKeyDown={onTeclas}
        className="sin-riel flex items-center gap-1.5 overflow-x-auto scroll-smooth px-3 py-0.5"
      >
        {FILTROS_SEC.map((f) => {
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
