import { useEffect } from 'react';
import { reaccionDelPopover, SELECTOR_CAMPOS } from './escapeDePopover';

/**
 * Escape cierra el modal — el contrato compartido de TODOS los modales de
 * Hermes (FormularioVenta, los de compuerta del Pipeline, el gestor de
 * etiquetas, el lightbox de una foto…).
 *
 * Es el hermano de `usePopover` para lo que NO tiene overlay propio: un modal
 * ya viene con su scrim, y solo se monta abierto (por eso acá no hay guarda de
 * `abierto`). La decisión de qué cierra la toman los dos con la MISMA función
 * pura, así que no pueden divergir — que es exactamente lo que había pasado:
 * la copia del gestor de etiquetas se olvidó la guarda de campos y Escape
 * mientras se escribía una categoría cerraba el modal y tiraba lo tipeado.
 */
export function useEscape(onCerrar: () => void) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const focoEnCampo = Boolean((e.target as HTMLElement | null)?.closest(SELECTOR_CAMPOS));
      const reaccion = reaccionDelPopover(e.key, focoEnCampo);
      if (reaccion.tipo !== 'cerrar') return;
      e.stopPropagation();
      onCerrar();
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [onCerrar]);
}
