/**
 * EL CONTRATO DE CIERRE — qué hace un Escape y a quién le pertenece. Sin DOM, sin React.
 *
 * ── Por qué existe ──
 * El shell (`App.tsx`) escucha `keydown` en BURBUJA y se adueña del Escape: cierra
 * la libreta, después la cabina, y en Mensajes cierra la conversación abierta. Un
 * popover que quiera cerrarse a sí mismo sin arrastrar la conversación de atrás
 * tiene que ganarle: escuchar en CAPTURA (que siempre corre antes que la burbuja,
 * por el DOM, no por suerte) y cortar el evento ahí mismo.
 *
 * Ese acuerdo estaba copiado a mano en nueve componentes y ya había divergido: dos
 * escuchaban en burbuja sin cortar —cerraban el popover Y la conversación—, tres no
 * escuchaban Escape en absoluto, y la copia del gestor de etiquetas se olvidó la
 * guarda de campos, así que Escape mientras se escribía el nombre de una etiqueta
 * cerraba el modal entero y se llevaba lo tipeado.
 *
 * Acá vive la decisión; el IO (registrar el listener, mirar el foco) vive en
 * `usePopover.ts` y `useEscape.ts`, que son cascarones sobre esto.
 */

/**
 * Dónde el teclado es del campo y no de los atajos. Es el selector ÚNICO de la app:
 * el shell lo usa para su guarda global y los popovers para la suya. Vivían dos
 * versiones —la del shell incluía `[contenteditable]`, la del hook no—, lo que
 * significaba que la misma tecla en el mismo lugar se juzgaba distinto según quién
 * la escuchara.
 */
export const SELECTOR_CAMPOS = 'input, textarea, select, [contenteditable]';

/**
 * `frenarPropagacion` no es un detalle de implementación: es LA razón de que el
 * listener vaya en captura. Sin eso, el mismo Escape sigue viaje hasta el shell y
 * cierra también lo que había detrás.
 */
export type ReaccionAlTeclado = { tipo: 'ignorar' } | { tipo: 'cerrar'; frenarPropagacion: true };

const IGNORAR: ReaccionAlTeclado = { tipo: 'ignorar' };

/**
 * ¿Este keydown cierra el popover?
 *
 * Con el foco en un campo, Escape es del campo —abandonar la edición, cerrar el
 * autocompletado del navegador—, nunca del panel que lo contiene: la vendedora que
 * escribe el nombre de una etiqueta y aprieta Escape espera perder la palabra, no
 * el formulario.
 */
export function reaccionDelPopover(tecla: string, focoEnCampo: boolean): ReaccionAlTeclado {
  if (tecla !== 'Escape') return IGNORAR;
  if (focoEnCampo) return IGNORAR;
  return { tipo: 'cerrar', frenarPropagacion: true };
}
