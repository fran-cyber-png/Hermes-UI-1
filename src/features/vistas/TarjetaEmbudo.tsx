import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlarmClock,
  ArrowLeft,
  BadgeDollarSign,
  Check,
  Clock,
  ClipboardList,
  History,
  MessageSquareText,
} from 'lucide-react';
import type { Conversacion } from '../../dominio/conversaciones';
import { Avatar } from '../../components/Avatar';
import { BadgeCanal } from '../../components/BadgeCanal';
import { detalleDeCurso } from '../../dominio/curso';
import { esPrioritaria, quiereFoto, siguienteConFoto } from '../../dominio/fotoVisible';
import { hace } from '../../lib/datos/frescura';
import { lecturaDeVentana } from '../../dominio/ventana';
import { lecturaDeAntiguedad } from '../../dominio/antiguedad';
import { etiquetaDeMedia } from '../../lib/etiquetaMedia';
import { horasDesde, tempClass, tempDegradado } from '../../lib/formato';
import { usePopover } from '../../lib/teclado/usePopover';
import { cursoDeTarjeta, haceCorto, nombreDeTarjeta, turnoDeTarjeta } from './tarjeta';

/** Los 6 destinos del selector «Escribir en» — bandera + nombre, en el orden pedido. */
const PAISES_ESCRIBIR_EN = [
  { pais: 'Estados Unidos', bandera: '🇺🇸' },
  { pais: 'Perú', bandera: '🇵🇪' },
  { pais: 'Ecuador', bandera: '🇪🇨' },
  { pais: 'México', bandera: '🇲🇽' },
  { pais: 'Brasil', bandera: '🇧🇷' },
  { pais: 'Bolivia', bandera: '🇧🇴' },
] as const;

/**
 * LA TARJETA DEL PIPELINE — lo que decide a quién tocar y qué decirle.
 *
 * La anterior mostraba nombre + hora + un pedazo del último mensaje, y con los
 * datos reales las 1.389 tarjetas de Contactados salían idénticas: el pedazo de
 * mensaje era NUESTRA plantilla, repetida. Ahora la tarjeta dice, en este orden:
 *
 *   1. QUIÉN — la foto y el nombre del formulario, no el pushname «🦋W».
 *   2. DE QUIÉN ES EL TURNO y hace cuánto — el ✓ de «le contestamos» y la flecha
 *      de «nos escribió», con la tinta de temperatura de la casa.
 *   3. DE QUÉ CURSO — el interés registrado o el que eligió en el formulario.
 *   4. SI YA LE PASAMOS EL PRECIO — y ahí mismo el botón para asentarlo.
 *
 * La tarjeta CRECE CON LO QUE TIENE QUE DECIR: una conversación sin curso ni
 * precio ocupa un renglón; una que ya está cotizada de hecho ocupa dos y trae su
 * acción. Densidad donde no hay nada que contar, detalle donde sí.
 *
 * El oro no aparece acá salvo en el seguimiento VENCIDO: es el único plazo duro
 * de esta pantalla, y el oro significa tiempo que se acaba, nada más.
 */

/** Cuántas tarjetas de cada columna piden foto sin esperar al scroll (anti-ban #59). */
const CON_FOTO_ARRIBA = 8;

