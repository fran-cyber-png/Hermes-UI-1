import { CAPA_BASE, type Figura } from './figuras';

/**
 * LAS CAPAS DE LA ANOTACIÓN.
 *
 * ══ QUÉ ES UNA CAPA Y QUÉ NO ES ═════════════════════════════════════════════
 *
 * Una capa es una ETIQUETA sobre un grupo de figuras, con dos interruptores:
 * visible y bloqueada. **No es un canvas aparte** — todo se sigue pintando en
 * el mismo, en el orden del array. Un canvas por capa multiplicaría la memoria
 * de una página larga por la cantidad de capas, y la única ventaja sería no
 * tener que filtrar una lista que ya se recorre entera.
 *
 * El ORDEN DE PINTADO lo sigue decidiendo el array de figuras (`reordenar`), no
 * la capa. Son dos ejes distintos y conviene no mezclarlos: «traer al frente»
 * mueve una figura dentro de su lista; «mandar a otra capa» cambia si se ve o
 * si se puede tocar.
 *
 * ══ POR QUÉ «BLOQUEADA» ES UNA REGLA Y NO UN ESTILO ═════════════════════════
 *
 * 🔴 Una capa bloqueada tiene que quedar fuera de TODO lo que agarra figuras: el
 * clic, el borrador, el lazo y el ⌘A. Con la regla aplicada en un solo lugar
 * (`seleccionables`), agregar mañana otra forma de seleccionar no puede
 * olvidarse del bloqueo. Con la comprobación repartida por los cuatro
 * llamadores, basta que uno se la saltee para que «bloqueada» sea mentira.
 */

export interface Capa {
  id: string;
  nombre: string;
  visible: boolean;
  bloqueada: boolean;
}

/** La capa donde cae todo mientras nadie cree otra. */
export const CAPAS_INICIALES: Capa[] = [{ id: CAPA_BASE, nombre: 'Capa 1', visible: true, bloqueada: false }];

/**
 * Las capas que la página necesita: las declaradas más una por cada `capaId`
 * huérfano que traigan las figuras.
 *
 * Hace falta porque las capas viven en el estado de la sesión y las figuras en
 * la base: una página guardada con figuras en «Capa 2» y abierta después de que
 * esa capa se borró dejaría objetos invisibles e inalcanzables. Acá se rescatan.
 */
export function capasNecesarias(capas: Capa[], figuras: Figura[]): Capa[] {
  const conocidas = new Set(capas.map((c) => c.id));
  const huerfanas = [...new Set(figuras.map((f) => f.capaId))].filter((id) => !conocidas.has(id));
  return [...capas, ...huerfanas.map((id, i) => ({ id, nombre: `Capa ${capas.length + i + 1}`, visible: true, bloqueada: false }))];
}

/** ¿Esta capa deja ver sus figuras? Una capa que no está se considera visible. */
export function esVisible(capas: Capa[], capaId: string): boolean {
  return capas.find((c) => c.id === capaId)?.visible ?? true;
}

/** ¿Esta capa deja tocar sus figuras? */
export function esTocable(capas: Capa[], capaId: string): boolean {
  const capa = capas.find((c) => c.id === capaId);
  return capa ? capa.visible && !capa.bloqueada : true;
}

/** Lo que se PINTA: todo lo de una capa visible. */
export function visibles(figuras: Figura[], capas: Capa[]): Figura[] {
  return figuras.filter((f) => esVisible(capas, f.capaId));
}

/**
 * Lo que se puede AGARRAR: lo visible y no bloqueado.
 *
 * 🔴 Es la única puerta. El clic, el borrador, el lazo y el ⌘A pasan por acá —
 * ver el docblock de arriba.
 */
export function seleccionables(figuras: Figura[], capas: Capa[]): Figura[] {
  return figuras.filter((f) => esTocable(capas, f.capaId));
}

/** Una capa nueva, con nombre libre. */
export function agregarCapa(capas: Capa[]): Capa[] {
  // El número sale del tamaño y no de un contador: con «Capa 3» ya borrada, la
  // siguiente vuelve a llamarse «Capa 3» y no salta a «Capa 7».
  let n = capas.length + 1;
  const usados = new Set(capas.map((c) => c.nombre));
  while (usados.has(`Capa ${n}`)) n++;
  return [...capas, { id: `capa-${Date.now().toString(36)}-${n}`, nombre: `Capa ${n}`, visible: true, bloqueada: false }];
}

export function cambiarCapa(capas: Capa[], id: string, cambios: Partial<Omit<Capa, 'id'>>): Capa[] {
  return capas.map((c) => (c.id === id ? { ...c, ...cambios } : c));
}

/**
 * BORRAR UNA CAPA devuelve las capas que quedan y a dónde va lo que tenía.
 *
 * Sus figuras **no se borran**: se mudan a la primera capa que quede. Borrar una
 * capa por error no puede llevarse el trabajo de una hora, y «se perdieron los
 * dibujos» es un daño mucho peor que «aparecieron en otra capa».
 *
 * La última capa no se puede borrar: sin ninguna, las figuras nuevas no tendrían
 * dónde caer.
 */
export function borrarCapa(capas: Capa[], id: string): { capas: Capa[]; mudarA: string } | null {
  if (capas.length <= 1) return null;
  const quedan = capas.filter((c) => c.id !== id);
  return { capas: quedan, mudarA: quedan[0].id };
}
