import { useCallback, useEffect } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from '@blocknote/react';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { FileText, MessageSquareQuote } from 'lucide-react';
import '@blocknote/mantine/style.css';
import {
  DICCIONARIO_LIBRETA,
  ESQUEMA_LIBRETA,
  bloquesDeTexto,
  soloBloquesConocidos,
  soloEstilosConocidos,
} from './editor';
import { BarraFlotante } from './BarraFlotante';

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
  onAbrirPlantillas,
  onAbrirRespuestasRapidas,
  registrarPegado,
}: {
  contenidoInicial: unknown[] | undefined;
  soloLectura: boolean;
  onCambio: (doc: unknown) => void;
  /**
   * Avisa al padre que abra el modal de Plantillas. OPCIONAL: sin
   * él, el `/` no ofrece «Plantillas» — que es lo correcto en la mitad derecha
   * de la pantalla dividida, donde el modal no tiene dueño.
   */
  onAbrirPlantillas?: () => void;
  /**
   * Igual que `onAbrirPlantillas`, pero para el catálogo de `hechos` (#153) —
   * el mismo que administra «Configurar Respuestas Rápidas» y el `/` del
   * composer de WhatsApp (`SelectorRapido`). OPCIONAL por el mismo motivo.
   */
  onAbrirRespuestasRapidas?: () => void;
  /** Le presta al padre CÓMO pegar en ESTA instancia del editor (o `null` al desmontarse). */
  registrarPegado?: (fn: ((texto: string) => void) | null) => void;
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
    // Apagado por default en BlockNote. Sin esto, «combinar celdas» de la barra
    // flotante del paquete se queda callado (devuelve `null`) aunque el resto
    // de la barrita ande.
    tables: { splitCells: true },
  });

  /**
   * 🔴 `getItems` TIENE QUE SER LA MISMA FUNCIÓN ENTRE RENDERS, NO UNA NUEVA
   * CADA VEZ. Este componente se re-renderiza sola con cada tecla —el
   * autoguardado pasa por `estadoGuardado` en `Libreta`, que es el padre— y
   * `SuggestionMenuController` memoiza `getItemsOrDefault` sobre `[editor,
   * getItems]`: con un `getItems` inline, esa identidad cambia en CADA
   * re-render, y el menú abierto se re-carga de cero cada vez — hasta hacerse
   * imposible de clickear (verificado con Playwright: el ítem quedaba
   * "detached from DOM" en loop). `useCallback` es lo que lo vuelve estable.
   */
  const getItemsDelSlash = useCallback(
    async (query: string) => {
      const propios = [
        ...(onAbrirPlantillas
          ? [
              {
                title: 'Plantillas',
                onItemClick: () => {
                  // Limpia el «/plantillas» que quedó escrito — la misma puerta que
                  // usa cada ítem por default, para no reimplementar la regla de «si
                  // el bloque está vacío, lo convierte» (ver `comandos.ts`).
                  insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph' });
                  onAbrirPlantillas();
                },
                aliases: ['plantilla', 'plantillas', 'snippet', 'texto guardado'],
                group: 'Tu libreta',
                subtext: 'Guardá un texto y pegalo cuando quieras',
                icon: <FileText className="size-4" />,
              },
            ]
          : []),
        // Debajo de «Plantillas», mismo grupo: son las dos formas de pegar un
        // texto guardado, y la búsqueda del `/` las tiene que encontrar juntas.
        ...(onAbrirRespuestasRapidas
          ? [
              {
                title: 'Respuestas rápidas',
                onItemClick: () => {
                  insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph' });
                  onAbrirRespuestasRapidas();
                },
                aliases: ['respuesta', 'respuestas', 'rapida', 'rapidas', 'hechos', 'dato', 'datos'],
                group: 'Tu libreta',
                subtext: 'Elige tus respuestas predefinidas',
                icon: <MessageSquareQuote className="size-4" />,
              },
            ]
          : []),
      ];
      return filterSuggestionItems([...propios, ...getDefaultReactSlashMenuItems(editor)], query);
    },
    [editor, onAbrirPlantillas, onAbrirRespuestasRapidas],
  );

  /**
   * PEGAR UNA PLANTILLA — una línea = un párrafo (`bloquesDeTexto`, la MISMA
   * conversión que abre una nota vieja sin `doc`). Si el cursor está sobre un
   * bloque vacío (el que dejó el `/` al limpiarse), lo REEMPLAZA en vez de
   * insertar debajo: es la misma decisión de `insertOrUpdateBlockForSlashMenu`
   * para el resto del menú, y sin ella pegar en una página en blanco dejaría un
   * párrafo vacío colgando arriba (ver el docblock de `comandos.ts`).
   */
  const pegarPlantilla = useCallback(
    (texto: string) => {
      const bloques = bloquesDeTexto(texto);
      const actual = editor.getTextCursorPosition().block;
      const vacio = Array.isArray(actual.content) && actual.content.length === 0;
      if (vacio) {
        editor.updateBlock(actual, bloques[0] as never);
        if (bloques.length > 1) editor.insertBlocks(bloques.slice(1) as never, actual, 'after');
        editor.setTextCursorPosition(actual, 'end');
      } else {
        editor.insertBlocks(bloques as never, actual, 'after');
      }
      editor.focus();
    },
    [editor],
  );

  /**
   * 🔴 EL MODAL VIVE EN `Libreta` (EL PADRE), NO ACÁ — Y ES A PROPÓSITO.
   *
   * Este componente se REMONTA cuando una página en blanco recibe su id (la
   * transición `'nueva' → 'nota'`, ver el docblock de arriba y el de
   * `useAutoguardado.ts`): pasan ~800 ms desde la primera tecla. Con el modal
   * (y su `plantillasAbierto`) viviendo ACÁ, abrir «Plantillas» justo al
   * empezar una página en blanco lo hacía desaparecer a mitad de uso — la
   * vendedora todavía completando el formulario, y el remount se lo llevaba
   * puesto. Por eso `Libreta` es dueña del estado y esto solo LE PRESTA la
   * función de pegado de la instancia VIVA — que si el componente se
   * remonta, se vuelve a registrar sola con el editor nuevo.
   */
  useEffect(() => {
    if (!registrarPegado) return;
    registrarPegado(pegarPlantilla);
    return () => registrarPegado(null);
  }, [registrarPegado, pegarPlantilla]);

  // Cualquiera de los dos alcanza para necesitar el menú propio: sin esto,
  // pasar SOLO `onAbrirRespuestasRapidas` dejaría prendido el `slashMenu` del
  // paquete a la vez que el de acá abajo, y vuelve el bug de los dos menús
  // superpuestos que el comentario de más abajo ya documenta.
  const menuPropio = Boolean(onAbrirPlantillas || onAbrirRespuestasRapidas);

  return (
    <BlockNoteView
      editor={editor}
      editable={!soloLectura}
      theme="light"
      // La flotante del paquete se apaga acá y la monta `BarraFlotante`: la
      // del paquete sola tiene un bug real (ver su docblock — cerraba la
      // barrita entera al tocar «Colores»), y el arreglo es envolverla.
      formattingToolbar={false}
      // 🔴 SIN ESTO, `/` ABRE DOS MENÚS SUPERPUESTOS Y NINGUNO SE PUEDE
      // CLICKEAR. `BlockNoteView` monta SU PROPIO `SuggestionMenuController`
      // para `/` a menos que se le diga `slashMenu={false}` (ver
      // `BlockNoteDefaultUI.tsx` del paquete): con el propio de acá abajo
      // TAMBIÉN registrado para el mismo `triggerCharacter`, quedan dos.
      //
      // Se apaga sólo cuando ponemos el nuestro: sin `registrarPegado` ni
      // `onAbrirPlantillas`/`onAbrirRespuestasRapidas` —la mitad derecha de la
      // pantalla dividida— el menú del paquete es el ÚNICO que hay, y apagarlo
      // dejaría el `/` muerto ahí.
      slashMenu={!menuPropio}
      onChange={() => onCambio(editor.document)}
      data-libreta-editor
    >
      {/* En solo lectura no se dibuja: una barra de formato sobre algo que no
          se puede editar promete una acción que no existe — el mismo criterio
          por el que «Responder» no aparece en modo revisión. */}
      {/* En solo lectura no se dibuja: una barra de formato sobre algo que no
          se puede editar promete una acción que no existe — el mismo criterio
          por el que «Responder» no aparece en modo revisión. */}
      {!soloLectura && <BarraFlotante />}
      {/* Montar el controlador propio es la ÚNICA forma de sumarle un ítem al
          menú del `/`: el catálogo del paquete no es extensible desde afuera.
          En solo lectura no va — ofrecería insertar sobre algo que no se edita. */}
      {menuPropio && !soloLectura && (
        <SuggestionMenuController triggerCharacter="/" getItems={getItemsDelSlash} />
      )}
    </BlockNoteView>
  );
}
