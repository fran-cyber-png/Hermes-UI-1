import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { SELECTOR_CAMPOS } from '../../../lib/teclado/escapeDePopover';

/**
 * LA FILA DE COMANDOS ES **UNA SOLA PARADA DE `TAB`**.
 *
 * ══ 🔴 EL PROBLEMA QUE ESTO REEMPLAZA, Y QUE NO SE VE EN NINGÚN TEST ════════
 *
 * La barra vieja se montaba adentro de `<FormattingToolbar>`, cuyo `Root` de
 * `@blocknote/mantine` instala un **`useFocusTrap`**: apenas el foco entra a la
 * barra, `Tab` cicla ADENTRO y no vuelve nunca al papel. Con 18 botones eso ya
 * molestaba; con cinco pestañas y ~40 cajas es una trampa de la que hay que
 * salir con el mouse.
 *
 * Por eso la Ribbon **no usa `FormattingToolbar`** — se verificó leyendo el
 * fuente de los seis botones del paquete que ninguno necesita su contexto: sólo
 * piden `useComponentsContext()` (lo da `BlockNoteView`), `useBlockNoteEditor()`
 * y `useDictionary()`. Se montan derecho adentro de nuestros grupos, con toda su
 * lógica, y el teclado pasa a ser nuestro.
 *
 * ══ CÓMO ═══════════════════════════════════════════════════════════════════
 *
 * Roving tabindex: de todos los controles de la fila, uno solo tiene
 * `tabIndex=0`. `Tab` desde el papel entra a ese, `Tab` de nuevo sale al resto
 * de la página, y ←/→ recorren la fila.
 *
 * ⚠️ **Se normaliza el `tabIndex` en CADA render, y tiene que ser así**: la
 * mitad de los controles son de BlockNote y **aparecen y desaparecen solos**
 * (varios devuelven `null` cuando la selección no tiene contenido en línea). Una
 * lista calculada una vez apuntaría a nodos que ya no están, y el `Tab` caería
 * en el vacío. Es un recorrido de ~40 nodos: no es caro.
 *
 * ══ ⚠️ CON EL FOCO EN UN CAMPO, LAS FLECHAS SON DEL CAMPO ══════════════════
 *
 * El selector de fuente **es un `input`**: ahí ← y → mueven el cursor dentro de
 * lo tecleado, y robárselas para saltar de botón haría imposible corregir una
 * letra. Se pregunta con `SELECTOR_CAMPOS`, el mismo selector único que usan el
 * shell y `usePopover` — con una copia propia, la misma tecla en el mismo lugar
 * se juzgaría distinto según quién la escuche (es el defecto que #12 arregló).
 */

const FOCUSABLES = 'button:not([disabled]), input:not([disabled])';

/**
 * ⚠️ `data-roving-omitir` es cómo un control se declara FUERA del recorrido: lo
 * usa el chevron del `SelectorBuscable`, que no es un destino propio —abre el
 * mismo panel que el campo de al lado— y estaría dos veces en la fila.
 */
function controlesDe(contenedor: HTMLElement | null): HTMLElement[] {
  if (!contenedor) return [];
  return [...contenedor.querySelectorAll<HTMLElement>(FOCUSABLES)].filter(
    (el) => !el.hasAttribute('data-roving-omitir'),
  );
}

export function useRovingRibbon(
  contenedor: RefObject<HTMLElement | null>,
  { alSalir }: { alSalir: () => void },
) {
  /** Cuál es el que hoy tiene el `tabIndex=0`. Sobrevive a los re-renders. */
  const actual = useRef(0);

  // Sin lista de dependencias: corre después de cada render del panel, que es
  // justo cuando los controles del paquete pueden haber aparecido o desaparecido.
  useEffect(() => {
    const controles = controlesDe(contenedor.current);
    if (controles.length === 0) return;
    if (actual.current >= controles.length) actual.current = 0;
    controles.forEach((el, i) => {
      el.tabIndex = i === actual.current ? 0 : -1;
    });
  });

  function alEnfocar(e: React.FocusEvent<HTMLElement>) {
    const controles = controlesDe(contenedor.current);
    const i = controles.indexOf(e.target as HTMLElement);
    if (i >= 0) actual.current = i;
  }

  function alTeclear(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      // Escape devuelve el foco al papel: es la salida de la Ribbon sin mouse.
      // Con el foco en un campo NO, que ahí el Escape es del campo — el mismo
      // contrato que `reaccionDelPopover`.
      if ((e.target as HTMLElement).closest(SELECTOR_CAMPOS)) return;
      e.preventDefault();
      e.stopPropagation();
      alSalir();
      return;
    }

    const teclas = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!teclas.includes(e.key)) return;
    // ⚠️ En un campo, las flechas mueven el cursor. Ver el docblock.
    if ((e.target as HTMLElement).closest(SELECTOR_CAMPOS)) return;

    const controles = controlesDe(contenedor.current);
    if (controles.length === 0) return;
    e.preventDefault();
    e.stopPropagation();

    const desde = controles.indexOf(document.activeElement as HTMLElement);
    const i = desde < 0 ? 0 : desde;
    const destino =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? controles.length - 1
          : Math.min(Math.max(i + (e.key === 'ArrowRight' ? 1 : -1), 0), controles.length - 1);

    actual.current = destino;
    controles.forEach((el, j) => {
      el.tabIndex = j === destino ? 0 : -1;
    });
    controles[destino]?.focus();
  }

  return { alTeclear, alEnfocar };
}
