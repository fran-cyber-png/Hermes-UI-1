/**
 * DE QUÉ PIEZA SALIÓ LO QUE HAY EN LA CAJA (épica #169, frente 1).
 *
 * El bloque de datos recomendados (#153) y las dos respuestas del panel **no
 * envían**: dejan el texto en el composer y la vendedora manda (la regla de
 * #45). Esa distinción es deliberada y no se toca — pero deja al server ciego:
 * lo que le llega es un `POST /api/whatsapp/enviar` con un texto, idéntico al
 * que ella habría escrito de cero. Sin este módulo, **ninguna de las dos
 * superficies del panel se podría medir nunca**.
 *
 * Vive a nivel de MÓDULO, como `borradorComposer` y por el mismo motivo:
 * sobrevive a que React reuse o desmonte componentes, porque no depende de ellos.
 *
 * ══ LA REGLA DE «ESTO TODAVÍA ES LA PIEZA» ═══════════════════════════════════
 *
 * Es pura y tiene tres respuestas, no dos:
 *
 *   · el texto es EXACTAMENTE el de la pieza      → la pieza, sin editar;
 *   · el texto de la pieza sigue adentro          → la pieza, **editada**
 *     (le agregó un saludo, le sacó una línea: sigue siendo trazable, pero el
 *     resultado no se le puede acreditar entero — son también palabras de ella);
 *   · no queda nada de la pieza                   → **no hay pieza**, y eso es
 *     la línea de base, que es un dato y no un hueco.
 *
 * Ante la duda va a la línea de base. Perder una atribución es barato;
 * inventarla es el error que este trabajo existe para no cometer.
 */

/**
 * LAS CLASES DE PIEZA que esta pantalla puede declarar.
 *
 * Es una **copia a mano** del vocabulario del server (`server/src/piezas/direccion.ts`)
 * porque el front no importa código del server — el mismo problema que ya tienen
 * los seis momentos en `features/hechos/hechos.ts`. La copia no puede driftear en
 * silencio: `procedencia/frontComparteVocabulario.test.ts` lee ESTE archivo y
 * falla si alguna de estas clases no existe del otro lado.
 *
 * Y son estas dos y no `paso`/`dato`: el catálogo que Ivi consulta publica
 * `plantilla` y `hecho`, así que si acá se declarara otra cosa, el join entre lo
 * que Ivi recomienda y lo que quedó en `envios_wa` daría **cero filas, en
 * silencio** — que se lee como «esa pieza no se usó nunca».
 */
export const CLASES_DECLARABLES = ['plantilla', 'hecho'] as const;

/** La forma en que la pieza viaja al server (el contrato de `POST /enviar`). */
export interface PiezaDeclarada {
  clase: (typeof CLASES_DECLARABLES)[number];
  /**
   * La identidad dentro de su clase. Para una `plantilla` lleva el paso pegado
   * con `#` (`12#3`): el paso se direcciona DENTRO de su secuencia porque
   * `plantilla_pasos.id` no es estable.
   */
  ref: string;
  via: 'panel-sugerencia' | 'panel-datos';
  editada: boolean;
  /**
   * EL TEXTO DE LA PIEZA — el que la pantalla dejó en la caja, **sin** las
   * ediciones de la vendedora. Con esto el server calcula la versión (#169):
   * mejorar una frase tiene que poder verse, y sin versión los dos textos se
   * suman en un promedio que esconde el cambio.
   *
   * Viaja el texto y no un hash **a propósito**: hashear en el navegador
   * significaría que dos clientes con distinta normalización parten en dos la
   * historia de una pieza sin que nadie lo note. El hash se hace en un solo
   * lugar, en el server.
   */
  textoPieza: string;
}

/** Lo que se dejó en la caja: la pieza y el texto con el que llegó. */
interface Anotacion {
  pieza: Omit<PiezaDeclarada, 'editada' | 'textoPieza'>;
  textoOriginal: string;
}

const anotaciones = new Map<string, Anotacion>();

/**
 * Anota que este texto salió de esta pieza. La llama el puente al composer, no
 * los componentes: así una superficie nueva que ponga texto en la caja sin
 * declarar de dónde salió cae sola en la línea de base, en vez de heredar la
 * pieza anterior.
 */
export function anotarPieza(
  telefono: string,
  pieza: Omit<PiezaDeclarada, 'editada' | 'textoPieza'>,
  texto: string,
): void {
  anotaciones.set(telefono, { pieza, textoOriginal: texto });
}

/** Se olvida de la pieza de esa conversación (tras mandar, o al escribir de cero). */
export function olvidarPieza(telefono: string): void {
  anotaciones.delete(telefono);
}

/**
 * Qué pieza declarar para el texto que está por salir. `undefined` = escrito a
 * mano, **que es la línea de base y por eso no lleva campo**: mandar
 * `{clase: null}` sería decirle al server «no sé», y sí sabemos.
 */
export function piezaDelTexto(telefono: string, textoActual: string): PiezaDeclarada | undefined {
  const anotada = anotaciones.get(telefono);
  if (!anotada) return undefined;

  const actual = textoActual.trim();
  const original = anotada.textoOriginal.trim();
  if (!original) return undefined;

  // `textoPieza` es SIEMPRE el original, nunca lo que ella escribió: la versión
  // habla de la pieza del catálogo, no del mensaje que salió.
  const declarar = (editada: boolean): PiezaDeclarada => ({
    ...anotada.pieza,
    editada,
    textoPieza: anotada.textoOriginal,
  });

  if (actual === original) return declarar(false);
  if (actual.includes(original)) return declarar(true);

  // Ya no queda nada de la pieza: lo que va a salir es de ella.
  return undefined;
}

/** Solo para tests: deja el registro vacío. */
export function limpiarPiezas(): void {
  anotaciones.clear();
}
