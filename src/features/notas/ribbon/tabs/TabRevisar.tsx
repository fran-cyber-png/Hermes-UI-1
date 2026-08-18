import { useBlockNoteEditor, useEditorState } from '@blocknote/react';
import { useState } from 'react';
import { gruposDe } from '../catalogo';
import { contarTexto, leerConteo } from '../contarTexto';
import { RibbonGrupos } from '../RibbonGrupos';
import { ortografiaEncendida, ponerOrtografia, textoDelPapel } from '../vistaDelPapel';

/**
 * LA PESTAÑA «REVISAR» — dos cosas reales y tres que todavía no.
 *
 * **Ortografía** es el corrector del navegador, que ya estaba y no se podía
 * apagar: en una libreta llena de nombres de cursos y de gente, el subrayado
 * rojo permanente es ruido. Se apaga y se prende con el atributo `spellcheck`
 * sobre el papel.
 *
 * **Palabras** contesta «¿cuánto escribí?».
 * ⚠️ **NO dice cuánto falta para el tope de 20.000**, y el porqué está escrito
 * en `contarTexto.ts`: ese largo lo deriva el server (`aTextoPlano`), y copiar
 * acá esa derivación para poder dibujar una barra de progreso sería la misma
 * regla en dos lados. Un contador que dice «te quedan 150» cuando el server ya
 * cuenta de más es peor que ninguno, porque se le cree.
 *
 * **Comentarios, Historial y Comparar** están apagados con su motivo. BlockNote
 * sí trae comentarios, pero piden un almacén de hilos del lado del server — o
 * sea, un frente, no un botón.
 */

/**
 * ⚠️ **Es un INDICADOR, no un botón.** Un botón que sólo muestra un número
 * promete una acción que no existe; mostrar el número directo no promete nada.
 * Por eso no entra al recorrido con flechas: no hay nada que hacerle.
 */
function ContadorDePalabras() {
  const editor = useBlockNoteEditor();
  // Se recalcula cuando el documento cambia y no en cada render: el conteo
  // recorre el árbol de ProseMirror, y hacerlo en cada movimiento del cursor
  // sería trabajo por nada.
  const conteo = useEditorState({
    editor,
    on: 'change',
    selector: ({ editor }) => contarTexto(textoDelPapel(editor)),
  });
  const leido = leerConteo(conteo);

  return (
    <span
      title={`${leido}. El tope de la página lo cuenta el servidor al guardar.`}
      className="flex h-[1.875rem] items-center whitespace-nowrap rounded px-2 text-xs tabular-nums text-muted-foreground"
    >
      {conteo.palabras.toLocaleString('es-PE')}
      <span className="ml-1 text-[0.625rem]">{conteo.palabras === 1 ? 'palabra' : 'palabras'}</span>
    </span>
  );
}

export function TabRevisar() {
  const editor = useBlockNoteEditor();

  /**
   * 🔴 EL ESTADO SE SIEMBRA DEL PAPEL Y DESPUÉS VIVE EN REACT, y las dos mitades
   * son necesarias.
   *
   * **Del papel al montar**, porque esta pestaña se desmonta apenas alguien
   * vuelve a «Inicio»: con un `useState(true)` a secas, apagar la ortografía, ir
   * y volver dejaría el botón diciendo «encendida» sobre un papel apagado.
   *
   * **En React de ahí en más**, porque cambiar un ATRIBUTO del DOM **no es una
   * transacción de ProseMirror**: `useEditorState` no se entera y no re-renderiza.
   * Lo encontró `Ribbon.test.tsx` — el `spellcheck` cambiaba y el botón se
   * quedaba en `aria-pressed="true"`, o sea un control afirmando lo contrario de
   * lo que la pantalla hacía.
   */
  const [ortografia, setOrtografia] = useState(() => ortografiaEncendida(editor));

  return (
    <RibbonGrupos
      edita={false}
      grupos={gruposDe('revisar')}
      piezas={{ contarPalabras: <ContadorDePalabras /> }}
      acciones={{
        ortografia: () => {
          const nueva = !ortografia;
          ponerOrtografia(editor, nueva);
          setOrtografia(nueva);
        },
      }}
      activos={{ ortografia }}
    />
  );
}
