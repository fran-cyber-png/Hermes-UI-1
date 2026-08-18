import type { BlockNoteEditor } from '@blocknote/core';
import { useEffect, useState } from 'react';
import type { ComandosDelEditor } from './comandos';
import type { FormatoEnElPincel } from './copiarFormato';

/**
 * EL PINCEL, CABLEADO — la mitad con IO de `copiarFormato.ts`.
 *
 * La decisión (qué sacar y qué poner) vive pura al lado. Acá vive lo único que
 * no se puede testear sin un navegador: **cuándo se suelta**.
 *
 * ══ SE SUELTA AL TERMINAR DE SELECCIONAR, COMO EN WORD ══════════════════════
 *
 * Se toca el pincel, se arrastra sobre el texto de destino, y al soltar el mouse
 * el formato se aplica y el pincel se desarma. La alternativa —tocar el pincel
 * de nuevo para aplicar— obliga a explicar un modo con dos pasos donde Word
 * tiene uno, y la gente ya sabe cómo funciona esto.
 *
 * ⚠️ **Se escucha `mouseup` en el PAPEL, no en la ventana**: un `mouseup` en la
 * Ribbon o en la lista de páginas no es una selección de texto, y soltarlo ahí
 * aplicaría el formato a lo que hubiera quedado seleccionado antes.
 *
 * ⚠️ **Sin texto seleccionado no se aplica nada y el pincel SIGUE armado.** Un
 * clic suelto adentro del papel es cómo se apoya el cursor antes de arrastrar;
 * desarmar ahí obligaría a volver a tocar el pincel en el intento siguiente.
 * Para desarmar están Escape y volver a tocar el botón.
 */
export function usePincelDeFormato(
  editor: BlockNoteEditor<any, any, any>,
  comandos: ComandosDelEditor,
) {
  const [copiado, setCopiado] = useState<FormatoEnElPincel>(null);

  useEffect(() => {
    if (copiado === null) return;
    const papel = editor.domElement;
    if (!papel) return;

    const alSoltar = () => {
      // Sin selección real no hay destino: ver el docblock.
      if (editor.getSelectedText().length === 0) return;
      comandos.soltarPincel(copiado);
      setCopiado(null);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCopiado(null);
    };

    papel.addEventListener('mouseup', alSoltar);
    papel.addEventListener('keydown', alTeclear);
    return () => {
      papel.removeEventListener('mouseup', alSoltar);
      papel.removeEventListener('keydown', alTeclear);
    };
  }, [copiado, editor, comandos]);

  return {
    armado: copiado !== null,
    /**
     * ⚠️ Tocar el pincel armado lo DESARMA, no vuelve a copiar. Es el escape
     * para quien lo tocó sin querer, y es lo que hace que el botón sea un toggle
     * de verdad (por eso lleva `aria-pressed`).
     */
    alternar: () => setCopiado((c) => (c === null ? comandos.estilosActivos() : null)),
  };
}
