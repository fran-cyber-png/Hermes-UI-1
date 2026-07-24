import { useEffect } from 'react';

/**
 * Escape cierra el modal — el contrato compartido de TODOS los modales de
 * Hermes (FormularioVenta, los de compuerta del Pipeline…):
 *
 *   · respeta los inputs: con el foco en un input/textarea/select, Escape es
 *     del campo (cerrar su dropdown, abandonar la edición), no del modal;
 *   · va en CAPTURA con stopPropagation, para que ningún listener global del
 *     shell (p. ej. «Escape cierra la conversación») reciba el mismo Escape.
 *
 * Vivía copiado verbatim en cada modal; un solo lugar para que el contrato no
 * divergiera en la tercera copia.
 */
export function useEscape(onCerrar: () => void) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      e.stopPropagation();
      onCerrar();
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [onCerrar]);
}
