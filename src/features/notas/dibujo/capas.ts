import { CAPA_BASE, type Figura, duplicar, nuevoId } from './figuras';

/**
 * LAS CAPAS DE LA ANOTACIÓN.
 *
 * ══ QUÉ ES UNA CAPA ═════════════════════════════════════════════════════════
 *
 * Una etiqueta sobre un grupo de figuras, con tres perillas: **visible**,
 * **bloqueada** y **opacidad**. No es un canvas aparte — todo se sigue pintando
 * en el mismo. Un canvas por capa multiplicaría la memoria de una página larga
 * por la cantidad de capas, y la única ventaja sería no filtrar una lista que ya
 * se recorre entera.
 *
 * ══ EL ORDEN DE ESTE ARRAY ES EL ORDEN DE PINTADO ═══════════════════════════
 *
 * 🔴 Y eso cambió: antes las capas eran solo etiquetas y el orden lo decidía el
 * array de FIGURAS. Ahora manda la capa primero y la figura después, que es lo
 * que hace que arrastrar una capa arriba de otra se vea. `ordenarParaPintar` es
 * la única función que sabe combinar los dos ejes; con la combinación repartida,
 * el canvas y las miniaturas terminarían pintando en órdenes distintos.
 *
 * ⚠️ En el panel las capas se muestran AL REVÉS que en este array: arriba de la
 * lista está la que se pinta encima, que es la convención de todo editor
 * gráfico. La vuelta la da el panel, no este módulo — acá el índice 0 es el
 * fondo, como en el array de figuras.
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
  /** 0–1. Multiplica la de cada figura; ver `opacidadEfectiva`. */
  opacidad: number;
}

/** La capa donde cae todo mientras nadie cree otra. */
export const CAPAS_INICIALES: Capa[] = [
  { id: CAPA_BASE, nombre: 'Capa 1', visible: true, bloqueada: false, opacidad: 1 },
];

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
  return [
    ...capas,
    ...huerfanas.map((id, i) => ({
      id,
      nombre: `Capa ${capas.length + i + 1}`,
      visible: true,
      bloqueada: false,
      opacidad: 1,
    })),
  ];
}

function capaDe(capas: Capa[], capaId: string): Capa | undefined {
  return capas.find((c) => c.id === capaId);
}

/** ¿Esta capa deja ver sus figuras? Una capa que no está se considera visible. */
export function esVisible(capas: Capa[], capaId: string): boolean {
  return capaDe(capas, capaId)?.visible ?? true;
}

/** ¿Esta capa deja tocar sus figuras? */
export function esTocable(capas: Capa[], capaId: string): boolean {
  const capa = capaDe(capas, capaId);
  return capa ? capa.visible && !capa.bloqueada : true;
}

/**
 * LA OPACIDAD CON LA QUE SE PINTA UNA FIGURA: la suya por la de su capa.
 *
 * 🔴 Se MULTIPLICA y no se pisa. Un objeto al 50 % en una capa al 50 % se ve al
 * 25 %, y bajar la capa no le borra al objeto su propia transparencia: al subir
 * la capa de vuelta a 100, el objeto sigue en su 50 original. Pisar el valor
 * haría que mover el deslizador de la capa destruyera información que la
 * vendedora eligió a mano, sin forma de recuperarla.
 *
 * Por eso la opacidad de la capa **no se guarda en las figuras**: es una lente,
 * no una edición.
 */
export function opacidadEfectiva(f: Figura, capas: Capa[]): number {
  return f.opacidad * (capaDe(capas, f.capaId)?.opacidad ?? 1);
}

/**
 * LAS FIGURAS EN ORDEN DE PINTADO: por capa, y dentro de cada capa por su orden
 * en el array.
 *
 * Es la ÚNICA función que combina los dos ejes. El canvas y las miniaturas la
 * usan las dos; con la combinación escrita en cada lugar, arrastrar una capa
 * cambiaría el dibujo y no la miniatura, o al revés.
 *
 * Una figura de una capa desconocida va al final (encima de todo) en vez de
 * desaparecer: perder de vista un objeto es peor que pintarlo fuera de orden.
 */
export function ordenarParaPintar(figuras: Figura[], capas: Capa[]): Figura[] {
  const posicion = new Map(capas.map((c, i) => [c.id, i]));
  const dondeVa = (f: Figura) => posicion.get(f.capaId) ?? Number.MAX_SAFE_INTEGER;
  // `map`+`sort` sobre el índice: `Array.sort` es estable en todo motor moderno,
  // así que dentro de una capa se conserva el orden original sin desempatar.
  return [...figuras].sort((a, b) => dondeVa(a) - dondeVa(b));
}

/** Lo que se PINTA: todo lo de una capa visible, ya ordenado. */
export function visibles(figuras: Figura[], capas: Capa[]): Figura[] {
  return ordenarParaPintar(
    figuras.filter((f) => esVisible(capas, f.capaId)),
    capas,
  );
}

