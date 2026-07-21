import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { useState, type CSSProperties } from 'react';
import { LogOut } from 'lucide-react';
import { Marca } from './components/Marca';
import { ColaUnificada } from './features/canales/ColaUnificada';
import { ConversacionActiva } from './features/canales/ConversacionActiva';
import type { Conversacion } from './features/canales/conversaciones';
import { PanelContexto } from './features/canales/PanelContexto';
import BarraFrescura from './features/canales/BarraFrescura';
import { EstadoWhatsapp } from './features/whatsapp/EstadoWhatsapp';
import { FichaContacto } from './features/cerberus/FichaContacto';
import { VistaEmbudo } from './features/vistas/VistaEmbudo';
import { VistaPersonas } from './features/vistas/VistaPersonas';
import { VistaTablero } from './features/vistas/VistaTablero';
import { VistaAgenda } from './features/agenda/VistaAgenda';
import { pendientesQueApuran, useAgenda } from './features/agenda/agenda';
import { Login } from './features/auth/Login';
import { useSesion } from './features/auth/sesion';
import { useTiempoReal } from './lib/datos/tiempoReal';

/**
 * HERMES — la mesa de la vendedora.
 *
 * UN espacio con cuatro vistas (ADR 0002), conmutadas por estado — sin router:
 *   · Bandeja  — la casa (el 90% del tiempo): cola unificada + conversación +
 *                panel derecho (ficha Cerberus en WhatsApp, contexto en Meta).
 *   · Embudo   — las mismas conversaciones leídas por etapa.
 *   · Personas — buscar a alguien por teléfono y ver su ficha 360.
 *   · Tablero  — los números honestos de la operación.
 *
 * Las vistas son ángulos de los MISMOS datos, nunca secciones con vida propia.
 */

/** `WebkitAppRegion` no está en los tipos de CSSProperties; Electron sí lo lee. */
const ARRASTRABLE = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_ARRASTRABLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const VISTAS = [
  { id: 'bandeja', label: 'Bandeja' },
  { id: 'embudo', label: 'Embudo' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'personas', label: 'Personas' },
  { id: 'tablero', label: 'Tablero' },
] as const;

type Vista = (typeof VISTAS)[number]['id'];

/** Iniciales del avatar de la vendedora: "Ana Lucía" → "AL". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return nombre.slice(0, 2).toUpperCase();
}

export default function App() {
  const { vendedora, cargando, entrar, salir } = useSesion();
  const [abierta, setAbierta] = useState<Conversacion | null>(null);
  const [vista, setVista] = useState<Vista>('bandeja');

  // El nervio en vivo: escucha el stream del server e invalida lo que cambió.
  useTiempoReal();

  // El badge de la Agenda: cuántas promesas apuran (vencidas + de hoy). Es
  // dorado porque es TIEMPO — la única acepción del oro en Hermes.
  const { agenda } = useAgenda();
  const apuran = pendientesQueApuran(agenda.data?.recordatorios);

  // Sin sesión no hay bandeja: la vendedora entra con su cuenta de Cerberus, y de
  // esa identidad cuelga cada envío y cada venta que registre.
  if (cargando) {
    return <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Cargando…</div>;
  }
  if (!vendedora) {
    return <Login entrar={entrar} />;
  }

  // Abrir una conversación desde cualquier vista te trae a la Bandeja: es la
  // única vista donde se conversa. Las demás miran, esta trabaja.
  function abrirConversacion(c: Conversacion) {
    setAbierta(c);
    setVista('bandeja');
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header data-tauri-drag-region className="shrink-0 border-b border-border bg-card/95 backdrop-blur" style={ARRASTRABLE}>
        <div className="flex items-center justify-between gap-4 px-5 pb-3 pt-8">
          <div className="flex items-center gap-5" style={NO_ARRASTRABLE}>
            <Marca />
            <nav className="flex gap-1" aria-label="Vistas">
              {VISTAS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVista(v.id)}
                  className={
                    'rounded-full px-3.5 py-1.5 text-[13px] transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                    (vista === v.id
                      ? 'bg-navy font-semibold text-white'
                      : 'font-medium text-muted-foreground hover:bg-secondary hover:text-foreground')
                  }
                >
                  {v.label}
                  {v.id === 'agenda' && apuran > 0 && (
                    <span className="ml-1.5 rounded-full bg-gold px-1.5 py-0.5 font-mono text-[10px] font-bold text-navy">
                      {apuran}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3" style={NO_ARRASTRABLE}>
            <BarraFrescura />
            <EstadoWhatsapp />
            <div className="flex items-center gap-2 border-l border-border pl-3">
              <span
                title={vendedora.nombre}
                className="flex size-7 items-center justify-center rounded-[9px] bg-navy font-heading text-[11px] font-bold text-white"
              >
                {iniciales(vendedora.nombre)}
              </span>
              <span className="text-xs font-semibold text-navy">{vendedora.nombre}</span>
              <button
                type="button"
                onClick={salir}
                title="Salir"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {vista === 'bandeja' && (
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          {/* La cola: ancho fijo, scroll propio. */}
          <main className="min-h-0 w-[25rem] shrink-0">
            <ColaUnificada seleccionada={abierta?.clave ?? null} onSeleccionar={setAbierta} />
          </main>

          {/* La conversación abierta: hilo nativo, flujo de comentario o hilo de Messenger. */}
          <section className="min-h-0 min-w-0 flex-1">
            <ConversacionActiva conversacion={abierta} onCerrar={() => setAbierta(null)} />
          </section>

          {/* El panel derecho: la ficha de Cerberus (WhatsApp, por teléfono) o el
              contexto de la persona (comentarios y Messenger). Siempre hay panel:
              saber con quién hablás no es opcional. */}
          {abierta && (
            <aside className="min-h-0 w-72 shrink-0">
              {abierta.canal === 'whatsapp' ? (
                <FichaContacto conversacion={abierta} />
              ) : (
                <PanelContexto conversacion={abierta} />
              )}
            </aside>
          )}
        </div>
      )}

      {vista === 'embudo' && <VistaEmbudo onAbrir={abrirConversacion} />}
      {vista === 'agenda' && <VistaAgenda onAbrir={abrirConversacion} />}
      {vista === 'personas' && <VistaPersonas />}
      {vista === 'tablero' && <VistaTablero />}
    </div>
  );
}
