import type { BlockNoteEditor } from '@blocknote/core';

/**
 * LOS CONTROLES DE «VISTA» — y por qué el estado vive en el DOM.
 *
 * ══ 🔴 EL PAPEL ES LA FUENTE DE VERDAD, NO UN `useState` ═══════════════════
 *
 * Zoom, ancho y modo lectura se **leen del elemento** en cada render, en vez de
 * guardarse en un estado de React. El motivo es concreto: la pestaña «Vista»
 * **se desmonta** apenas alguien vuelve a «Inicio» (sólo se monta la activa, que
 * es lo que pediste). Con `useState` adentro, el zoom seguiría aplicado en el
 * papel y el botón volvería a decir «100 %» — el clásico control que afirma una
 * cosa mientras la pantalla muestra otra.
 *
 * Es el mismo criterio por el que los selectores de fuente y tamaño leen
 * `useActiveStyles()` y no un estado propio.
 *
 * ⚠️ **Lo que eso cuesta, dicho**: al cambiar de página el editor se remonta con
 * `key` y el elemento es otro, así que el zoom y el ancho vuelven a su valor
 * normal. Es defendible —son ajustes de cómo mirás ESTA página— y es reversible
 * el día que se decida guardarlos.
 */

type Editor = BlockNoteEditor<any, any, any>;

/** Los escalones. No se suma un porcentaje fijo: los saltos útiles no son parejos. */
export const ZOOMS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 2] as const;
export const ZOOM_NORMAL = 1;

export function leerZoom(editor: Editor): number {
  const v = Number.parseFloat(editor.domElement?.style.zoom ?? '');
  return Number.isFinite(v) && v > 0 ? v : ZOOM_NORMAL;
}

/**
 * El escalón siguiente. `null` = ya está en el extremo, y ahí el botón se apaga:
 * un «Acercar» que no acerca más se lee como que está roto.
 */
export function siguienteZoom(actual: number, direccion: 1 | -1): number | null {
  const lista = direccion === 1 ? ZOOMS : [...ZOOMS].reverse();
  return lista.find((z) => (direccion === 1 ? z > actual : z < actual)) ?? null;
}

/**
 * ⚠️ **`zoom` y no `transform: scale()`.** El `transform` escala el dibujo pero
 * NO el layout: el cursor de texto queda desfasado del carácter que está
 * marcando, y arrastrar para seleccionar agarra otra cosa. `zoom` sí rehace el
 * layout, y hoy lo soportan los tres navegadores además de WKWebView.
 */
export function ponerZoom(editor: Editor, valor: number) {
  const papel = editor.domElement;
  if (!papel) return;
  papel.style.zoom = valor === ZOOM_NORMAL ? '' : String(valor);
}

/**
 * EL ANCHO. Va como atributo y la regla vive en `index.css`, al lado de la que
 * fija los `48rem`: con un `style.maxWidth` inline habría dos lugares diciendo
 * cuánto mide la columna de escritura, y el inline le gana al CSS sin que el CSS
 * se entere.
 */
export function anchoCompleto(editor: Editor): boolean {
  return editor.domElement?.getAttribute('data-ancho') === 'completo';
}

export function ponerAncho(editor: Editor, completo: boolean) {
  const papel = editor.domElement;
  if (!papel) return;
  if (completo) papel.setAttribute('data-ancho', 'completo');
  else papel.removeAttribute('data-ancho');
}

/**
 * LA ORTOGRAFÍA es el corrector del navegador, no uno nuestro.
 *
 * ⚠️ **Arranca encendida porque un `contenteditable` la trae encendida**, así
 * que el estado es «¿alguien la apagó?» y no «¿alguien la prendió?».
 *
 * ⚠️ Y el navegador **no siempre re-subraya lo ya escrito al volver a
 * prenderla**: repinta a medida que se edita. Prometer que el texto viejo se
 * revisa solo sería prometer algo que depende del navegador.
 */
export function ortografiaEncendida(editor: Editor): boolean {
  return editor.domElement?.getAttribute('spellcheck') !== 'false';
}

export function ponerOrtografia(editor: Editor, encendida: boolean) {
  editor.domElement?.setAttribute('spellcheck', String(encendida));
}

/**
 * EL TEXTO QUE HAY ESCRITO, tal como lo tiene ProseMirror.
 *
 * 🔴 **No es un recorrido nuestro del `doc`**, y eso es a propósito: el que
 * camina el `doc` es `aTextoPlano`, y vive en el server. Ver `contarTexto.ts`.
 */
export function textoDelPapel(editor: Editor): string {
  const doc = editor.prosemirrorState.doc;
  return doc.textBetween(0, doc.content.size, '\n');
}