/**
 * Lo que se puede AGARRAR: lo visible y no bloqueado.
 *
 * 🔴 Es la única puerta. El clic, el borrador, el lazo y el ⌘A pasan por acá —
 * ver el docblock de arriba. Va ordenado igual que lo que se pinta, porque
 * «agarrar la de más arriba» tiene que coincidir con «la que se ve encima».
 */
export function seleccionables(figuras: Figura[], capas: Capa[]): Figura[] {
  return ordenarParaPintar(
    figuras.filter((f) => esTocable(capas, f.capaId)),
    capas,
  );
}

/** Las figuras de una capa, en su orden. Lo usan la miniatura y el contador. */
export function figurasDe(figuras: Figura[], capaId: string): Figura[] {
  return figuras.filter((f) => f.capaId === capaId);
}

/* ─────────────────────────── Administrar ───────────────────────────────── */

function nombreLibre(capas: Capa[]): string {
  // El número sale del conjunto USADO y no de un contador: con «Capa 3» ya
  // borrada, la siguiente vuelve a llamarse «Capa 3» y no salta a «Capa 7».
  const usados = new Set(capas.map((c) => c.nombre));
  let n = capas.length + 1;
  while (usados.has(`Capa ${n}`)) n++;
  return `Capa ${n}`;
}

function idDeCapa(): string {
  return `capa-${Date.now().toString(36)}-${nuevoId().slice(0, 6)}`;
}

/**
 * UNA CAPA NUEVA, **encima de la activa** y no al final de la lista.
 *
 * Es lo que se espera al apretar «+» con una capa elegida: la nueva aparece
 * justo arriba de donde se estaba trabajando. Mandarla siempre al tope obliga a
 * arrastrarla de vuelta cada vez que se quiere una intermedia.
 */
export function agregarCapa(capas: Capa[], encimaDe?: string): { capas: Capa[]; nueva: Capa } {
  const nueva: Capa = { id: idDeCapa(), nombre: nombreLibre(capas), visible: true, bloqueada: false, opacidad: 1 };
  const i = capas.findIndex((c) => c.id === encimaDe);
  if (i === -1) return { capas: [...capas, nueva], nueva };
  return { capas: [...capas.slice(0, i + 1), nueva, ...capas.slice(i + 1)], nueva };
}

export function cambiarCapa(capas: Capa[], id: string, cambios: Partial<Omit<Capa, 'id'>>): Capa[] {
  return capas.map((c) => (c.id === id ? { ...c, ...cambios } : c));
}

/**
 * MOVER UNA CAPA a otra posición del orden de pintado. `hacia` es el índice
 * destino **en el array** (0 = fondo), no en la lista que se ve.
 */
export function moverCapa(capas: Capa[], id: string, hacia: number): Capa[] {
  const desde = capas.findIndex((c) => c.id === id);
  if (desde === -1) return capas;
  const destino = Math.max(0, Math.min(capas.length - 1, hacia));
  if (desde === destino) return capas;

  const copia = [...capas];
  const [capa] = copia.splice(desde, 1);
  copia.splice(destino, 0, capa);
  return copia;
}

/**
 * DUPLICAR UNA CAPA: la capa y **copias independientes** de todo lo que tenía.
 *
 * Las copias llevan ids nuevos y NO se corren de lugar, al revés de duplicar
 * objetos sueltos: acá la copia va en otra capa, así que queda exactamente
 * encima del original y eso es justamente lo que se quiere para calcar y
 * retocar. Correrla obligaría a volver a alinearla a mano.
 */
export function duplicarCapa(
  capas: Capa[],
  figuras: Figura[],
  id: string,
): { capas: Capa[]; figuras: Figura[]; nueva: Capa } | null {
  const original = capaDe(capas, id);
  if (!original) return null;

  const nueva: Capa = { ...original, id: idDeCapa(), nombre: `${original.nombre} (copia)` };
  const i = capas.findIndex((c) => c.id === id);
  const copias = duplicar(figurasDe(figuras, id), 0).map((f) => ({ ...f, capaId: nueva.id }));

  return {
    capas: [...capas.slice(0, i + 1), nueva, ...capas.slice(i + 1)],
    figuras: [...figuras, ...copias],
    nueva,
  };
}

/**
 * BORRAR UNA CAPA. Devuelve las capas que quedan y **los ids de lo que se
 * lleva** — quien llama decide qué hacer con eso (el panel pregunta antes).
 *
 * La última no se puede borrar: sin ninguna, las figuras nuevas no tendrían
 * dónde caer.
 */
export function borrarCapa(
  capas: Capa[],
  figuras: Figura[],
  id: string,
): { capas: Capa[]; seLleva: string[]; activaNueva: string } | null {
  if (capas.length <= 1) return null;
  const quedan = capas.filter((c) => c.id !== id);
  return {
    capas: quedan,
    seLleva: figurasDe(figuras, id).map((f) => f.id),
    // La de al lado, no siempre la primera: al borrar la capa 4 de seis, se
    // queda parado en la 3 y no salta al fondo de la pila.
    activaNueva: (quedan[Math.max(0, capas.findIndex((c) => c.id === id) - 1)] ?? quedan[0]).id,
  };
}
