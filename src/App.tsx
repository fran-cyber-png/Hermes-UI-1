import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import type { CSSProperties } from 'react';
import { MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import Bandeja from './features/canales/Bandeja';
import BarraFrescura from './features/canales/BarraFrescura';
import PanelWhatsapp from './features/whatsapp/PanelWhatsapp';
import { useLocalStorage } from './lib/useLocalStorage';

/**
 * HERMES — la mesa del vendedor.
 *
 * ── La idea de la pantalla ──
 * A la izquierda, la cola: los comentarios y mensajes que entraron por Facebook e
 * Instagram, ordenados por urgencia real. A la derecha, WhatsApp Web vivo. Un
 * vendedor no trabaja "en Facebook" o "en WhatsApp": trabaja atendiendo gente, y
 * hasta ahora eso lo obligaba a saltar entre dos ventanas y perder de vista una
 * mientras miraba la otra.
 *
 * Los dos lados NO son simétricos, y eso es honesto: Facebook e Instagram entran
 * por la Graph API oficial (datos normalizados, en la base). WhatsApp entra
 * leyendo el DOM de la sesión real, porque su API todavía está en trámite. Cuando
 * salga la Cloud API, el panel de la derecha se reemplaza por más filas de la cola
 * de la izquierda — y el vendedor no se entera del cambio.
 *
 * Sin router: la app tiene una sola pantalla. Cuando exista la segunda se agrega;
 * un router para una ruta es andamiaje que hay que leer y no sostiene nada.
 */

/** `WebkitAppRegion` no está en los tipos de CSSProperties; Electron sí lo lee. */
const ARRASTRABLE = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_ARRASTRABLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export default function App() {
  const [conWhatsapp, setConWhatsapp] = useLocalStorage('hermes.panelWhatsapp', true);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* En macOS la ventana va sin barra de título (titleBarStyle 'hiddenInset'),
          así que este header ES la barra: sin `app-region: drag` no se puede mover. */}
      <header
        className="shrink-0 border-b border-border bg-card/95 backdrop-blur"
        style={ARRASTRABLE}
      >
        <div className="flex items-center justify-between gap-4 px-6 pb-3 pt-8">
          <div className="flex items-baseline gap-2.5">
            <span className="text-sm font-extrabold tracking-tight text-navy">HERMES</span>
            <span className="text-xs font-semibold text-muted-foreground">Bandeja</span>
          </div>

          {/* Dentro de una región de arrastre nada es clickeable: hay que devolverlo. */}
          <div className="flex items-center gap-4" style={NO_ARRASTRABLE}>
            <BarraFrescura />
            <button
              type="button"
              onClick={() => setConWhatsapp(!conWhatsapp)}
              title={conWhatsapp ? 'Ocultar WhatsApp' : 'Mostrar WhatsApp'}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {conWhatsapp ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
              <MessageSquare size={13} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* La cola scrollea sola: el panel de WhatsApp de al lado tiene su propio
            scroll interno y no deben arrastrarse entre sí. */}
        <main
          className={
            'min-h-0 overflow-y-auto ' +
            (conWhatsapp ? 'w-[26rem] shrink-0' : 'mx-auto w-full max-w-4xl')
          }
        >
          <Bandeja />
        </main>

        {conWhatsapp && (
          <aside className="min-h-0 min-w-0 flex-1">
            <PanelWhatsapp />
          </aside>
        )}
      </div>
    </div>
  );
}
