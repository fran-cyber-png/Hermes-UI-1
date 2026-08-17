import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CajaDeTexto, Comun } from './figuras';

/**
 * UNA CAJA DE TEXTO FLOTANTE — texto de verdad encima del documento.
 *
 * ══ POR QUÉ ES DOM Y NO CANVAS ══════════════════════════════════════════════
 *
 * Es el único objeto de la capa que no se pinta. Tiene que seguir siendo TEXTO:
 * cursor que parpadea, caracteres que se seleccionan con el mouse, ⌘A adentro de
 * la caja, ⌘C/⌘V de texto, y **word-wrap** al angostarla. Nada de eso existe en
 * un canvas sin reimplementar un editor entero.
 *
 * Vive `absolute` adentro del MISMO contenedor que el canvas, así que comparte
 * sistema de coordenadas: scrollea con el documento igual que un trazo, sin una
 * línea de código de scroll.
 *
 * ⚠️ **Consecuencia honesta:** al ser un elemento del DOM sobre el canvas, una
 * caja de texto siempre se ve POR ENCIMA de los trazos, sin importar el orden de
 * capas. Mandarla atrás la deja igual arriba. Arreglarlo exige partir el canvas
 * en dos (lo de abajo y lo de arriba de cada caja), y no vale la complejidad
 * mientras nadie lo pida.
 *
 * ══ LOS DOS MODOS, Y POR QUÉ NO SE PUEDEN CONFUNDIR ═════════════════════════
 *
 * 🔴 **Editando** el `contenteditable` está activo y el teclado es de la caja:
 * ⌘A selecciona SU texto, Suprimir borra caracteres. **Como objeto** está
 * apagado (`contentEditable={false}`) y el teclado es de la capa: ⌘A selecciona
 * todas las figuras, Suprimir borra la caja entera.
 *
 * Sin esa separación, escribir «REVISAR» y apretar ⌘A borraría el dibujo entero
 * en vez de seleccionar la palabra. El interruptor es una sola prop y por eso no
 * se puede desincronizar.
 */

/** Cuánto respira el texto adentro de su caja. */
const RELLENO = 4;

