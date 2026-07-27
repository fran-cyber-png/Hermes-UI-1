import { useEffect } from 'react';
import { reaccionDelPopover, SELECTOR_CAMPOS } from './escapeDePopover';

/**
 * Escape cierra el modal — el contrato compartido de TODOS los modales de
 * Hermes (FormularioVenta, los de compuerta del Pipeline, el gestor de
 * etiquetas, el lightbox de una foto…).
 *
 * Es el hermano de `usePopover` para lo que NO tiene overlay propio: un modal
 * ya viene con su scrim. La decisión de qué cierra la toman los dos con la
 * MISMA función pura, así que no pueden divergir — que es exactamente lo que
 * había pasado: la copia del gestor de etiquetas se olvidó la guarda de campos
 * y Escape mientras se escribía una categoría cerraba el modal y tiraba lo
 * tipeado.
 *
 * ── `activo`: por qué existe ──
 * Este hook registra en CAPTURA sobre `window` y hace `stopPropagation()`. Eso
 * no es un detalle: es lo que le gana al listener del shell (`App.tsx`, en
 * burbuja) para que cerrar un popover no se lleve puesta la conversación de
 * atrás. **El precio es que un listener registrado de más apaga el Escape de
 * TODA la app**, y en silencio.
 *
 * Acá decía «solo se monta abierto (por eso acá no hay guarda de `abierto`)», y
 * era una promesa que nadie podía verificar. `ConsultaIvi` la rompió sin
 * quererlo: `App.tsx` la monta SIEMPRE y ella decide con `if (!abierta) return
 * null`, así que con la hoja de Ivi cerrada —o sea, casi todo el tiempo— este
 * listener existía igual y se comía el Escape. Dejaban de andar la tecla que
 * cierra la conversación en Mensajes, la que cierra la Cabina y la que cierra
 * la libreta: tres atajos documentados, rotos por un componente que no toca
 * ninguno de esos archivos.
 *
 * Por eso la condición dejó de ser un comentario y pasó a ser un argumento. Un
 * modal que se monta y desmonta con su apertura no pasa nada y sigue igual; uno
 * que vive montado pasa su `abierta` y el listener no existe mientras no le
 * corresponda.
 *
 * @param activo Si es `false`, no se registra NADA: el Escape sigue de largo
 *   hasta el shell, como si este componente no existiera.
 */
export function useEscape(onCerrar: () => void, activo = true) {
  useEffect(() => {
    if (!activo) return;
    const fn = (e: KeyboardEvent) => {
      const focoEnCampo = Boolean((e.target as HTMLElement | null)?.closest(SELECTOR_CAMPOS));
      const reaccion = reaccionDelPopover(e.key, focoEnCampo);
      if (reaccion.tipo !== 'cerrar') return;
      e.stopPropagation();
      onCerrar();
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [onCerrar, activo]);
}
