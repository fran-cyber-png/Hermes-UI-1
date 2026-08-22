import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { nombreCanal } from '../../components/BadgeCanal';
import { COLOR_RED, ICONO_RED } from '../../components/IconosRedes';
import type { LineaWhatsapp } from '../../dominio/lineas';
import { opcionesDeLinea } from './alcance';

/**
 * EL RIEL DE CANALES — la columna angosta al filo izquierdo de la cola.
 *
 * ⚠️ **Esto ROMPE a propósito «el canal es una insignia, no una columna»**
 * (`BadgeCanal.tsx`, `ColaUnificada.tsx:46`). La cola sigue siendo UNA lista
 * ordenada por la urgencia canónica del server; el riel no reordena nada,
 * RECORTA. Pero al darle al canal un eje propio y permanente, invita a trabajar
 * por bandeja en vez de por urgencia — que es justo lo que la cola unificada
 * evitaba. Se construyó igual porque se pidió (propuesta B, 21-ago-2026): el
 * riel es reversible (clic en el activo vuelve a la mezcla) y arranca SIN
 * canal elegido, así que el default sigue siendo la cola de siempre.
 *
 * ACORDEÓN: solo un canal abierto a la vez. Los otros quedan en ícono. Abierto,
 * WhatsApp despliega sus LÍNEAS como filas apiladas — la misma lista que sirve
 * `SelectorLinea` (`opcionesDeLinea`), para que las dos no puedan divergir.
 * ⚠️ **Facebook e Instagram despliegan EJEMPLOS, no datos.** `Conversacion` solo
 * trae `numero_propio`, que es la línea de WhatsApp: no hay campo de página ni
 * de cuenta con el que recortar la cola. Sus sub-niveles se dibujan para ver la
 * forma del acordeón (pedido del 21-ago-2026) y **no filtran nada** — se marcan
 * con `aria-disabled` y su `title` lo dice. Cuando el server mande la página/
 * cuenta, esto se reemplaza por su lista real igual que WhatsApp usa
 * `opcionesDeLinea`.
 *
 * NO HAY TEXTO VERTICAL. Rotar con `writing-mode` cuesta legibilidad, rompe el
 * truncado y obliga a alto fijo; el disco de marca ya identifica al canal y el
 * nombre va en `title` cerrado y en horizontal abierto.
 */

const CANALES = ['whatsapp', 'facebook', 'instagram'] as const;

/** Ejemplos de la forma que tendría el sub-nivel. NO son datos: ver el docblock. */
const EJEMPLOS: Record<string, readonly string[]> = {
  facebook: ['Todas', 'Goberna Perú', 'Goberna Bolivia'],
  instagram: ['Todas', '@goberna', '@goberna.cursos'],
};

