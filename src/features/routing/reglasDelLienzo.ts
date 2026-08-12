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
  /**
   * 🔴 **SE ABRE EN SU LUGAR, NO BAJA UN NIVEL — y eso corrige un defecto de
   * diseño, no un detalle.** La primera versión reemplazaba el lienzo entero por
   * el de adentro de la campaña, así que al abrirla **desaparecían el producto y
   * las campañas hermanas**: quedabas mirando tres columnas sin saber de qué
   * producto eran ni qué más le entra. El dueño lo dijo mirando la captura el
   * 12-ago-2026: *«no sale el producto atrás de todo, tiene que ser más fácil de
   * interactuar y vigilar todo»*.
   *
   * Con la apertura en el lugar, el contexto **nunca se pierde**: el producto
   * sigue a la cabeza, las hermanas siguen a la vista, y lo que se agrega es el
   * detalle de la que abriste.
   */
  abrible?: boolean;
  abierto?: boolean;
  /**
   * Lo que se ve adentro cuando está abierto.
   * ⚠️ Vacío significa TRES cosas distintas y hay que poder separarlas: ver
   * `Apertura` en `piezas.ts`.
   */
  adentro?: { id: string; titulo: string; pie: string }[];
  cargando?: boolean;
  fallo?: boolean;
  /**
   * 🔴 **DE DÓNDE PUEDE SALIR Y A DÓNDE PUEDE ENTRAR UN CABLE — Y ES DEL NODO,
   * NO DE LA COLUMNA.** Antes el puerto derecho se dibujaba en todo nodo que no
   * estuviera en la última columna y `sePuedeUnir` decía que sí a cualquier par
   * de columnas vecinas. Consecuencia medida el 12-ago-2026: **se podía tirar un
   * cable del producto a una de sus piezas, se dibujaba igual que uno de verdad,
   * y no salía ningún `PUT`** — `aplicar()` solo tiene rama para `campana:` y
   * `curso:`, así que el origen `prod:` caía al vacío sin error y sin log. La
   * pantalla afirmaba una regla que el server nunca vio.
   *
   * Con esto la conectabilidad se DECLARA donde se sabe (`piezas.ts`), y un nodo
   * nuevo nace sin puertos hasta que alguien decida que los tiene.
   */
  salida?: boolean;
  entrada?: boolean;
  /**
   * 🔴 **UN PUNTO DONDE EL CABLE ATERRIZA, SIN SER UN DESTINO CONECTABLE — y sin
   * esto el mapa se corta.** El cable de PERTENENCIA (producto → sus piezas) nace
   * en el puerto derecho del producto y muere en el izquierdo de la pieza; pero
   * la pieza no acepta cables de regla, así que al hacer los puertos declarativos
   * se quedó sin punto izquierdo y **el cable dejó de dibujarse entero**: el
   * producto aparecía suelto, sin nada que lo uniera a lo que le entra
   * (12-ago-2026, visto en captura).
   *
   * Es un ANCLA, no un puerto: se dibuja más chico, no es un botón y no recibe
   * el arrastre. La pertenencia la decide el catálogo, no un gesto — ofrecerla
   * como destino sería el cable fantasma otra vez.
   */
  anclaIzq?: boolean;
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
  /**
   * 🔴 **EL CABLE TOMA EL COLOR DE SU ORIGEN, y eso hace dos trabajos de una.**
   * Con todas las curvas del mismo navy, ni se sabe qué es cada nodo ni se puede
   * seguir un cable entre veintiocho que nacen y mueren en los mismos puntos —
   * las dos quejas del dueño el 12-ago-2026: *«se confunden los cables»* y
   * *«tener mapeado qué son campañas y qué son formularios»*.
   *
   * ⚠️ Es de la paleta `--cat-*` de la casa, la misma de las categorías. **Sin
   * oro**: el dorado significa tiempo que se acaba y acá no corre nada.
   */
  color?: 'campana' | 'formulario' | 'producto';
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
 * 🔴 **Lo decide LO QUE CADA NODO DECLARA, no dónde cayó.** La versión anterior
 * lo derivaba de la adyacencia de columnas y por eso habilitaba pares que nadie
 * sabía guardar — ver el comentario de `NodoLienzo.salida`. Un origen sin
 * `salida` no dibuja puerto y no une; un destino sin `entrada`, tampoco.
 *
 * ⚠️ Se prohíbe explícitamente el mismo nodo consigo mismo: arrastrar y soltar
 * en el lugar es un gesto que la gente hace sin querer.
 */
export function sePuedeUnir(
  columnas: readonly ColumnaLienzo[],
  de: string | null,
  a: string | null,
): boolean {
  if (!de || !a || de === a) return false;
  const nodos = columnas.flatMap((c) => c.nodos);
  return Boolean(
    nodos.find((n) => n.id === de)?.salida && nodos.find((n) => n.id === a)?.entrada,
  );
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