export function CajaFlotante({
  figura,
  editando,
  elegida,
  interactiva,
  onTexto,
  onAlto,
  onEmpezarAEditar,
  onTerminarDeEditar,
  onPointerDown,
}: {
  figura: CajaDeTexto & Comun;
  editando: boolean;
  elegida: boolean;
  /** Con la capa en modo texto, la caja no recibe ni un clic. */
  interactiva: boolean;
  onTexto(texto: string): void;
  /** Avisa el alto medido para que la selección y el grupo lo sepan. */
  onAlto(alto: number): void;
  onEmpezarAEditar(): void;
  onTerminarDeEditar(): void;
  onPointerDown(e: React.PointerEvent): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /**
   * LEER Y ESCRIBIR EL TEXTO DE UN `contenteditable`.
   *
   * Se ESCRIBE con `textContent` y se LEE con `innerText` cuando existe:
   *
   *  · Al escribir, `textContent` deja un solo nodo de texto con los `\n`
   *    adentro, y el `white-space: pre-wrap` los pinta como saltos. Es la forma
   *    más simple y la que sobrevive a cualquier motor.
   *  · Al leer hace falta `innerText`, porque el navegador inserta `<div>` y
   *    `<br>` propios cuando la persona aprieta Enter, y `textContent` los pegaría
   *    todos en una línea. Cae a `textContent` donde `innerText` no exista
   *    (jsdom no lo implementa), que es exactamente el caso en que tampoco hay
   *    esos nodos de por medio.
   */
  const leerTexto = (el: HTMLElement) => (typeof el.innerText === 'string' ? el.innerText : (el.textContent ?? ''));

  /**
   * El texto se escribe en el DOM UNA vez y después manda el navegador.
   *
   * 🔴 Un `contenteditable` controlado por React es la receta del cursor que
   * salta al principio en cada tecla: React reemplaza el nodo de texto y el
   * caret se pierde. Se sincroniza en un solo sentido —del DOM al estado— y solo
   * se escribe de vuelta cuando el contenido cambió por AFUERA (deshacer, pegar
   * una copia), que es cuando el caret no importa.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && leerTexto(el) !== figura.texto) el.textContent = figura.texto;
  }, [figura.texto]);

  /** Al entrar en edición: foco y caret al final, listo para escribir. */
  useEffect(() => {
    const el = ref.current;
    if (!editando || !el) return;
    el.focus();
    const rango = document.createRange();
    rango.selectNodeContents(el);
    rango.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(rango);
  }, [editando]);

  /**
   * El alto lo decide el CONTENIDO, y se avisa hacia arriba.
   *
   * Es lo que hace que angostar la caja la haga más alta sola (word-wrap) y que
   * el recuadro de selección la envuelva bien. Se mide después de pintar, con
   * `useLayoutEffect`, o el primer recuadro sale con el alto anterior.
   */
  useLayoutEffect(() => {
    const alto = ref.current?.offsetHeight;
    // `> 0` y no solo «distinto»: en un entorno SIN layout (jsdom, y el primer
    // cuadro antes de que la fuente cargue) `offsetHeight` es 0, y guardar ese
    // cero aplastaría el alto real de una caja que en pantalla se ve entera.
    if (alto && alto > 0 && Math.abs(alto - figura.alto) > 1) onAlto(alto);
  }, [figura.texto, figura.ancho, figura.tamano, figura.fuente, figura.negrita, figura.alto, onAlto]);

  return (
    <div
      ref={ref}
      // 🔴 El interruptor de los dos modos. Ver el docblock.
      contentEditable={editando}
      suppressContentEditableWarning
      spellCheck={false}
      data-caja-flotante={figura.id}
      role="textbox"
      aria-multiline
      aria-label={`Anotación de texto: ${figura.texto.slice(0, 40) || 'vacía'}`}
      onPointerDown={(e) => {
        // Editando, el puntero es para poner el caret y seleccionar palabras: no
        // puede llegar a la capa, que lo tomaría como el arrastre de un objeto.
        if (editando) {
          e.stopPropagation();
          return;
        }
        onPointerDown(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEmpezarAEditar();
      }}
      onInput={(e) => onTexto(leerTexto(e.currentTarget as HTMLDivElement))}
      onBlur={() => editando && onTerminarDeEditar()}
      onKeyDown={(e) => {
        if (!editando) return;
        /**
         * 🔴 NADA DE LO QUE SE TECLEA ADENTRO SALE. Sin esto, la Enter parte la
         * página del editor en dos, ⌘A selecciona todas las figuras y Suprimir
         * borra la caja mientras se la está escribiendo.
         */
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onTerminarDeEditar();
        }
      }}
      // El teclado tampoco sube al pegar: pegar texto adentro de una caja no
      // puede terminar insertando una imagen en la capa.
      onPaste={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: figura.x,
        top: figura.y,
        width: figura.ancho,
        padding: RELLENO,
        // Sin fondo y sin borde: el texto se apoya directo sobre el documento.
        // Editando aparece un punteado, que es lo único que dice «esto está vivo».
        background: 'transparent',
        border: editando ? '1px dashed var(--color-primary, #3b82f6)' : '1px solid transparent',
        outline: 'none',
        color: figura.color,
        opacity: figura.opacidad,
        fontFamily: figura.fuente,
        fontSize: figura.tamano,
        fontWeight: figura.negrita ? 700 : 400,
        fontStyle: figura.cursiva ? 'italic' : 'normal',
        textDecoration: figura.subrayado ? 'underline' : 'none',
        textAlign: figura.alineacion,
        lineHeight: 1.3,
        // `break-word` es lo que produce el word-wrap al angostar la caja, y
        // `pre-wrap` conserva los saltos que la persona escribió.
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        cursor: editando ? 'text' : 'move',
        // Con la capa en reposo la caja no existe para el puntero: el clic tiene
        // que llegar al editor de texto que hay debajo.
        pointerEvents: interactiva ? 'auto' : 'none',
        // Por encima del canvas, pero por debajo de sus adornos y del aviso.
        zIndex: 11,
        // El recuadro de selección lo dibuja el canvas; acá solo se resalta el
        // contorno para que se vea qué caja está agarrada aunque el recuadro
        // quede fuera de la vista.
        boxShadow: elegida && !editando ? '0 0 0 1px var(--color-primary, #3b82f6)' : undefined,
      }}
    />
  );
}
