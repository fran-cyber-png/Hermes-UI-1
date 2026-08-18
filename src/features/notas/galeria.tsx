import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@blocknote/mantine/style.css';
import '../../index.css';
import { BarraDeFormato } from './BarraDeFormato';
import { DICCIONARIO_LIBRETA, ESQUEMA_LIBRETA } from './editor';
import { TAB_POR_DEFECTO, type TabRibbon } from './ribbon/catalogo';

/**
 * LA GALERÍA DE LA RIBBON — la evidencia, sin server ni base.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-libreta.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y porque
 * **lo que este frente cambia no lo puede ver ningún test**: jsdom no hace
 * layout, así que para él la barra siempre está perfecta — es exactamente el
 * agujero por el que la barra anterior quedó 60 vh más abajo, existiendo, con
 * sus botones y sin verse.
 *
 * Lo que hay que mirar acá, en este orden:
 *
 *  1. **Que la Ribbon se vea entera y arriba del papel**, con sus grupos
 *     separados y su rótulo debajo de cada uno.
 *  2. **Las cinco pestañas**: que cambiar de una a otra cambie los grupos, y que
 *     Deshacer/Rehacer sigan ahí en todas.
 *  3. **Lo apagado**: en «Insertar» las cuatro cajas de Multimedia y el Emoji;
 *     en «Dibujar» los siete grupos con su renglón; en «Revisar» las tres de
 *     Colaboración. Pasar el mouse por cada una tiene que decir POR QUÉ.
 *  4. **El ancho** — los marcos de abajo son 1920, 1366, 1024 y 760. Los cuatro
 *     escalones del acomodo se ven en ese orden: se achica el aire, se van los
 *     rótulos de los botones (abajo de 1.180), los grupos SECUNDARIOS caen al
 *     botón **«Más»** —que los abre en una segunda fila— y los primarios
 *     (Fuente, Párrafo) **no se van nunca**.
 *
 * ⚠️ **No monta la `Libreta` entera** a propósito: eso pediría el server para
 * la lista de páginas, y lo que hay que mirar es la barra. Por eso la acción
 * «Vista ▸ Lista de páginas» acá no mueve nada — no hay lista al lado.
 */

/** Una página con algo escrito: los selectores sobre texto vacío no dicen nada. */
const CONTENIDO = [
  { type: 'heading', props: { level: 1 }, content: 'Playbook de cierre' },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'El precio se manda ', styles: {} },
      { type: 'text', text: 'después', styles: { bold: true } },
      { type: 'text', text: ' de saber qué curso quiere. ', styles: {} },
      { type: 'text', text: 'Nunca antes.', styles: { italic: true, textColor: 'red' } },
    ],
  },
  {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Esta línea está en Georgia, 24.', styles: { fuente: 'Georgia, serif', tamano: '24px' } }],
  },
  { type: 'bulletListItem', content: 'Preguntar por el curso' },
  { type: 'bulletListItem', content: 'Asentar el interés' },
  { type: 'quote', content: '«¿Cuánto sale?» es la señal más barata que existe.' },
];

function Papel({ contenido }: { contenido: unknown[] | undefined }) {
  const editor = useCreateBlockNote({
    initialContent: contenido as never,
    schema: ESQUEMA_LIBRETA,
    dictionary: DICCIONARIO_LIBRETA,
  });
  const [tab, setTab] = useState<TabRibbon>(TAB_POR_DEFECTO);
  const [listaVisible, setListaVisible] = useState(true);

  return (
    <BlockNoteView editor={editor} editable theme="light" formattingToolbar={false} data-libreta-editor>
      <BarraDeFormato
        tab={tab}
        onTab={setTab}
        vista={{ listaVisible, alternarLista: () => setListaVisible((v) => !v) }}
      />
    </BlockNoteView>
  );
}

function Marco({ ancho, titulo, contenido }: { ancho: number; titulo: string; contenido?: unknown[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-2 text-sm font-medium text-foreground">
        {titulo} <span className="font-normal text-muted-foreground">· {ancho} px</span>
      </h2>
      <div
        className="overflow-hidden rounded-lg border border-border bg-card"
        // El ancho se simula con el contenedor, como en el resto de las galerías:
        // el `ResizeObserver` de la Fase 5 va a medir esto, no la ventana.
        style={{ width: ancho, maxWidth: '100%' }}
      >
        <Papel contenido={contenido} />
      </div>
    </section>
  );
}

function Galeria() {
  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">La Ribbon de la Libreta</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cinco pestañas, grupos rotulados y lo que todavía no existe apagado con su motivo. Pasá el mouse
          por cualquier caja gris: el tooltip dice por qué.
        </p>
      </header>

      <Marco ancho={1920} titulo="Escritorio" contenido={CONTENIDO} />
      <Marco ancho={1366} titulo="Laptop" contenido={CONTENIDO} />
      {/* Abajo de 1.180 la barra pasa a compacta (ver `ANCHO_COMPACTO`). */}
      <Marco ancho={1024} titulo="Ventana chica · compacta" contenido={CONTENIDO} />
      {/* Y acá ya no entran los secundarios: aparece el «Más». */}
      <Marco ancho={760} titulo="Ventana angosta · con «Más»" contenido={CONTENIDO} />
      {/* 🔴 EL CASO QUE LA CAPTURA YA ENCONTRÓ UNA VEZ: en una página en blanco
          varios botones del paquete devuelven `null`, y la barra puede quedar
          existiendo y sin un solo control adentro. */}
      <Marco ancho={1366} titulo="Página EN BLANCO" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Galeria />
  </StrictMode>,
);
