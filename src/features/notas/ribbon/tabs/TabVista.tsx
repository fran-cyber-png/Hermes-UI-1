import { useBlockNoteEditor, useEditorState } from '@blocknote/react';
import { useState } from 'react';
import { gruposDe } from '../catalogo';
import { RibbonGrupos } from '../RibbonGrupos';
import {
  ZOOM_NORMAL,
  anchoCompleto,
  leerZoom,
  ponerAncho,
  ponerZoom,
  siguienteZoom,
} from '../vistaDelPapel';

/**
 * LA PESTAÑA «VISTA» — cómo se mira esta página.
 *
 * Zoom, ancho y modo lectura son reales y **leen su estado del papel**, no de un
 * `useState`: esta pestaña se desmonta apenas alguien vuelve a «Inicio», y un
 * estado propio volvería a decir «100 %» sobre un papel que quedó al 130. El
 * porqué largo está en `vistaDelPapel.ts`.
 *
 * ⚠️ **Contraer y la lista de páginas NO viven acá**: son de la cáscara
 * (`Ribbon.tsx`) y de la Libreta, que son quienes tienen ese estado. Acá llegan
 * como acciones, que es justamente lo que separar comandos de presentación
 * permite hacer sin que esta pestaña sepa de layout.
 *
 * ⚠️ **Tema queda apagado** y es la verdad: `Libreta.tsx` monta el editor con
 * `theme="light"` fijo. Un selector de tema acá pediría además decidir qué pasa
 * con el resto de la app, que es otro frente.
 */
export function TabVista({
  contraida,
  alternarContraer,
  listaVisible,
  alternarLista,
}: {
  contraida: boolean;
  alternarContraer: () => void;
  listaVisible: boolean;
  alternarLista: () => void;
}) {
  const editor = useBlockNoteEditor();

  /**
   * 🔴 ZOOM Y ANCHO SE SIEMBRAN DEL PAPEL Y DESPUÉS VIVEN EN REACT.
   *
   * **Del papel al montar**, porque esta pestaña se desmonta apenas alguien
   * vuelve a «Inicio»: con un `useState(1)` a secas, alejar, ir y volver dejaría
   * el botón diciendo «100 %» sobre un papel al 75.
   *
   * **En React de ahí en más**, y esto NO es cosmético: cambiar `style.zoom` o un
   * atributo **no es una transacción de ProseMirror**, así que `useEditorState`
   * no se entera y no re-renderiza. Con el valor leído ahí, `siguienteZoom`
   * calculaba siempre desde el zoom VIEJO — el segundo clic en «Acercar» no
   * hacía nada, y el tercero tampoco. Lo encontró `Ribbon.test.tsx`.
   *
   * ⚠️ `lectura` **sí** sigue saliendo de `useEditorState`: `editor.isEditable`
   * es del editor y su setter sí dispara una transacción, así que ahí el hook
   * es lo correcto — y además refleja el cambio venga de donde venga.
   */
  const [zoom, setZoom] = useState(() => leerZoom(editor));
  const [ancho, setAncho] = useState(() => anchoCompleto(editor));
  const lectura = useEditorState({ editor, selector: ({ editor }) => !editor.isEditable });

  const puedeAcercar = siguienteZoom(zoom, 1) !== null;
  const puedeAlejar = siguienteZoom(zoom, -1) !== null;

  function cambiarZoom(direccion: 1 | -1) {
    const nuevo = siguienteZoom(zoom, direccion);
    if (nuevo === null) return;
    ponerZoom(editor, nuevo);
    setZoom(nuevo);
  }

  return (
    <RibbonGrupos
      edita={false}
      grupos={gruposDe('vista')}
      bloqueados={{
        // ⚠️ En el extremo el botón se apaga **con su motivo**, no dejando la
        // acción en `undefined`: eso lo dibujaría como «Todavía no cableado».
        acercar: puedeAcercar ? undefined : 'Ya está en el máximo',
        alejar: puedeAlejar ? undefined : 'Ya está en el mínimo',
      }}
      acciones={{
        acercar: () => cambiarZoom(1),
        alejar: () => cambiarZoom(-1),
        zoomNormal: () => {
          ponerZoom(editor, ZOOM_NORMAL);
          setZoom(ZOOM_NORMAL);
        },
        anchoPagina: () => {
          ponerAncho(editor, !ancho);
          setAncho(!ancho);
        },
        modoLectura: () => {
          editor.isEditable = !editor.isEditable;
        },
        mostrarLista: alternarLista,
        contraerRibbon: alternarContraer,
      }}
      activos={{
        anchoPagina: ancho,
        modoLectura: lectura,
        mostrarLista: listaVisible,
        contraerRibbon: contraida,
      }}
    />
  );
}
