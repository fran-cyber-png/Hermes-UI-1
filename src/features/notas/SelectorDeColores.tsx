import { COLORS_DEFAULT } from '@blocknote/core';
import { useBlockNoteEditor, useDictionary, useEditorState } from '@blocknote/react';
import { createContext, useContext, useState } from 'react';
import { Palette } from 'lucide-react';
import { usePopover } from '../../lib/teclado/usePopover';
import { cn } from '../../lib/utils';

/**
 * EL SELECTOR DE COLORES — propio, no el `ColorStyleButton` del paquete, y
 * partido en DOS mitades que viven en lugares distintos a propósito.
 *
 * ══ POR QUÉ NO ES UN COMPONENTE ÚNICO ═══════════════════════════════════════
 *
 * `BotonDeColores` (el gatillo) vive ADENTRO de `FormattingToolbarController`
 * — la barrita que sólo existe mientras hay selección, y que BlockNote puede
 * desmontar de golpe en cualquier clic (ver el docblock de `BarraFlotante.tsx`).
 * Si el PANEL de colores viviera ahí adentro también, un clic en el gatillo
 * podría desmontar el panel en el mismo instante en que se abre — el estado
 * `abierto` de un componente que se desmonta se pierde con él, así que el
 * panel nunca llegaría a pintarse. Medido: pasaba exactamente eso.
 *
 * La cura es que el panel viva AFUERA, en `BarraFlotante` (que está montada
 * siempre, no depende de la selección) — y el gatillo, en vez de guardar su
 * propio «¿estoy abierto?», le avisa a esa capa de afuera CUÁNDO abrir y DÓNDE
 * (su propio rectángulo, con `getBoundingClientRect()`, tomado en el mismo
 * `onClick`, antes de que nada tenga chance de desmontarlo). El puente es
 * `ContextoDeColores`.
 *
 * ══ CADA MUESTRA DE COLOR, TAMBIÉN CON `preventDefault` ═════════════════════
 *
 * Ningún elemento acá se queda con el foco NUNCA: `onMouseDown` con
 * `preventDefault()` en el gatillo y en cada muestra, y nada de `.focus()`
 * propio. Es la misma regla que ya usaba toda la Ribbon retirada.
 */

const COLORES = ['default', 'gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;

/**
 * 🔴 LA MUESTRA TIENE QUE PINTARSE CON EL MISMO TONO QUE EL PAQUETE VA A
 * APLICAR, Y ESE TONO NO ES EL MISMO PARA TEXTO QUE PARA FONDO.
 *
 * `COLORS_DEFAULT` (de `@blocknote/core`, la MISMA tabla que usa el paquete
 * para pintar — no una copia a mano) trae DOS tonos por color: `text` es el
 * vívido, `background` es el pastel. `addDefaultPropsExternalHTML` (el propio
 * código del paquete) usa `.text` para `textColor` y `.background` para
 * `backgroundColor` — nunca el mismo para los dos. Antes esto usaba UN solo
 * hex por color (el de `.text`) para las DOS filas, así que la fila «Fondo»
 * mostraba un punto vívido que no se parecía en nada al pastel que
 * realmente queda pintado atrás del texto.
 */
function tonoDeMuestra(color: string, variante: 'text' | 'background'): string | undefined {
  return COLORS_DEFAULT[color]?.[variante];
}

const ContextoDeColores = createContext<{ abrir: (rect: DOMRect) => void } | null>(null);

/** El gatillo — vive adentro de la barrita del paquete, y sólo avisa. */
export function BotonDeColores() {
  const ctx = useContext(ContextoDeColores);
  const dict = useDictionary();

  return (
    <button
      type="button"
      title={dict.formatting_toolbar.colors.tooltip}
      aria-label={dict.formatting_toolbar.colors.tooltip}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => ctx?.abrir(e.currentTarget.getBoundingClientRect())}
      className="flex size-[1.875rem] shrink-0 items-center justify-center rounded text-foreground transition hover:bg-secondary"
    >
      <Palette className="size-4" aria-hidden />
    </button>
  );
}

function FilaDeColores({
  titulo,
  variante,
  actual,
  onElegir,
}: {
  titulo: string;
  /** Con qué tono de `COLORS_DEFAULT` se pinta la muestra — ver `tonoDeMuestra`. */
  variante: 'text' | 'background';
  actual: string;
  onElegir: (color: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 px-0.5 text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className="flex flex-wrap gap-1">
        {COLORES.map((color) => (
          <button
            key={color}
            type="button"
            tabIndex={-1}
            title={color}
            aria-label={color}
            aria-pressed={actual === color}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onElegir(color)}
            className={cn(
              'size-5 rounded-full border',
              actual === color ? 'border-primary ring-1 ring-primary' : 'border-border',
              color === 'default' && 'bg-card',
            )}
            style={color === 'default' ? undefined : { backgroundColor: tonoDeMuestra(color, variante) }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * El panel — vive AFUERA, en `BarraFlotante`, siempre montado. `rect` es el
 * rectángulo del gatillo en el momento del clic (no se vuelve a medir: si
 * `BotonDeColores` desaparece un instante después, no hay nada que romper).
 */
export function PanelDeColores({ rect, onCerrar }: { rect: DOMRect; onCerrar: () => void }) {
  const editor = useBlockNoteEditor();
  const dict = useDictionary();
  const { propsOverlay } = usePopover(true, onCerrar, { z: 'z-20' });

  const estilos = useEditorState({ editor, selector: ({ editor }) => editor.getActiveStyles() as Record<string, string> });
  const textColor = estilos.textColor ?? 'default';
  const backgroundColor = estilos.backgroundColor ?? 'default';

  function aplicar(campo: 'textColor' | 'backgroundColor', color: string) {
    if (color === 'default') editor.removeStyles({ [campo]: color } as never);
    else editor.addStyles({ [campo]: color } as never);
  }

  return (
    <>
      <div {...propsOverlay} />
      <div
        className="fixed z-30 w-40 space-y-2 rounded-lg border border-border bg-card p-2 shadow-panel"
        style={{ top: rect.bottom + 4, left: rect.left }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <FilaDeColores
          titulo={dict.color_picker.text_title}
          variante="text"
          actual={textColor}
          onElegir={(c) => aplicar('textColor', c)}
        />
        <FilaDeColores
          titulo={dict.color_picker.background_title}
          variante="background"
          actual={backgroundColor}
          onElegir={(c) => aplicar('backgroundColor', c)}
        />
      </div>
    </>
  );
}

export function ProveedorDeColores({
  children,
}: {
  children: (panel: React.ReactNode) => React.ReactNode;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  return (
    <ContextoDeColores.Provider value={{ abrir: setRect }}>
      {children(rect && <PanelDeColores rect={rect} onCerrar={() => setRect(null)} />)}
    </ContextoDeColores.Provider>
  );
}
