import { useEffect, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { cn } from '../utils';
import { reaccionDelPopover, SELECTOR_CAMPOS } from './escapeDePopover';

/**
 * UN POPOVER SE CIERRA DE DOS MANERAS — Escape y clic afuera. Las dos, acá.
 *
 * Es el wrapper con IO de `escapeDePopover.ts`: registra el listener, mira el
 * foco y arma el overlay. La decisión de si una tecla cierra vive allá.
 *
 * Lo que cambia respecto de las nueve copias a mano que reemplaza (#12):
 *
 *   · el listener va en CAPTURA y corta el evento — dos copias iban en burbuja
 *     sin cortar, así que Escape cerraba el popover Y la conversación de atrás;
 *   · respeta los campos — Escape con el foco en un input es del input;
 *   · el overlay del clic-afuera viene armado, no copiado.
 *
 * El z-index NO lo decide el hook: conviven tres escalas (menús 20/30, avisos
 * 30/40, cabeceras 40/50) por razones de apilamiento reales, y unificarlas es
 * otro cambio. Cada sitio pasa el suyo.
 *
 * Para un modal —sin overlay propio, siempre montado abierto— la puerta es
 * `useEscape`, que comparte el mismo predicado y por lo tanto no puede divergir.
 *
 * @param abierto Solo escucha mientras se ve: un popover cerrado no compite por el Escape.
 * @param cerrar  Qué hacer al cerrar. El sitio puede colgarle más cosas (MenuFila
 *                devuelve el foco al disparador); el hook no se entera ni le importa.
 */
export function usePopover(abierto: boolean, cerrar: () => void, { z = 'z-20' }: { z?: string } = {}) {
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      const focoEnCampo = Boolean((e.target as HTMLElement | null)?.closest(SELECTOR_CAMPOS));
      const reaccion = reaccionDelPopover(e.key, focoEnCampo);
      if (reaccion.tipo !== 'cerrar') return;
      e.stopPropagation();
      cerrar();
    };
    window.addEventListener('keydown', alTeclear, true);
    return () => window.removeEventListener('keydown', alTeclear, true);
  }, [abierto, cerrar]);

  /**
   * La capa invisible que cubre la pantalla: cualquier clic afuera del panel cae
   * acá. El `stopPropagation` es para que ese clic no despierte además lo que
   * haya debajo (abrir la conversación de la fila, por ejemplo).
   */
  const propsOverlay = useMemo(
    () => ({
      className: cn('fixed inset-0', z),
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        cerrar();
      },
      'aria-hidden': true as const,
    }),
    [z, cerrar],
  );

  return { propsOverlay };
}
