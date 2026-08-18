import { CreateLinkButton, useBlockNoteEditor } from '@blocknote/react';
import { useMemo } from 'react';
import { gruposDe } from '../catalogo';
import { comandosDe } from '../comandos';
import { RibbonGrupos } from '../RibbonGrupos';

/**
 * LA PESTAÑA «INSERTAR» — sólo lo que el esquema tiene.
 *
 * ══ QUÉ SE OFRECE, Y QUIÉN LO DECIDE ═══════════════════════════════════════
 *
 * 🔴 **La lista NO se escribe acá.** `catalogo.ts` la deriva de
 * `ESQUEMA_LIBRETA.blockSchema` y de `BLOQUES_RETIRADOS`: lo que el esquema
 * tiene sale encendido y lo que `editor.ts` sacó sale apagado con su motivo.
 * Este archivo sólo dice, para cada uno, qué bloque insertar.
 *
 * Lo que eso compra: el día que existan los adjuntos de verdad (`uploadFile` +
 * almacenamiento) y el esquema vuelva a traer `image`, la caja se enciende sola.
 * Con la lista escrita a mano seguiría apagada, sin error y sin test rojo.
 *
 * ══ TODO PASA POR LA MISMA PUERTA QUE EL MENÚ DE `/` ═══════════════════════
 *
 * `comandos.insertarBloque` es `insertOrUpdateBlockForSlashMenu`, la función que
 * corre cuando alguien escribe `/tabla`. Decide algo que a mano se hace mal: si
 * el bloque donde está el cursor está vacío **lo convierte** en vez de insertar
 * uno nuevo debajo, así que insertar una tabla en una página en blanco no deja
 * un párrafo huérfano arriba. Que el botón y el `/` hagan exactamente lo mismo
 * no es prolijidad: son dos puertas al mismo bloque, y dos puertas que hacen
 * cosas distintas es #37.
 *
 * ⚠️ **La tabla nace 3×2, igual que por `/`** — el mismo contenido inicial que
 * usa `getDefaultSlashMenuItems`. Un tamaño distinto acá haría que la misma
 * acción diera dos resultados según de dónde se la llamó.
 */

/** El mismo contenido inicial que inserta el menú de `/`. */
const TABLA_VACIA = {
  content: {
    type: 'tableContent',
    rows: [{ cells: ['', '', ''] }, { cells: ['', '', ''] }],
  },
};

export function TabInsertar() {
  const editor = useBlockNoteEditor();
  const comandos = useMemo(() => comandosDe(editor), [editor]);

  return (
    <RibbonGrupos
      grupos={gruposDe('insertar')}
      piezas={{
        // El del paquete: trae el popover de pegar la URL, su `Mod+K` y la
        // lectura de si ya hay un enlace bajo el cursor.
        enlace: <CreateLinkButton />,
      }}
      acciones={{
        insertarTabla: () => comandos.insertarBloque('table', TABLA_VACIA),
        insertarCita: () => comandos.insertarBloque('quote'),
        insertarCodigo: () => comandos.insertarBloque('codeBlock'),
        insertarSeparador: () => comandos.insertarBloque('divider'),
        insertarTareas: () => comandos.insertarBloque('checkListItem'),
        insertarDesplegable: () => comandos.insertarBloque('toggleListItem'),
      }}
    />
  );
}
