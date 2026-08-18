import type { BlockNoteEditor } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { cambioDeFormato, type Estilos, type FormatoEnElPincel } from './copiarFormato';
import { leerTamano, siguienteTamano } from './tamanos';

/**
 * LOS COMANDOS DE LA RIBBON — el adaptador sobre el editor.
 *
 * ══ QUÉ ENTRA ACÁ Y QUÉ NO ═════════════════════════════════════════════════
 *
 * 🔴 **Si BlockNote ya trae el componente, se usa el componente y este archivo
 * no lo menciona.** Negrita, color, alineación, sangría, enlace y tipo de bloque
 * llegan con su estado activo, su tooltip y su locale `es` resueltos; escribir
 * acá un `alternarNegrita()` sería una segunda implementación de algo que ya
 * anda, y la que se olvidaría de actualizarse (#37).
 *
 * Lo que sí vive acá es lo que el paquete NO tiene: deshacer/rehacer, insertar
 * un bloque desde un botón, el paso de tamaño, limpiar formato, el pincel y los
 * controles de Vista.
 *
 * ══ INSERTAR REUSA LA MISMA FUNCIÓN QUE EL MENÚ DE `/` ═════════════════════
 *
 * `insertOrUpdateBlockForSlashMenu` es lo que corre cuando alguien escribe
 * `/tabla`. Decide una cosa que no es obvia y que a mano se hace mal: **si el
 * bloque donde está el cursor está vacío, lo CONVIERTE en vez de insertar uno
 * nuevo debajo**. Sin eso, insertar una tabla en una página en blanco deja un
 * párrafo vacío colgando arriba. Y además deja el cursor adentro de lo insertado.
 *
 * Que el botón y el `/` hagan exactamente lo mismo no es prolijidad: son dos
 * puertas al mismo bloque, y dos puertas que hacen cosas distintas es #37.
 */

type Editor = BlockNoteEditor<any, any, any>;

export interface ComandosDelEditor {
  deshacer: () => void;
  rehacer: () => void;
  cortar: () => void;
  copiar: () => void;
  aumentarTamano: () => void;
  reducirTamano: () => void;
  limpiarFormato: () => void;
  /** Convierte los bloques seleccionados; si ya son de ese tipo, los vuelve párrafo. */
  alternarBloque: (tipo: string, props?: Record<string, unknown>) => void;
  /** Convierte los bloques seleccionados sin alternar (la galería de Estilos). */
  ponerBloque: (tipo: string, props?: Record<string, unknown>) => void;
  /** Inserta un bloque nuevo, por la misma puerta que el menú de `/`. */
  insertarBloque: (tipo: string, extra?: Record<string, unknown>) => void;
  /** Aplica al destino el formato que el pincel tiene armado. */
  soltarPincel: (copiado: Estilos) => void;
  /** Lo que hay bajo el cursor, para armar el pincel. */
  estilosActivos: () => Estilos;
}

/** Los bloques que la selección tiene hoy. Uno solo cuando no hay selección múltiple. */
function bloquesTocados(editor: Editor) {
  return editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
}

export function comandosDe(editor: Editor): ComandosDelEditor {
  /**
   * ⚠️ **`document.execCommand` está marcado como obsoleto y sigue siendo la
   * única forma de copiar CON FORMATO desde un botón.** La alternativa
   * (`navigator.clipboard.writeText(editor.getSelectedText())`) manda texto
   * plano: pegar en Word perdería la negrita, que es justo lo que la vendedora
   * quería llevarse. Los tres navegadores lo soportan dentro del gesto del
   * usuario, y si algún día deja de andar, `Mod+C` sigue funcionando igual.
   *
   * El `focus()` va antes porque el comando actúa sobre la selección del
   * DOCUMENTO, y hacer clic en la barra la puede haber soltado.
   */
  function portapapeles(accion: 'cut' | 'copy') {
    editor.focus();
    document.execCommand(accion);
  }

  function cambiarTamano(direccion: 1 | -1) {
    const actual = leerTamano((editor.getActiveStyles() as Estilos).tamano);
    const nuevo = siguienteTamano(actual, direccion);
    // `null` = ya está en el extremo. No se aplica nada: es lo correcto, y es
    // distinto de aplicar el mismo valor otra vez (eso ensuciaría el historial
    // de deshacer con pasos que no cambian nada).
    if (nuevo === null) return;
    editor.focus();
    editor.addStyles({ tamano: `${nuevo}px` } as never);
  }

  return {
    deshacer: () => editor.undo(),
    rehacer: () => editor.redo(),

    cortar: () => portapapeles('cut'),
    copiar: () => portapapeles('copy'),

    aumentarTamano: () => cambiarTamano(1),
    reducirTamano: () => cambiarTamano(-1),

    // Lo activo y no una lista escrita a mano: ver `BarraDeFormato` histórico y
    // el docblock de `copiarFormato.ts`.
    limpiarFormato: () => {
      editor.focus();
      editor.removeStyles(editor.getActiveStyles());
    },

    alternarBloque: (tipo, props) => {
      const bloques = bloquesTocados(editor);
      const yaEsta = bloques.every((b) => b.type === tipo);
      editor.focus();
      for (const b of bloques) {
        editor.updateBlock(b, yaEsta ? { type: 'paragraph' } : ({ type: tipo, props } as never));
      }
    },

    ponerBloque: (tipo, props) => {
      editor.focus();
      for (const b of bloquesTocados(editor)) {
        editor.updateBlock(b, { type: tipo, props } as never);
      }
    },

    insertarBloque: (tipo, extra) => {
      editor.focus();
      insertOrUpdateBlockForSlashMenu(editor, { type: tipo, ...extra } as never);
    },

    soltarPincel: (copiado) => {
      editor.focus();
      const { aQuitar, aPoner } = cambioDeFormato(copiado, editor.getActiveStyles() as Estilos);
      if (Object.keys(aQuitar).length > 0) editor.removeStyles(aQuitar as never);
      if (Object.keys(aPoner).length > 0) editor.addStyles(aPoner as never);
    },

    estilosActivos: () => editor.getActiveStyles() as Estilos,
  };
}

export type { Estilos, FormatoEnElPincel };
