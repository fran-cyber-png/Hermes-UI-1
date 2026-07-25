import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ALTO_MENU_PX, armarAccionesFila, ladoDelMenu, type EstadoPersonalFila } from './accionesFila';

/**
 * LA FLECHITA ▼ DE LA FILA — la puerta única a las marcas personales
 * (fijar · no leído · favoritos) de UNA conversación de la cola.
 *
 * Reemplaza a los tres iconos sueltos que #49 dejó flotando sobre la esquina
 * derecha de la fila: al hacer hover se pintaban ENCIMA de la hora («hace 44
 * min») y escondían el dato con el que la vendedora prioriza. Acá la flechita
 * vive en un canal propio —`FilaConversacion` le reserva el `pr-9`, así la fila
 * no salta cuando aparece y desaparece— y las acciones se leen con nombre y
 * apellido en un menú, como en WhatsApp Web.
 *
 * Patrón de popover calcado de `MenuHerramientas` (el `···` de la BarraGestion):
 * overlay `fixed inset-0` + panel `absolute` con `shadow-panel`, Escape con
 * capture + stopPropagation, foco al primer item al abrir, y cierre forzado si
 * cambia la conversación de abajo. Botones planos, sin roles de menú.
 *
 * Lo único distinto —y por eso `accionesFila.ts` es un módulo aparte con tests— es
 * que la cola VIVE DENTRO de un `overflow-y-auto`: en las últimas filas, abrir
 * hacia abajo sería abrir un menú recortado. El lado se decide en el clic.
 */
export function MenuFila({
  clave,
  estado,
  tabIndex,
  onFijar,
  onFavorita,
  onLeido,
}: {
  /** La conversación de esta fila: si cambia, el menú abierto ya no le corresponde. */
  clave: string;
  estado: EstadoPersonalFila;
  /** Roving tabindex de la cola: solo la fila enfocada ofrece su flechita al Tab. */
  tabIndex?: number;
  onFijar: () => void;
  onFavorita: () => void;
  onLeido: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lado, setLado] = useState<'abajo' | 'arriba'>('abajo');
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const primerItemRef = useRef<HTMLButtonElement>(null);

  // La fila se recicla: la misma posición de la lista pasa a ser otra
  // conversación (llegó un mensaje y todo subió). Un menú que sobreviva a ese
  // cambio queda apuntando a la de antes — y sus acciones son escrituras.
  useEffect(() => {
    setAbierto(false);
  }, [clave]);

  useEffect(() => {
    if (!abierto) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setAbierto(false);
        disparadorRef.current?.focus();
      }
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [abierto]);

  useEffect(() => {
    if (abierto) primerItemRef.current?.focus();
  }, [abierto]);

  const acciones = armarAccionesFila(estado, {
    fijar: onFijar,
    leido: onLeido,
    favorita: onFavorita,
  });

  /**
   * Antes de abrir, mide contra el scroller de la cola (`[data-scroll-cola]`,
   * el mismo que usa el observer de las fotos) y no contra la ventana: lo que
   * recorta el panel es ese contenedor, no el viewport.
   */
  function abrir() {
    const el = disparadorRef.current;
    if (el) {
      const disparador = el.getBoundingClientRect();
      const scroller = el.closest<HTMLElement>('[data-scroll-cola]')?.getBoundingClientRect();
      setLado(
        ladoDelMenu({
          arribaDisparador: disparador.top,
          abajoDisparador: disparador.bottom,
          limiteArriba: scroller?.top ?? 0,
          limiteAbajo: scroller?.bottom ?? window.innerHeight,
          altoMenu: ALTO_MENU_PX,
        }),
      );
    }
    setAbierto(true);
  }

  return (
    <span
      className={
        'absolute right-1.5 top-2 z-10 inline-flex transition-opacity ' +
        // Invisible = intocable: si no, la esquina derecha de CADA fila se come
        // el clic con un botón que no se ve. Vuelve a la vida con el mouse
        // encima de la fila, con el foco de teclado en la fila, o abierta.
        (abierto
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 ' +
            'group-hover/fila:pointer-events-auto group-hover/fila:opacity-100 ' +
            'group-focus-within/fila:pointer-events-auto group-focus-within/fila:opacity-100')
      }
    >
      <button
        ref={disparadorRef}
        type="button"
        tabIndex={tabIndex}
        aria-label="Acciones de la conversación"
        aria-haspopup="true"
        aria-expanded={abierto}
        title="Acciones de la conversación"
        onClick={(e) => {
          // La flechita es hermana del <button> de la fila, no su hija (HTML no
          // anida botones), así que el clic no burbujea hasta «abrir». Igual se
          // corta: el día que la fila entera se vuelva clickeable desde el
          // contenedor, abrir el menú no puede abrir la conversación.
          e.stopPropagation();
          if (abierto) setAbierto(false);
          else abrir();
        }}
        className={
          'flex items-center rounded-md p-0.5 transition-colors ' +
          (abierto ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
        }
      >
        <ChevronDown size={15} />
      </button>

      {abierto && (
        <>
          <span
            className="fixed inset-0 z-20"
            onClick={(e) => {
              e.stopPropagation();
              setAbierto(false);
            }}
            aria-hidden="true"
          />
          <div
            className={
              'absolute right-0 z-30 w-52 rounded-xl bg-card p-1.5 shadow-panel ' +
              (lado === 'abajo' ? 'top-7' : 'bottom-7')
            }
          >
            {acciones.map((accion, i) => (
              <button
                key={accion.id}
                ref={i === 0 ? primerItemRef : undefined}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  accion.onSeleccionar();
                  setAbierto(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                <accion.Icono size={13} className="shrink-0 text-muted-foreground" />
                {accion.etiqueta}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
