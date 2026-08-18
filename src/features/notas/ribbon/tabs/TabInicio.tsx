import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  NestBlockButton,
  TextAlignButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useSelectedBlocks,
} from '@blocknote/react';
import { useMemo } from 'react';
import { comandosDe } from '../comandos';
import { gruposDe } from '../catalogo';
import { RibbonGrupos } from '../RibbonGrupos';
import { SelectorDeFuente, SelectorDeTamano } from '../SelectoresDeTexto';
import { usePincelDeFormato } from '../usePincelDeFormato';

/**
 * LA PESTAÑA «INICIO» — los quince controles de la barra vieja, agrupados, más
 * lo que faltaba.
 *
 * ══ QUÉ SE MUEVE Y QUÉ SE CONSTRUYE ════════════════════════════════════════
 *
 * **Se mueven, sin tocarles una línea**: fuente, tamaño, N K S̲ S̶ ⌨, colores,
 * alineación, sangría y limpiar formato. Los que son del paquete siguen siendo
 * del paquete: traen su estado activo, su tooltip y su locale `es` resueltos, y
 * reescribirlos sería una segunda implementación de algo que ya anda (#37).
 *
 * **Se construyen**: cortar, copiar, copiar formato, agrandar/achicar, viñetas,
 * numeración, la galería de Estilos y **Justificar** — que era gratis y no
 * estaba: `textAlignment: 'justify'` ya vive en el esquema de BlockNote, con su
 * ícono y su traducción.
 *
 * ══ ⚠️ EL ESTADO ACTIVO SALE DEL EDITOR, NUNCA DE UN ESTADO PROPIO ══════════
 *
 * Viñetas, numeración y los cuatro estilos se prenden leyendo `useSelectedBlocks()`,
 * que se re-renderiza solo cuando la selección cambia. Con un `useState` propio,
 * el botón diría lo último que alguien apretó — que es otra cosa que «dónde está
 * el cursor», y la diferencia se nota justo cuando importa: al mover el cursor a
 * una lista que ya existía.
 */
export function TabInicio() {
  const editor = useBlockNoteEditor();
  const comandos = useMemo(() => comandosDe(editor), [editor]);
  const pincel = usePincelDeFormato(editor, comandos);
  const bloques = useSelectedBlocks(editor);

  /** Todos los bloques tocados son de ese tipo. Con uno solo alcanza el primero. */
  const todos = (predicado: (b: (typeof bloques)[number]) => boolean) =>
    bloques.length > 0 && bloques.every(predicado);

  const esTitulo = (nivel: number) =>
    todos((b) => b.type === 'heading' && (b.props as { level?: number }).level === nivel);

  return (
    <RibbonGrupos
      grupos={gruposDe('inicio')}
      piezas={{
        fuente: <SelectorDeFuente />,
        tamano: <SelectorDeTamano />,
        negrita: <BasicTextStyleButton basicTextStyle="bold" />,
        cursiva: <BasicTextStyleButton basicTextStyle="italic" />,
        subrayado: <BasicTextStyleButton basicTextStyle="underline" />,
        tachado: <BasicTextStyleButton basicTextStyle="strike" />,
        codigo: <BasicTextStyleButton basicTextStyle="code" />,
        colores: <ColorStyleButton />,
        alinearIzquierda: <TextAlignButton textAlignment="left" />,
        centrar: <TextAlignButton textAlignment="center" />,
        alinearDerecha: <TextAlignButton textAlignment="right" />,
        justificar: <TextAlignButton textAlignment="justify" />,
        reducirSangria: <UnnestBlockButton />,
        aumentarSangria: <NestBlockButton />,
        // El select del paquete queda como «Más estilos»: es la lista completa
        // (incluida la cita y el bloque de código), y la galería de al lado son
        // los cuatro atajos que se usan todo el tiempo.
        masEstilos: <BlockTypeSelect />,
      }}
      acciones={{
        cortar: comandos.cortar,
        copiar: comandos.copiar,
        copiarFormato: pincel.alternar,
        aumentarTamano: comandos.aumentarTamano,
        reducirTamano: comandos.reducirTamano,
        limpiarFormato: comandos.limpiarFormato,
        vinetas: () => comandos.alternarBloque('bulletListItem'),
        numeracion: () => comandos.alternarBloque('numberedListItem'),
        estiloNormal: () => comandos.ponerBloque('paragraph'),
        estiloTitulo1: () => comandos.ponerBloque('heading', { level: 1 }),
        estiloTitulo2: () => comandos.ponerBloque('heading', { level: 2 }),
        estiloTitulo3: () => comandos.ponerBloque('heading', { level: 3 }),
      }}
      activos={{
        copiarFormato: pincel.armado,
        vinetas: todos((b) => b.type === 'bulletListItem'),
        numeracion: todos((b) => b.type === 'numberedListItem'),
        estiloNormal: todos((b) => b.type === 'paragraph'),
        estiloTitulo1: esTitulo(1),
        estiloTitulo2: esTitulo(2),
        estiloTitulo3: esTitulo(3),
      }}
    />
  );
}
