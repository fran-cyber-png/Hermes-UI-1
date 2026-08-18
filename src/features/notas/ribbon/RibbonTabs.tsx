import { useRef, type KeyboardEvent } from 'react';
import { cn } from '../../../lib/utils';
import { TABS, type TabRibbon } from './catalogo';

/**
 * LA TIRA DE PESTAÑAS — patrón `tablist` de ARIA, con roving tabindex.
 *
 * ══ POR QUÉ ROVING Y NO CINCO PARADAS DE `TAB` ══════════════════════════════
 *
 * Es lo que dice el patrón, y acá además se nota: sin roving, alguien que llega
 * con el teclado desde el papel tiene que apretar `Tab` cinco veces sólo para
 * pasar la fila de pestañas. Con roving la tira es UNA parada y las flechas
 * eligen — que es como se maneja cualquier tablist del sistema operativo.
 *
 * El manejo de teclas es el mismo `onTeclas` de `canales/BarraFiltros.tsx`
 * (←/→ recorren, Inicio/Fin a los extremos), copiado en su forma porque hacer un
 * hook compartido con esa barra obligaría a sacarlo de `canales` a `lib` — un
 * refactor de otro frente.
 *
 * ⚠️ **La flecha MUEVE y ELIGE, no sólo mueve.** En un tablist «automático» eso
 * es lo correcto: la pestaña no dispara ninguna acción, sólo cambia lo que se
 * muestra, así que separar «recorrer» de «elegir» agregaría un Enter por gusto.
 */
export function RibbonTabs({
  activa,
  onElegir,
  idPanel,
}: {
  activa: TabRibbon;
  onElegir: (tab: TabRibbon) => void;
  idPanel: string;
}) {
  const tira = useRef<HTMLDivElement>(null);

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    const teclas = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!teclas.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    const i = TABS.findIndex((t) => t.id === activa);
    const destino =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? TABS.length - 1
          : Math.min(Math.max(i + (e.key === 'ArrowRight' ? 1 : -1), 0), TABS.length - 1);

    const tab = TABS[destino]!;
    onElegir(tab.id);
    tira.current?.querySelector<HTMLButtonElement>(`[data-ribbon-tab="${tab.id}"]`)?.focus();
  }

  return (
    <div
      ref={tira}
      role="tablist"
      aria-label="Herramientas de la página"
      onKeyDown={alTeclear}
      className="flex items-center gap-0.5"
    >
      {TABS.map((t) => {
        const seleccionada = t.id === activa;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ribbon-tab-${t.id}`}
            data-ribbon-tab={t.id}
            aria-selected={seleccionada}
            aria-controls={idPanel}
            // Roving: sólo la activa es alcanzable con Tab; las otras, con flechas.
            tabIndex={seleccionada ? 0 : -1}
            onClick={() => onElegir(t.id)}
            className={cn(
              'shrink-0 rounded-t border-b-2 px-3 py-1.5 text-xs transition',
              seleccionada
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
