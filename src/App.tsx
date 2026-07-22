import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { useState, type CSSProperties } from 'react';
import {
  AlarmClock,
  Columns3,
  LayoutDashboard,
  LogOut,
  Mail,
  MessagesSquare,
  Users,
} from 'lucide-react';
import { Escudo } from './components/Marca';
import { ColaUnificada } from './features/canales/ColaUnificada';
import { ConversacionActiva } from './features/canales/ConversacionActiva';
import type { Conversacion } from './features/canales/conversaciones';
import { PanelContexto } from './features/canales/PanelContexto';
import BarraFrescura from './features/canales/BarraFrescura';
import { EstadoWhatsapp } from './features/whatsapp/EstadoWhatsapp';
import { FichaContacto } from './features/cerberus/FichaContacto';
import { VistaDashboard } from './features/dashboard/VistaDashboard';
import { VistaEmbudo } from './features/vistas/VistaEmbudo';
import { VistaPersonas } from './features/vistas/VistaPersonas';
import { VistaAgenda } from './features/agenda/VistaAgenda';
import { VistaCorreos } from './features/correos/VistaCorreos';
import { pendientesQueApuran, useAgenda } from './features/agenda/agenda';
import { Login } from './features/auth/Login';
import { useSesion } from './features/auth/sesion';
import { useTiempoReal } from './lib/datos/tiempoReal';

/**
 * HERMES — la mesa de la vendedora.
 *
 * UN espacio con vistas (ADR 0002), conmutadas por estado — sin router. La
 * navegación es un RIEL vertical de íconos a la izquierda (elegante, como los
 * CRM que el dueño mira de referencia): el escudo arriba, las vistas al medio,
 * la vendedora abajo. El Dashboard es la página principal: el radar de leads
 * cayendo. Se trabaja en la Bandeja; las demás vistas miran.
 */

/** `WebkitAppRegion` no está en los tipos de CSSProperties; Electron sí lo lee. */
const ARRASTRABLE = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_ARRASTRABLE = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const VISTAS = [
  { id: 'dashboard', label: 'Dashboard', icono: LayoutDashboard },
  { id: 'embudo', label: 'Pipeline', icono: Columns3 },
  { id: 'personas', label: 'Contactos', icono: Users },
  { id: 'bandeja', label: 'Mensajes', icono: MessagesSquare },
  { id: 'correos', label: 'Correos', icono: Mail },
  { id: 'agenda', label: 'Agenda', icono: AlarmClock },
] as const;

type Vista = (typeof VISTAS)[number]['id'];

/** Iniciales del avatar: "Ana Lucía" → "AL". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return nombre.slice(0, 2).toUpperCase();
}

export default function App() {
  const { vendedora, cargando, entrar, salir } = useSesion();
  const [abierta, setAbierta] = useState<Conversacion | null>(null);
  const [vista, setVista] = useState<Vista>('dashboard');
  const [telefonoPersonas, setTelefonoPersonas] = useState<string | null>(null);

  // El nervio en vivo: escucha el stream del server e invalida lo que cambió.
  useTiempoReal();

  // El badge de la Agenda: cuántas promesas apuran (vencidas + de hoy).
  // Dorado, porque es TIEMPO — la única acepción del oro en Hermes.
  const { agenda } = useAgenda();
  const apuran = pendientesQueApuran(agenda.data?.recordatorios);

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

  function buscarPersona(telefono: string) {
    setTelefonoPersonas(telefono);
    setVista('personas');
  }

  const vistaActiva = VISTAS.find((v) => v.id === vista)!;

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {/* ── EL RIEL: la navegación elegante, vertical, de íconos ── */}
      <nav
        aria-label="Vistas"
        className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-card pb-3 pt-9"
        style={ARRASTRABLE}
      >
        <div className="mb-4" title="Hermes · Goberna">
          <Escudo size={26} />
        </div>

        <div className="flex flex-col gap-1" style={NO_ARRASTRABLE}>
          {VISTAS.map((v) => {
            const Icono = v.icono;
            const activa = vista === v.id;
            return (
              <button
                key={v.id}
                type="button"
                title={v.label}
                onClick={() => setVista(v.id)}
                className={
                  'relative flex size-10 items-center justify-center rounded-xl transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                  (activa
                    ? 'bg-navy text-white shadow-[0_4px_14px_-4px_rgba(14,42,82,0.55)]'
                    : 'text-muted-foreground hover:bg-secondary hover:text-navy')
                }
              >
                <Icono size={18} strokeWidth={activa ? 2.2 : 1.8} />
                {v.id === 'agenda' && apuran > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-gold px-1 font-mono text-[9px] font-bold text-navy ring-2 ring-card">
                    {apuran}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-2" style={NO_ARRASTRABLE}>
          <span
            title={vendedora.nombre}
            className="flex size-9 items-center justify-center rounded-[12px] bg-secondary font-heading text-[11px] font-bold text-navy"
          >
            {iniciales(vendedora.nombre)}
          </span>
          <button
            type="button"
            onClick={salir}
            title="Salir"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <LogOut size={14} />
          </button>
        </div>
      </nav>

      {/* ── EL CONTENIDO: barra fina arriba (título + salud) y la vista ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center gap-3 border-b border-border bg-card/95 px-4 pb-2 pt-8 backdrop-blur"
          style={ARRASTRABLE}
          data-tauri-drag-region
        >
          <h1 className="font-heading text-sm font-bold tracking-tight text-navy">{vistaActiva.label}</h1>
          <div className="ml-auto flex items-center gap-3" style={NO_ARRASTRABLE}>
            <BarraFrescura />
            <EstadoWhatsapp />
          </div>
        </header>

        <div
          key={vista}
          className="flex min-h-0 flex-1 flex-col duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in fade-in slide-in-from-bottom-1"
        >
        {vista === 'dashboard' && (
          <VistaDashboard
            onAbrir={abrirConversacion}
            onBuscarPersona={buscarPersona}
            onIrAgenda={() => setVista('agenda')}
            miVendedora={vendedora.id}
          />
        )}

        {vista === 'bandeja' && (
          <div className="flex min-h-0 flex-1 gap-3 p-3">
            <main className="min-h-0 w-[25rem] shrink-0">
              <ColaUnificada seleccionada={abierta?.clave ?? null} onSeleccionar={setAbierta} />
            </main>
            <section className="min-h-0 min-w-0 flex-1">
              <ConversacionActiva conversacion={abierta} onCerrar={() => setAbierta(null)} />
            </section>
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
        {vista === 'personas' && <VistaPersonas telefonoInicial={telefonoPersonas} />}
        {vista === 'correos' && <VistaCorreos />}
        </div>
      </div>
    </div>
  );
}
