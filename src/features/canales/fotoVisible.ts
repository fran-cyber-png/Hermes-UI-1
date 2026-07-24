/**
 * LA LÓGICA PURA detrás de qué filas de la cola piden foto de perfil —
 * separada del `IntersectionObserver` que la dispara (ese es DOM y vive en el
 * hook de `FilaConversacion.tsx`; el entorno de test del front es `node`, sin
 * DOM, así que lo testeable se extrae hasta acá).
 *
 * Guardarraíl anti-ban (decisión de #59): la cola puede tener ~1300 filas —
 * pedirle a WhatsApp la foto de cada una de un saque es tocarle la puerta 1300
 * veces seguidas: rate-limit y riesgo de baneo del número vinculado. Por eso
 * `conFoto` se prende SOLO donde la vendedora realmente puede ver algo: las
 * primeras N filas (para no esperar al observer en el primer pintado, que
 * dejaría un parpadeo iniciales→foto) más lo que vaya entrando al viewport al
 * scrollear. Es sticky: una vez que una fila pidió la foto, se queda pedida —
 * no se apaga al volver a salir del viewport (si no, cada ida y vuelta del
 * scroll repetiría el fetch contra `/api/whatsapp/foto/:telefono`).
 */

/** Cuántas filas piden foto apenas se pinta la lista, sin esperar al scroll. */
export const FILAS_PRIORITARIAS_CON_FOTO = 12;

/** ¿Esta fila entra en el lote prioritario por su posición en la lista? */
export function esPrioritaria(indice: number | undefined, n = FILAS_PRIORITARIAS_CON_FOTO): boolean {
  return indice != null && indice < n;
}

/**
 * ¿Este canal tiene foto de perfil para pedir? Solo WhatsApp la tiene — FB/IG
 * no exponen ese dato por esta vía. Antes vivía inline en el JSX de
 * `FilaConversacion` (`conFoto && c.canal === 'whatsapp'`); acá es pura y
 * gatea el propio observer, así las filas de FB/IG ni lo instancian.
 */
export function quiereFoto(canal: string): boolean {
  return canal === 'whatsapp';
}

/**
 * Reduce un lote de entradas del observer (con solo lo que importa de
 * `IntersectionObserverEntry`) al siguiente estado de `conFoto`. Sticky: si ya
 * estaba prendida, ningún lote posterior la apaga.
 */
export function siguienteConFoto(actual: boolean, entradas: { isIntersecting: boolean }[]): boolean {
  if (actual) return true;
  return entradas.some((e) => e.isIntersecting);
}
