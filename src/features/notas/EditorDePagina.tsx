import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import '@blocknote/mantine/style.css';
import { DICCIONARIO_LIBRETA, ESQUEMA_LIBRETA, soloBloquesConocidos, soloEstilosConocidos } from './editor';
import { BarraDeFormato } from './BarraDeFormato';
import type { TabRibbon } from './ribbon/tabs';
import type { VistaDeLaLibreta } from './ribbon/Ribbon';

/**
 * EL EDITOR de una página. Va con `key` de afuera para que cambiar de nota lo
 * REMONTE: `useCreateBlockNote` fija su `initialContent` en el primer render y
 * no lo vuelve a mirar, así que sin remontar se quedaría con la nota anterior.
 *
 * Extraído de `Libreta.tsx` (17-ago-2026) para que la pantalla dividida
 * (`PantallaDividida.tsx`) lo use tal cual — es el MISMO editor a la derecha,
 * no una copia: con dos, un arreglo al de la izquierda no llegaría nunca al
 * de al lado (#37).
 */
export function EditorDePagina({
  contenidoInicial,
  soloLectura,
  onCambio,
  ribbon,
}: {
  contenidoInicial: unknown[] | undefined;
  soloLectura: boolean;
  onCambio: (doc: unknown) => void;
  /**
   * 🔴 LA RIBBON ES OPCIONAL, Y ESO ES LO QUE HACE QUE LA PANTALLA DIVIDIDA NO
   * TENGA DOS BARRAS. Ausente = este editor no dibuja ninguna.
   *
   * ⚠️ **La pestaña activa vive ARRIBA de este componente, nunca adentro de la
   * barra**: acá se remonta con `key` cada vez que se abre otra página
   * (`useCreateBlockNote` fija su `initialContent` en el primer render), así que
   * con el estado adentro, cambiar de nota te devolvería a «Inicio» cada vez — y
   * en una libreta se salta de página todo el tiempo.
   */
  ribbon?: { tab: TabRibbon; onTab: (tab: TabRibbon) => void; vista: VistaDeLaLibreta };
}) {
  const editor = useCreateBlockNote({
    // El cast es el borde con la librería: `docParaEditor` produce la forma de
    // BlockNote pero el tipo viaja como `unknown` desde la base — tiparlo fuerte
    // más arriba sería afirmar sobre un `jsonb` algo que nadie verificó.
    // Saneado ANTES de entrar: un bloque que el esquema no conoce lanza durante
    // el render y, sin ErrorBoundary, deja la app en blanco (ver `editor.ts`).
    // Dos saneadores, dos trampas distintas: uno filtra BLOQUES que el esquema no
    // conoce y el otro ESTILOS. Cualquiera de los dos, sin sanear, no deja «la
    // nota no abre» sino la ventana en blanco (ver `editor.ts`).
    initialContent: (contenidoInicial
      ? soloEstilosConocidos(soloBloquesConocidos(contenidoInicial))
      : undefined) as never,
    // Sin esto el editor entero sale en INGLÉS dentro de una app en español, y
    // ofrece bloques de archivo que no se pueden guardar. Ver `editor.ts`.
    schema: ESQUEMA_LIBRETA,
    dictionary: DICCIONARIO_LIBRETA,
  });

  return (
    <BlockNoteView
      editor={editor}
      editable={!soloLectura}
      theme="light"
      // Con la barra FIJA arriba (`BarraDeFormato`), la flotante que BlockNote
      // abre al seleccionar se apaga: con las dos, el mismo control aparece dos
      // veces y uno tapa al otro. Sin ribbon —la mitad derecha de la pantalla
      // dividida— se deja la flotante, que ahí es la ÚNICA forma de dar formato.
      formattingToolbar={!ribbon}
      onChange={() => onCambio(editor.document)}
      data-libreta-editor
    >
      {/* En solo lectura no se dibuja: una barra de formato sobre algo que no
          se puede editar promete una acción que no existe — el mismo criterio
          por el que «Responder» no aparece en modo revisión. */}
      {ribbon && !soloLectura && (
        <BarraDeFormato tab={ribbon.tab} onTab={ribbon.onTab} vista={ribbon.vista} />
      )}
    </BlockNoteView>
  );
}
