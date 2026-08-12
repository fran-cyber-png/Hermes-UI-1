/**
 * EL LIENZO — las reglas del tablero de cables, puras y sin DOM.
 *
 * Están acá y no adentro del componente por lo de siempre: lo que decide si dos
 * puertos se pueden unir, o qué cable corta un clic, se tiene que poder
 * interrogar sin montar React ni medir un `getBoundingClientRect`.
 */

/** Un nodo del lienzo: una campaña, un formulario, un producto o una vendedora. */
export interface NodoLienzo {
  id: string;
  titulo: string;
  /** La línea chica de abajo. */
  pie?: string;
  icono: 'producto' | 'campana' | 'formulario' | 'vendedora';
  /** Cuando existe, el nodo se puede ABRIR y el lienzo baja un nivel (fase 3). */
  entrar?: string;
  /** `pausada` se dibuja apagada; `activa` es la que decide algo mañana. */
  estado?: 'activa' | 'pausada' | 'desconocido';
}

/** Una columna del lienzo. El orden de las columnas ES la topología. */
export interface ColumnaLienzo {
  id: string;
  /** El rótulo de arriba. Vacío en la columna de una sola cosa. */
  titulo?: string;
  nodos: NodoLienzo[];
  /** Ancho en `rem`. Fijo: la posición no la elige el usuario, la elige el flujo. */
  ancho: number;
}

/**
 * Un cable.
 *
 * 🔴 **`pertenencia` y `regla` no son dos estilos: son dos cosas distintas.** La
 * pertenencia la decide el catálogo (qué campañas son de este producto) y no se
 * puede tocar; la regla la decide una persona y es lo único que se conecta y se
 * corta. Dibujarlas iguales haría creer que el catálogo se edita tirando de un
 * cable.
 */
export interface CableLienzo {
  de: string;
  a: string;
  tipo: 'regla' | 'pertenencia';
  /** Todavía no confirmado por el server. Se dibuja distinto — ver §pendiente. */
  pendiente?: boolean;
}

/** Dónde nace y dónde muere un cable: el puerto derecho de A y el izquierdo de B. */
export function claveDeCable(de: string, a: string): string {
  return `${de}→${a}`;
}

/**
 * ¿SE PUEDEN UNIR ESTOS DOS PUERTOS?
 *
 * 🔴 **Se decide por COLUMNA y no por nodo**, y no es un detalle: un cable solo
 * tiene sentido de una columna a la SIGUIENTE. Sin esta regla se podría unir un
 * producto directo con una vendedora salteando sus piezas — un cable que la
 * pantalla dibujaría y que el server no sabría guardar, porque la regla vive en
 * la pieza.
 *
 * ⚠️ Y se prohíbe explícitamente el mismo nodo consigo mismo y el sentido
 * inverso: arrastrar de derecha a izquierda es un gesto que la gente hace, y sin
 * la guarda se convierte en un cable al revés que nadie pidió.
 */
export function sePuedeUnir(
  columnas: readonly ColumnaLienzo[],
  de: string | null,
  a: string | null,
): boolean {
  if (!de || !a || de === a) return false;
  const iDe = columnas.findIndex((c) => c.nodos.some((n) => n.id === de));
  const iA = columnas.findIndex((c) => c.nodos.some((n) => n.id === a));
  return iDe >= 0 && iA === iDe + 1;
}

/**
 * QUÉ PASA AL SOLTAR SOBRE UN PUERTO: se crea el cable, o se corta el que ya
 * estaba. Un solo gesto para las dos cosas — arrastrar sobre algo ya conectado
 * es, en cualquier editor de nodos, deshacerlo.
 */
export function alSoltar(
  cables: readonly CableLienzo[],
  de: string,
  a: string,
): { accion: 'conectar' | 'cortar' } {
  const ya = cables.some((c) => c.tipo === 'regla' && c.de === de && c.a === a);
  return { accion: ya ? 'cortar' : 'conectar' };
}

/**
 * LOS CABLES DE REGLA QUE SALEN DE UN NODO. Es lo que el server necesita para
 * guardar: el conjunto COMPLETO de destinos de ese origen.
 *
 * ⚠️ Ordenado, porque el conjunto viaja al server y vuelve: sin orden estable,
 * cada guardado reordenaría los cables en pantalla sin que nada haya cambiado.
 */
export function destinosDe(cables: readonly CableLienzo[], de: string): string[] {
  return cables
    .filter((c) => c.tipo === 'regla' && c.de === de)
    .map((c) => c.a)
    .sort((x, y) => x.localeCompare(y, 'es'));
}

/**
 * APLICAR UN CAMBIO SOBRE EL CONJUNTO DE CABLES.
 *
 * Devuelve el conjunto nuevo, sin mutar. Es lo que hace que el cable aparezca en
 * el mismo cuadro que el gesto: la pantalla dibuja ESTO, no lo que contestó el
 * server.
 */
export function conCambio(
  cables: readonly CableLienzo[],
  de: string,
  a: string,
  accion: 'conectar' | 'cortar',
): CableLienzo[] {
  const sin = cables.filter((c) => !(c.tipo === 'regla' && c.de === de && c.a === a));
  return accion === 'cortar' ? sin : [...sin, { de, a, tipo: 'regla', pendiente: true }];
}

/**
 * LA CURVA. Bézier con las tangentes horizontales: así el cable se lee como un
 * cable y no como una diagonal.
 *
 * ⚠️ El tirón mínimo (28) existe para el caso de dos puertos casi pegados: sin
 * él la curva degenera en una recta y dos cables que van a destinos distintos se
 * superponen.
 */
export function curva(x1: number, y1: number, x2: number, y2: number): string {
  const tiron = Math.max(28, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + tiron} ${y1}, ${x2 - tiron} ${y2}, ${x2} ${y2}`;
}