function useConFotoVisible(indice: number, canal: string) {
  const prioritaria = esPrioritaria(indice, CON_FOTO_ARRIBA) && quiereFoto(canal);
  const [conFoto, setConFoto] = useState(prioritaria);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conFoto || !quiereFoto(canal) || typeof IntersectionObserver === 'undefined') return;
    const el = elRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>('[data-scroll-columna]');
    const observer = new IntersectionObserver(
      (entradas) => setConFoto((actual) => siguienteConFoto(actual, entradas)),
      { root, rootMargin: '160px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [conFoto, canal]);

  return { conFoto, elRef };
}

/** El chip de un dato de la tarjeta: neutro, con borde, nunca sombra ni oro. */
function Chip({
  icono,
  children,
  titulo,
  tono = 'neutro',
  encoge = false,
}: {
  icono?: React.ReactNode;
  children: React.ReactNode;
  titulo?: string;
  tono?: 'neutro' | 'marca' | 'oro';
  /** Quién cede el ancho cuando no alcanza. Solo el curso encoge; los rótulos cortos, nunca. */
  encoge?: boolean;
}) {
  const tonos = {
    neutro: 'border-border text-muted-foreground',
    marca: 'border-navy/20 bg-secondary text-secondary-foreground',
    /* El ORO significa tiempo que se acaba y NADA más (`src/index.css`). Acá lo
       lleva solo la ventana a punto de cerrarse; si algún chip más lo tomara,
       dejaría de querer decir «ahora». */
    oro: 'border-gold/40 bg-gold/20 text-gold-ink',
  };
  return (
    <span
      title={titulo}
      className={
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold ' +
        (encoge ? 'min-w-0 shrink ' : 'shrink-0 ') +
        tonos[tono]
      }
    >
      {icono}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function TarjetaEmbudo({
  c,
  indice,
  onAbrir,
  onFicha,
  abierta,
  alArrastrar,
  alTerminar,
  arrastrando,
  rebotada,
  columna,
}: {
  c: Conversacion;
  indice: number;
  onAbrir: (c: Conversacion) => void;
  /** Un clic en la tarjeta abre la ficha al costado, sin salir del tablero. */
  onFicha?: (c: Conversacion) => void;
  /** Esta es la que está en la hoja: se marca, o no se sabe de cuál se está leyendo. */
  abierta?: boolean;
  alArrastrar: (c: Conversacion) => void;
  alTerminar: () => void;
  arrastrando: boolean;
  rebotada: boolean;
  /** El título de la columna, solo para el `title` de la antigüedad («lleva 3 d en Cotizados»). */
  columna?: string;
}) {
  const { conFoto, elRef } = useConFotoVisible(indice, c.canal);
  /**
   * EL SELECTOR «ESCRIBIR EN» — en vez de ir directo a Mensajes, el botón de la
   * burbuja abre un cuadrito con los 6 países. Un país por tarjeta, no por app:
   * si dos tarjetas se abren a la vez (no debería pasar, pero) cada una tiene su
   * propio estado, no uno solo compartido por el tablero entero.
   *
   * 🔴 **Va por portal a `document.body`, con `position: fixed` medido contra el
   * VIEWPORT.** La columna del tablero es `overflow-y-auto` (`data-scroll-columna`
   * en `VistaEmbudo.tsx`) — y un `overflow-y` que no sea `visible` recorta
   * también el eje X, aunque nadie haya puesto `overflow-x` a mano. Un
   * `absolute` normal, aunque midiera bien, quedaba invisible: recortado por la
   * columna antes de llegar a pintarse. Mismo problema que resolvió
   * `MenuFila.tsx` para su propio scroller, pero acá el recorte es horizontal,
   * así que la salida es escapar del DOM de la columna entera, no solo elegir
   * un lado.
   */
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [posicionMenu, setPosicionMenu] = useState<{ top: number; left: number; lado: 'derecha' | 'izquierda' } | null>(null);
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const { propsOverlay } = usePopover(menuAbierto, () => setMenuAbierto(false), { z: 'z-40' });

  const ANCHO_MENU_PX = 176; // w-44

  function alternarMenu() {
    if (menuAbierto) {
      setMenuAbierto(false);
      return;
    }
    const r = disparadorRef.current?.getBoundingClientRect();
    if (!r) return;
    // Si a la derecha no entra (columnas del final del tablero, pegadas al
    // borde de la pantalla), abre hacia la izquierda del ícono en vez de
    // salirse de la ventana.
    const entraADerecha = r.right + 8 + ANCHO_MENU_PX <= window.innerWidth;
    setPosicionMenu({
      top: r.top + r.height / 2,
      left: entraADerecha ? r.right + 8 : r.left - 8 - ANCHO_MENU_PX,
      lado: entraADerecha ? 'derecha' : 'izquierda',
    });
    setMenuAbierto(true);
  }
  /**
   * ⚠️ ARRASTRAR NO ES CLICKEAR, y el navegador no siempre está de acuerdo.
   *
   * La tarjeta es `draggable` desde #60: soltarla en otra columna la mueve de
   * etapa. Un drag que empieza y termina sobre la misma tarjeta —soltar sin
   * moverse, o cancelar con Escape— puede terminar disparando `click`, y ahí
   * cada arrastre fallido abriría la ficha encima del tablero que se estaba
   * ordenando. La marca se levanta en el tick siguiente al `dragend`, que es
   * cuando el `click` ya pasó de largo.
   */
  const huboArrastre = useRef(false);
  const nombre = nombreDeTarjeta(c);
  const { turno, apremia } = turnoDeTarjeta(c);
  const curso = cursoDeTarjeta(c);
  const horas = horasDesde(c.referencia);

  // El preview solo cuando la pelota es NUESTRA: si el último mensaje es el
  // nuestro, lo que se lee es la plantilla que mandamos — la misma en decenas de
  // tarjetas. Ahí el renglón no aporta y la tarjeta se calla.
  const preview =
    turno !== 'silencio'
      ? c.texto || etiquetaDeMedia(c.ultima_clase) || (c.ultima_origen?.fuente === 'anuncio' ? '📣 Vino del anuncio' : '')
      : '';

  /**
   * Cuánto le queda de ventana. Se recalcula en cada render y no se memoiza: el
   * dato ES el paso del tiempo, y un `useMemo` con `[c]` lo congelaría hasta que
   * la tarjeta cambie por otro motivo. Mismo criterio que `FilaConversacion`.
   */
  const ventana = lecturaDeVentana(c.ventana_cierra, new Date());

  /**
   * CUÁNTO LLEVA EN SU COLUMNA (`canales/antiguedad.ts`). Es el dato que separa a
   * dos tarjetas que la etapa iguala: la que recibió el precio hace 40 minutos y
   * la que lo recibió hace tres semanas y no contestó nunca.
   *
   * `yaVisible` es lo que ya dice el reloj de arriba: cuando los dos números
   * coinciden —el caso más común— la tarjeta se calla en vez de repetirse.
   * También sin memoizar: el dato ES el paso del tiempo.
   */
  const antiguedad = lecturaDeAntiguedad(c.etapa_desde, new Date(), {
    columna,
    yaVisible: haceCorto(horas),
  });

  const haySegundoRenglon = Boolean(
    // `landing` entra a la lista porque su píldora VIVE en ese renglón: un lead
    // sin curso ni preview no dibujaría el renglón, y entonces la marca que lo
    // distingue de un chat desaparecería justo en la tarjeta más pobre.
    curso || c.precio_enviado || ventana || antiguedad || preview || c.canal === 'landing',
  );

  return (
    <div
      ref={elRef}
      draggable
      role={onFicha ? 'button' : undefined}
      tabIndex={onFicha ? 0 : undefined}
      aria-label={onFicha ? `Ver la ficha de ${nombre.texto}` : undefined}
      onClick={
        onFicha
          ? () => {
              if (huboArrastre.current) return;
              onFicha(c);
            }
          : undefined
      }
      onKeyDown={
        onFicha
          ? (e) => {
              // Solo cuando el foco está en la tarjeta misma: si no, Enter sobre
              // el botón de «Cotizado» abriría la ficha además de cotizar.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFicha(c);
              }
            }
          : undefined
      }
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        huboArrastre.current = true;
        alArrastrar(c);
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          huboArrastre.current = false;
        }, 0);
        alTerminar();
      }}
      className={
        'group cursor-grab rounded-xl bg-card px-2.5 py-1.5 shadow-[0_1px_2px_rgba(14,42,82,0.06)] transition-[box-shadow,opacity,transform] duration-200 ease-house hover:shadow-panel active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
        tempDegradado(c.referencia) +
        (arrastrando ? ' scale-[0.98] opacity-40' : '') +
        (rebotada ? ' ring-1 ring-temp-frio' : '') +
        // De cuál se está leyendo la ficha. Navy y no oro: acá no hay ningún
        // reloj corriendo, es solo «esta es la que estás mirando».
        (abierta ? ' ring-1 ring-navy' : '')
      }
    >
      {/* ── QUIÉN, Y DE QUIÉN ES EL TURNO ── */}
      <div className="flex items-center gap-2">
        <span className="relative shrink-0">
          <Avatar
            nombre={nombre.texto}
            telefono={c.canal === 'whatsapp' ? c.persona_id : null}
            numeroPropio={c.numero_propio}
            conFoto={conFoto}
            className="size-7 rounded-full bg-secondary text-[11px] font-bold text-navy-ink"
          />
          <span className="absolute -bottom-1 right-0">
            <BadgeCanal canal={c.canal} size={8} />
          </span>
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span
            title={nombre.delFormulario ? `${nombre.texto} · del formulario` : nombre.texto}
            className={
              'min-w-0 truncate font-heading text-sm font-bold ' +
              (turno === 'silencio' ? 'text-foreground/85' : 'text-foreground')
            }
          >
            {nombre.texto}
          </span>
          {nombre.delFormulario && (
            <ClipboardList
              size={10}
              className="shrink-0 text-muted-foreground"
              aria-label="Nombre del formulario que llenó"
            />
          )}
        </span>

        {turno === 'vencido' ? (
          <span
            title={`El seguimiento que agendaste venció · ${hace(horas)}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-gold-ink"
          >
            <AlarmClock size={11} /> venció
          </span>
        ) : (
          <span
            title={
              (turno === 'silencio' ? 'Le contestamos y no volvió · ' : 'Te está esperando · ') +
              hace(horas)
            }
            className={
              'inline-flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums ' +
              (apremia ? 'font-bold text-temp-fresco' : tempClass(c.referencia))
            }
          >
            {turno === 'silencio' ? (
              <Check size={11} className="text-success" aria-label="le contestamos" />
            ) : (
              <ArrowLeft size={11} aria-label="te escribió" />
            )}
            {haceCorto(horas)}
          </span>
        )}

        <button
          ref={disparadorRef}
          type="button"
          title="Abrir en Mensajes"
          aria-haspopup="true"
          aria-expanded={menuAbierto}
          onClick={(e) => {
            // Sin esto el clic también abriría la ficha al costado, y el
            // popover ya está tapando la tarjeta.
            e.stopPropagation();
            alternarMenu();
          }}
          className={
            'shrink-0 rounded-md p-1 text-muted-foreground transition-[color,background-color,opacity] duration-200 hover:bg-secondary hover:text-navy-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.96] ' +
            (menuAbierto ? 'bg-secondary text-navy-ink opacity-100' : 'opacity-0 group-hover:opacity-100')
          }
        >
          <MessageSquareText size={13} />
        </button>
      </div>

      {/* El cuadrito «Escribir en» va por PORTAL a `document.body` — ver el
          porqué arriba, en `alternarMenu`. `position: fixed` con las
          coordenadas ya resueltas contra el viewport (no contra la tarjeta):
          por eso no lleva `absolute`/`relative` acá. */}
      {menuAbierto &&
        posicionMenu &&
        createPortal(
          <>
            <span {...propsOverlay} />
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ top: posicionMenu.top, left: posicionMenu.left }}
              className="fixed z-50 w-44 -translate-y-1/2 rounded-xl border border-border bg-card p-2 shadow-panel"
            >
              <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Escribir en
              </p>
              <div className="grid grid-cols-2 gap-1">
                {PAISES_ESCRIBIR_EN.map(({ pais, bandera }) => (
                  <button
                    key={pais}
                    type="button"
                    title={pais}
                    onClick={() => {
                      setMenuAbierto(false);
                      onAbrir(c);
                    }}
                    className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-center transition-colors duration-200 ease-house hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="text-base leading-none">{bandera}</span>
                    <span className="truncate text-[11px] leading-tight text-muted-foreground">{pais}</span>
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* ── DE QUÉ, Y QUÉ FALTA PARA COBRARLO ── */}
      {haySegundoRenglon && (
        <div className="mt-1 flex items-center gap-1.5 pl-9">
          {/*
            🔴 SIN CONVERSACIÓN — la marca que separa dos trabajos OPUESTOS que
            comparten columna. A quien te escribió le contestás y es gratis; a
            éste hay que ABRIRLE el chat en frío, que en las líneas whatsmeow es
            el camino corto al ban (regla dura #7). Sin esto las dos tarjetas se
            ven iguales y la vendedora no puede saber cuál es cuál.

            ⚠️ Va en el SEGUNDO renglón y no al lado del nombre: ahí la píldora
            se comía el nombre («A…», «L…») en una columna de 225 px, y el nombre
            es lo que identifica a la persona. Lo mostró la captura.

            Se decide por `canal` y no por el prefijo de la clave: el canal es el
            dato, la clave es plomería.
          */}
          {c.canal === 'landing' && (
            <Chip
              tono="neutro"
              titulo="Llenó el formulario y todavía no existe conversación: hay que abrirla"
            >
              Formulario
            </Chip>
          )}
          {curso && (
            <Chip tono="marca" encoge titulo={detalleDeCurso(curso)}>
              {curso.nombre}
            </Chip>
          )}
          {c.precio_enviado && (
            <Chip
              icono={<BadgeDollarSign size={10} className="shrink-0" />}
              titulo="Ya le mandaste el precio o la forma de pagar"
            >
              Precio
            </Chip>
          )}
          {/*
            LA VENTANA, EN TODAS LAS COLUMNAS (ADR 0041). No alcanza con el chip
            de recorte de Contactados: el caso que más vale del tablero es un
            COTIZADO con la ventana abierta —sabe el precio Y se le puede
            escribir gratis ahora—, y esa columna no tiene recorte. La píldora lo
            dice sin filtrar nada.

            Misma lectura que la fila de la cola (`canales/ventana.ts`), así que
            «6 h» significa lo mismo en las dos pantallas. Y el oro sigue
            queriendo decir una sola cosa: queda menos de 3 h.
          */}
          {ventana && (
            <Chip
              icono={<Clock size={10} className="shrink-0" />}
              titulo={`${ventana.ayuda} — sin pagar una plantilla`}
              tono={ventana.urgente ? 'oro' : 'neutro'}
            >
              {ventana.texto}
            </Chip>
          )}
          {/*
            CUÁNTO LLEVA EN LA COLUMNA. Sin oro a propósito (`canales/antiguedad.ts`):
            el oro significa «tiempo que se acaba» y acá no hay ningún plazo
            corriendo — una conversación vieja no vence, se enfría. Va en tinta
            neutra, con el reloj de historial que la distingue del reloj de la
            ventana, que está justo al lado y sí es una cuenta regresiva.
          */}
          {antiguedad && (
            <Chip icono={<History size={10} className="shrink-0" />} titulo={antiguedad.ayuda}>
              {antiguedad.texto}
            </Chip>
          )}
          {!curso && !c.precio_enviado && preview && (
            <p className="min-w-0 flex-1 truncate text-sm text-foreground">{preview}</p>
          )}
        </div>
      )}
    </div>
  );
}