export function RielCanales({
  canal,
  onCanal,
  conteos,
  lineas,
  hayMias,
  lineaActiva,
  onLinea,
}: {
  /** El canal abierto, o `null` = la cola mezclada de siempre. */
  canal: string | null;
  onCanal: (canal: string | null) => void;
  /** Cuántas filas daría cada canal dentro del recorte actual. */
  conteos: Record<string, number>;
  lineas: readonly LineaWhatsapp[];
  hayMias: boolean;
  lineaActiva: string;
  onLinea: (numero: string) => void;
}) {
  // El ancho lo manda SOLO la flecha. Elegir un canal lo abre (sus sub-niveles
  // necesitan el ancho), pero no lo traba: cerrar con un canal elegido es
  // válido y la elección sigue viva — la marca el fondo del disco y, si además
  // hay línea, el punto. Si `ancho` mirara `canal`, la flecha no podría cerrar.
  const [fijoAbierto, setFijoAbierto] = useState(false);
  const ancho = fijoAbierto;
  const opciones = opcionesDeLinea(lineas, hayMias);
  // Una línea no es una elección: con menos de dos, el acordeón de WhatsApp se
  // abre sin desplegar nada, igual que Facebook e Instagram.
  const hayLineas = opciones.length > 1;

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label="Filtrar la cola por canal"
      className={
        'flex shrink-0 flex-col gap-1 border-r border-border bg-muted/20 py-3 transition-[width] duration-200 ease-house ' +
        (ancho ? 'w-[132px] px-2' : 'w-11 items-center px-1.5')
      }
    >
      {/* LA FLECHA — arriba de WhatsApp, fuera del `role="tablist"` semántico
          en intención: no filtra nada, solo abre y cierra el riel. Se puede
          cerrar CON un canal elegido (pedido del 21-ago-2026): el canal activo
          se sigue viendo por su fondo, y si además hay una línea elegida el
          disco lleva un punto — si no, el filtro quedaría escondido sin nada
          que lo explicara. */}
      <button
        type="button"
        aria-expanded={ancho}
        title={ancho ? 'Ocultar los nombres' : 'Desplegar el riel'}
        aria-label={ancho ? 'Ocultar los nombres' : 'Desplegar el riel'}
        onClick={() => setFijoAbierto((v) => !v)}
        className={
          'mb-1 flex h-6 shrink-0 items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ' +
          (ancho ? 'w-full justify-end px-1.5' : 'w-8 justify-center')
        }
      >
        {ancho ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {CANALES.map((c) => {
        const abierto = canal === c;
        const n = conteos[c] ?? 0;
        const Icono = ICONO_RED[c];
        return (
          <div key={c} className="flex w-full flex-col">
            <button
              type="button"
              role="tab"
              aria-selected={abierto}
              title={ancho ? undefined : `${nombreCanal(c)}${n > 0 ? ` · ${n}` : ''}`}
              onClick={() => {
                onCanal(abierto ? null : c);
                if (!abierto) setFijoAbierto(true);
              }}
              className={
                'flex h-8 shrink-0 items-center gap-2 rounded-md transition-colors ' +
                (ancho ? 'w-full px-2' : 'w-8 justify-center') +
                (abierto ? ' bg-card text-foreground shadow-sm' : ' text-muted-foreground hover:bg-muted/60 hover:text-foreground')
              }
            >
              <Icono size={16} style={{ color: abierto ? COLOR_RED[c] : undefined }} className="shrink-0" />
              {ancho && <span className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold">{nombreCanal(c)}</span>}
              {n > 0 && (
                <span className={'shrink-0 font-mono text-[11px] tabular-nums ' + (ancho ? '' : 'hidden')}>{n}</span>
              )}
            </button>

            {/* EL DESPLIEGUE — `grid-rows-[0fr→1fr]` anima el alto sin medirlo
                en JS y sin alto fijo, así la lista puede crecer con las líneas
                que haya. Va SIEMPRE montado: desmontarlo mataría la animación
                de cierre. Con el riel angosto no se despliega — no entra. */}
            <div
              className={
                'grid transition-[grid-template-rows,opacity] duration-200 ease-house ' +
                (abierto && ancho ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')
              }
            >
              <div className="overflow-hidden">
                <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                  {c === 'whatsapp'
                    ? hayLineas &&
                      opciones.map((l) => {
                        const elegida = lineaActiva === l.numero;
                        return (
                          <button
                            key={l.numero || 'todas'}
                            type="button"
                            tabIndex={abierto && ancho ? 0 : -1}
                            title={l.titulo}
                            onClick={() => onLinea(l.numero)}
                            className={
                              'truncate rounded-md px-2 py-1 text-left text-[11px] font-normal transition-colors ' +
                              (elegida ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
                            }
                          >
                            {l.etiqueta}
                          </button>
                        );
                      })
                    : EJEMPLOS[c]?.map((e) => (
                        <span
                          key={e}
                          aria-disabled="true"
                          title="Ejemplo — todavía no filtra: el server no manda la página ni la cuenta"
                          className="truncate rounded-md px-2 py-1 text-left text-[11px] font-normal text-muted-foreground/60"
                        >
                          {e}
                        </span>
                      ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
