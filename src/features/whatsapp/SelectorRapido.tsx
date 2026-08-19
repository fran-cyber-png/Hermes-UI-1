import { useEffect, useRef } from 'react';
import { MessageSquareQuote, Settings2 } from 'lucide-react';
import type { HechoDelCatalogo } from '../hechos/catalogo';

/**
 * LAS RESPUESTAS RÁPIDAS, ABIERTAS CON `/` EN LA CAJA.
 *
 * ── Qué son, y por qué no hay un catálogo nuevo ─────────────────────────────
 * Son los «datos recomendados» de siempre (tabla `hechos`, #153): frases sueltas
 * que la vendedora pega, edita y manda ella. El plan del CRM ya las había
 * bautizado «respuestas rápidas» con el `/precio` de ejemplo, y su `clave` ya es
 * un slug estable y único — o sea que **el nombre del comando ya existía**. Lo
 * único que faltaba era la puerta. Un catálogo nuevo habría dejado del lado
 * equivocado del `/` las 30 frases que el equipo ya mantiene.
 *
 * ── Por qué esto NO maneja el teclado ───────────────────────────────────────
 * 🔴 El foco **se queda en el textarea** mientras el selector está abierto: es
 * lo que permite seguir tipeando para filtrar. Entonces las flechas y el Enter
 * los tiene que interceptar el `onKeyDown` de la caja, no este componente — acá
 * solo llega el mouse. Por lo mismo **no se usa `usePopover`**: su Escape se
 * ignora a propósito cuando el foco está en un campo (`escapeDePopover.ts`), que
 * es justo nuestro caso. El molde es `gestion/Intereses.tsx`.
 *
 * ── El orden vertical ───────────────────────────────────────────────────────
 * Se abre HACIA ARRIBA (`bottom-full`) porque la caja vive al fondo de la
 * pantalla: abajo no hay lugar, y un menú que tapa lo que se está escribiendo es
 * peor que uno que tapa lo ya escrito.
 */

interface Props {
  /** Lo tipeado después de la barra. Solo para el vacío honesto. */
  consulta: string;
  respuestas: HechoDelCatalogo[];
  /** Cuál está marcada. La mueve el teclado, que vive en la caja. */
  indice: number;
  onIndice: (i: number) => void;
  onElegir: (h: HechoDelCatalogo) => void;
  /** Abre la pantalla donde se crean, editan y apagan. */
  onAdministrar: () => void;
}

export function SelectorRapido({ consulta, respuestas, indice, onIndice, onElegir, onAdministrar }: Props) {
  const listaRef = useRef<HTMLDivElement>(null);

  // La marcada se trae a la vista tocando SOLO `scrollTop` del contenedor.
  // `scrollIntoView` scrollea los ancestros igual y se llevaría el hilo entero
  // (la lección está escrita en `canales/BarraFiltros.tsx`).
  useEffect(() => {
    const cont = listaRef.current;
    const el = cont?.children[indice] as HTMLElement | undefined;
    if (!cont || !el) return;
    const caja = cont.getBoundingClientRect();
    const fila = el.getBoundingClientRect();
    if (fila.top < caja.top) cont.scrollTop -= caja.top - fila.top;
    else if (fila.bottom > caja.bottom) cont.scrollTop += fila.bottom - caja.bottom;
  }, [indice]);

  return (
    <div
      role="listbox"
      aria-label="Respuestas rápidas"
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-panel"
    >
      {/* La cabecera y el pie llevan la MISMA colorimetría azul que
          «Configurar Respuestas Rápidas» de la Libreta (`--secondary` de
          fondo, `--primary`/`--navy` de texto e ícono): son dos puertas al
          mismo catálogo de `hechos`, y hasta acá una se veía gris y la otra
          azul — el mismo dato con dos apariencias que iban a divergir (#37). */}
      <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-3 py-1.5 text-[11px] font-semibold text-navy">
        <MessageSquareQuote size={12} className="shrink-0 text-primary" />
        Respuestas rápidas
        <span className="ml-auto font-normal text-muted-foreground">
          {respuestas.length > 0 ? '↑↓ para elegir · Enter para ponerla en la caja' : ''}
        </span>
      </div>

      {respuestas.length === 0 ? (
        // El vacío dice QUÉ se buscó. «No hay resultados» a secas deja pensando
        // que el catálogo está vacío, y son 27.
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Ninguna respuesta coincide con <span className="font-mono text-foreground">/{consulta}</span>.
        </p>
      ) : (
        <div ref={listaRef} className="max-h-64 space-y-0.5 overflow-y-auto p-1.5">
          {respuestas.map((h, i) => (
            <button
              key={h.clave}
              type="button"
              role="option"
              aria-selected={i === indice}
              // `onMouseDown` con `preventDefault` y NO `onClick`: un clic normal
              // le saca el foco al textarea antes de que corra el handler, y con
              // el foco perdido el cursor deja de estar donde hay que insertar.
              onMouseDown={(e) => {
                e.preventDefault();
                onElegir(h);
              }}
              onMouseEnter={() => onIndice(i)}
              // Molde de `Fila` (`PantallaHechos.tsx`) y de `FilaPagina`
              // (`Libreta.tsx`): fila con borde propio, azul cuando está
              // marcada y un hover más suave del MISMO azul — no gris.
              className={
                'block w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors ' +
                (i === indice
                  ? 'border-primary bg-secondary'
                  : 'border-transparent hover:border-primary/30 hover:bg-secondary/60')
              }
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={
                    'truncate text-xs font-bold ' + (i === indice ? 'text-navy' : 'text-foreground')
                  }
                >
                  {h.rotulo}
                </span>
                {/* La clave ES el atajo, y mostrarla es lo que lo enseña: la
                    próxima vez se escribe directo. */}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">/{h.clave}</span>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{h.texto}</div>
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border p-1.5">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onAdministrar();
          }}
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-navy transition-colors hover:bg-secondary hover:text-primary"
        >
          <Settings2 size={12} />
          Crear o editar respuestas
        </button>
      </div>
    </div>
  );
}
