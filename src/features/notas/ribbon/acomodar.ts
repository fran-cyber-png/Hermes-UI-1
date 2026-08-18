import type { ModoRibbon } from './RibbonBoton';

/**
 * QUÉ ENTRA EN EL ANCHO QUE HAY — puro, con la medición afuera.
 *
 * ══ POR QUÉ PURO, Y POR QUÉ ESTE MOLDE ═════════════════════════════════════
 *
 * Es el mismo patrón de `fuentesInstaladas(candidatas, medidor)`: la REGLA se
 * testea, el `offsetWidth` queda del otro lado del borde. Y acá el motivo es más
 * fuerte que la prolijidad — **jsdom no hace layout**, así que un test de DOM ve
 * todos los anchos en cero y le da lo mismo cualquier implementación. Si la
 * decisión viviera adentro del componente, no habría forma de discutirla.
 *
 * Es la lección de ADR 0024, y de la captura que encontró el `order: -1` cuando
 * los tests estaban en verde.
 *
 * ══ LOS CUATRO ESCALONES, EN ORDEN ═════════════════════════════════════════
 *
 *   1. se achica el aire entre grupos          → `modoPara()`
 *   2. se van los rótulos de los BOTONES       → `modoPara()`
 *   3. los grupos secundarios caen a «Más»     → `acomodar()`
 *   4. los primarios NO se van nunca           → `acomodar()`
 *
 * El rótulo del GRUPO no está en la lista a propósito: es lo que hace
 * descubrible la Ribbon, y sin él volvemos a la fila de íconos indistintos que
 * este frente vino a reemplazar.
 *
 * ══ 🔴 POR QUÉ ESTO NO OSCILA ══════════════════════════════════════════════
 *
 * El bucle clásico de una barra que se auto-acomoda es: escondo un grupo → ahora
 * entra → lo muestro → ya no entra → lo escondo. Acá no puede pasar, y no por
 * una histéresis puesta a mano: **la decisión no depende de lo que hoy se ve**.
 * Depende de `disponible` (el ancho del contenedor, que no cambia por esconder
 * nada) y de los anchos NATURALES de cada grupo, que se miden una vez y se
 * guardan. Dos entradas estables ⇒ una salida estable.
 *
 * Por eso `ancho` puede venir `undefined` —un grupo que todavía nadie midió— y
 * la respuesta es **mostrarlo**: así se dibuja, se mide, y la pasada siguiente ya
 * decide con el dato. Degrada hacia mostrar de más, nunca de menos.
 */

export interface GrupoMedido {
  id: string;
  prioridad: 1 | 2;
  /** Lo que mide cuando se dibuja entero. `undefined` = todavía no se midió. */
  ancho?: number;
}

export interface Acomodo {
  visibles: string[];
  /** Los que caen al desplegable «Más», en el orden en que estaban. */
  enOverflow: string[];
}

/**
 * A PARTIR DE ACÁ LA BARRA SE DIBUJA COMPACTA: menos aire entre grupos y sin los
 * rótulos de los botones grandes (que igual conservan su `aria-label` y su
 * tooltip, así que no se pierde información, se pierde tinta).
 *
 * ⚠️ **1.180 px no es un número lindo: es el ancho al que la pestaña «Inicio»
 * deja de entrar entera en el panel de escritura.** Es un umbral de ESTA barra,
 * no un breakpoint de la app — por eso vive acá y no en `index.css`, donde se
 * leería como una talla de pantalla y alguien lo reusaría para otra cosa.
 */
export const ANCHO_COMPACTO = 1180;

export function modoPara(disponible: number): ModoRibbon {
  // Sin medida todavía (jsdom, o el primer render antes del layout) se asume
  // holgado: dibujar compacto de arranque haría un parpadeo en toda pantalla
  // grande, que es el caso normal.
  if (disponible <= 0) return 'completo';
  return disponible < ANCHO_COMPACTO ? 'compacto' : 'completo';
}

/**
 * Cuánto ocupa el botón «Más» con su grupo: los 30 px del botón (el tamaño de
 * los del paquete) más los 20 del `px-2.5` del grupo y su borde. **Se reserva de
 * más a propósito**: pasarse deja unos píxeles sin usar, quedarse corto hace que
 * se esconda un grupo y la fila SIGA sin entrar — o sea, el arreglo que no
 * arregla. En compacto el grupo mide menos, y ahí también sobra.
 */
export const ANCHO_DEL_MAS = 52;

export function acomodar(
  disponible: number,
  grupos: GrupoMedido[],
  anchoDelMas = ANCHO_DEL_MAS,
): Acomodo {
  const todos = grupos.map((g) => g.id);

  // Sin ancho de contenedor no hay nada que decidir. Es el caso de jsdom y el
  // del primer render: se muestra todo, que es lo que había antes de medir.
  if (disponible <= 0) return { visibles: todos, enOverflow: [] };

  // Un grupo sin medir se muestra para que se pueda medir. Ver el docblock.
  if (grupos.some((g) => g.ancho === undefined)) return { visibles: todos, enOverflow: [] };

  const ancho = (id: string) => grupos.find((g) => g.id === id)!.ancho!;
  const suma = (ids: string[]) => ids.reduce((t, id) => t + ancho(id), 0);

  if (suma(todos) <= disponible) return { visibles: todos, enOverflow: [] };

  // Se sacan los SECUNDARIOS y desde el final: los primeros de la fila son los
  // que la vendedora ya aprendió dónde están.
  const sacables = grupos.filter((g) => g.prioridad === 2).map((g) => g.id).reverse();

  let visibles = todos;
  const enOverflow: string[] = [];

  for (const id of sacables) {
    if (suma(visibles) + (enOverflow.length > 0 ? anchoDelMas : 0) <= disponible) break;
    // ⚠️ Sacar el PRIMERO cuesta el botón «Más», así que puede no ayudar: un
    // grupo de 40 px que se va y deja un botón de 46 empeora la cuenta. Ahí se
    // deja donde está — el que no ayuda no se saca.
    const despues = suma(visibles.filter((v) => v !== id)) + anchoDelMas;
    const antes = suma(visibles) + (enOverflow.length > 0 ? anchoDelMas : 0);
    if (despues >= antes) continue;
    visibles = visibles.filter((v) => v !== id);
    enOverflow.push(id);
  }

  // 🔴 Los primarios NO se sacan aunque siga sin entrar. En «Inicio» son Fuente
  // y Párrafo: una Ribbon sin negrita ni viñetas no es una barra angosta, es una
  // barra rota. Si a ese ancho todavía no entran, se corta lo que sobresale — es
  // el último recurso y afecta a lo secundario, no a lo que se usa.
  return { visibles, enOverflow: enOverflow.sort((a, b) => todos.indexOf(a) - todos.indexOf(b)) };
}
