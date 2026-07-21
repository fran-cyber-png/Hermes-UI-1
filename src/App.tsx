import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { useState, type CSSProperties } from 'react';
import { MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ColaUnificada } from './features/canales/ColaUnificada';
import type { Conversacion } from './features/canales/conversaciones';
import BarraFrescura from './features/canales/BarraFrescura';
import PanelWhatsapp from './features/whatsapp/PanelWhatsapp';
import { useLocalStorage } from './lib/useLocalStorage';

/**
 * HERMES — la mesa de la vendedora.
 *
 * A la izquierda, la cola unificada: comentarios de Facebook e Instagram, DMs de
 * Messenger y chats de WhatsApp en UNA sola lista, ordenada por urgencia real. A
 * la derecha, la conversación activa (hoy el panel de WhatsApp; la conversación
 * nativa llega en S5). Un vendedor no trabaja "en Facebook" o "en WhatsApp":
 * trabaja atendiendo gente, y hasta ahora eso lo obligaba a saltar entre ventanas.
 *
 * Sin router: una sola pantalla. Cuando exista la segunda se agrega uno.
 */

/** `WebkitAppRegion` no está en los tipos de CSSProperties; Electron sí lo lee. */
const ARRASTRABLE = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_ARRASTRABLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export default function App() {
  const [conWhatsapp, setConWhatsapp] = useLocalStorage('hermes.panelWhatsapp', true);
  const [abierta, setAbierta] = useState<Conversacion | null>(null);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-card/95 backdrop-blur" style={ARRASTRABLE}>
        <div className="flex items-center justify-between gap-4 px-6 pb-3 pt-8">
          <div className="flex items-baseline gap-2.5">
            <span className="text-sm font-extrabold tracking-tight text-navy">HERMES</span>
            <span className="text-xs font-semibold text-muted-foreground">Bandeja</span>
          </div>

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
        <main className={conWhatsapp ? 'min-h-0 w-[26rem] shrink-0' : 'mx-auto min-h-0 w-full max-w-3xl'}>
          <ColaUnificada seleccionada={abierta?.clave ?? null} onSeleccionar={setAbierta} />
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
