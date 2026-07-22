import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { useSesionWa } from './features/whatsapp/conversacionWa';
import { useDashboard } from './features/dashboard/dashboard';
import { useTiempoReal } from './lib/datos/tiempoReal';
import type { Puente } from './lib/puente';

/**
 * HERMES — la mesa de la vendedora.
 *
 * UN espacio con vistas (ADR 0002), conmutadas por estado — sin router. La
 * navegación es un RIEL vertical a la izquierda: el escudo arriba, las vistas
 * al medio (ícono + nombre: nadie navega adivinando), la vendedora abajo.
 * El Dashboard es la página principal. Se trabaja en la Bandeja — que queda
 * SIEMPRE montada (oculta, no desmontada): el borrador del composer y el hilo
 * abierto sobreviven a cualquier paseo por las demás vistas.
 *
 * Teclado global (§2.8 del spec): ⌘1-6 cambia de vista · «/» va a la búsqueda
 * de la cola · Escape cierra la conversación (solo en Mensajes, nunca desde un
 * input) · «?» abre la cabina con el mapa completo.
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

/** ¿El teclado está "ocupado" escribiendo? Ningún atajo global pisa un input. */
function tecleandoEn(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && Boolean(t.closest('input, textarea, select, [contenteditable]'));
}

const ATAJOS: { tecla: string; que: string }[] = [
  ...VISTAS.map((v, i) => ({ tecla: `⌘${i + 1}`, que: v.label })),
  { tecla: '/', que: 'Buscar en la cola' },
  { tecla: '↑↓ ⏎', que: 'Recorrer la cola' },
  { tecla: 'Esc', que: 'Cerrar la conversación' },
  { tecla: '?', que: 'Esta ayuda' },
];

/** La cabina: el mapa de teclas, en voz de imprenta. Se abre con «?». */
function Cabina({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20" onClick={onCerrar} role="dialog" aria-modal="true" aria-label="Atajos de teclado">
      <div className="w-72 rounded-2xl bg-card p-5 shadow-panel animate-entrar" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-heading text-sm font-bold text-navy">La cabina</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Todo Hermes sin soltar el teclado.</p>
        <dl className="mt-3 space-y-1.5">
          {ATAJOS.map((a) => (
            <div key={a.tecla + a.que} className="flex items-center justify-between gap-3">
              <dt className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">{a.tecla}</dt>
              <dd className="text-xs text-muted-foreground">{a.que}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function App() {
  const { vendedora, cargando, sinServer, reintentar, entrar, salir } = useSesion();
  const [abierta, setAbierta] = useState<Conversacion | null>(null);
  const [vista, setVista] = useState<Vista>('dashboard');
  const [direccion, setDireccion] = useState<'abajo' | 'arriba'>('abajo');
  const [telefonoPersonas, setTelefonoPersonas] = useState<string | null>(null);
  const [cabina, setCabina] = useState(false);
  // El puente (§2.9): una vista le pasa el mando a otra; la destinataria lo consume y lo limpia.
  const [puente, setPuente] = useState<Puente | null>(null);
  // Contador-señal: cada drop en Cierre lo incrementa y la ficha abre el form de venta.
  const [senalVenta, setSenalVenta] = useState(0);
  const busquedaRef = useRef<HTMLInputElement>(null);
  const { data: sesionWa } = useSesionWa();
  const { data: dash } = useDashboard();

  // Objeto estable: la Agenda re-dispararía su efecto si la identidad cambiara por render.
  const crearInicialAgenda = useMemo(
    () => (puente?.tipo === 'agenda' ? { telefono: puente.telefono ?? undefined, nota: puente.nota } : null),
    [puente],
  );

  // El nervio en vivo: escucha el stream del server e invalida lo que cambió.
  useTiempoReal();

  // El badge de la Agenda: cuántas promesas apuran (vencidas + de hoy).
  // Dorado, porque es TIEMPO — la única acepción del oro en Hermes.
  const { agenda } = useAgenda();
  const apuran = pendientesQueApuran(agenda.data?.recordatorios);

  // La transición direccional: bajar en el riel entra desde abajo, subir desde arriba.
  function cambiarVista(destino: Vista) {
    const desde = VISTAS.findIndex((v) => v.id === vista);
    const hasta = VISTAS.findIndex((v) => v.id === destino);
    if (hasta !== desde) setDireccion(hasta > desde ? 'abajo' : 'arriba');
    setVista(destino);
  }

  // ── El teclado global (§2.8): la guarda va antes que todo. ──
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Escape cierra en orden: cabina → conversación abierta (solo en Mensajes).
        if (tecleandoEn(e)) return;
        if (cabina) {
          setCabina(false);
          return;
        }
        if (vista === 'bandeja') setAbierta(null);
        return;
      }
      // Los acordes con ⌘/Ctrl no escriben texto: pasan aun con el foco en un input.
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        cambiarVista(VISTAS[Number(e.key) - 1].id);
        return;
      }
      if (tecleandoEn(e)) return;
      if (e.key === '?') {
        e.preventDefault();
        setCabina((v) => !v);
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        cambiarVista('bandeja');
        // Doble RAF: la Bandeja está siempre montada pero oculta — hay que
        // esperar a que sea visible para que el foco agarre.
        requestAnimationFrame(() => requestAnimationFrame(() => busquedaRef.current?.focus()));
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, cabina, abierta]);

  if (cargando) {
    // El esqueleto con la anatomía del shell: riel, header, tres placas.
    return (
      <div className="flex h-dvh bg-background">
        <div className="w-[4.75rem] shrink-0 border-r border-border bg-card" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-14 shrink-0 border-b border-border bg-card" />
          <div className="flex-1 space-y-3 p-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-card" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!vendedora) {
    return <Login entrar={entrar} sinServer={sinServer} reintentar={reintentar} />;
  }

  // Abrir una conversación desde cualquier vista te trae a la Bandeja: es la
  // única vista donde se conversa. Las demás miran, esta trabaja.
  function abrirConversacion(c: Conversacion) {
    setAbierta(c);
    cambiarVista('bandeja');
  }

  function buscarPersona(telefono: string) {
    setTelefonoPersonas(telefono);
    cambiarVista('personas');
  }

  // «Escribirle» desde una ficha: el chat nuevo, con el número propio de la
  // sesión WA (la misma fábrica que el + de la cola). Solo existe con WA conectado.
  const escribirA =
    sesionWa?.estado === 'conectado'
      ? (telefono: string) => {
          const tel = telefono.replace(/\D/g, '');
          const numeroPropio = sesionWa.telefono;
          abrirConversacion({
            clave: `conv:whatsapp:${tel}:${numeroPropio}`,
            canal: 'whatsapp',
            tipo: 'mensaje',
            persona_id: tel,
            persona_nombre: null,
            numero_propio: numeroPropio,
            texto: null,
            contexto_texto: null,
            respondida: false,
            ventana_abierta: false,
            pide_info: false,
            n: 0,
            referencia: new Date().toISOString(),
            ultimo_at: new Date().toISOString(),
            dias: 0,
            nivel: 2,
          });
        }
      : undefined;

  function mandarCorreoA(para: string) {
    setPuente({ tipo: 'correo', para });
    cambiarVista('correos');
  }

  function agendarBienvenida(telefono: string | null) {
    setPuente({ tipo: 'agenda', telefono, nota: 'Bienvenida al curso' });
    cambiarVista('agenda');
  }

  // Soltar en Cierre (kanban): el cierre no se declara, se gana registrando la
  // venta. Se abre la conversación en la Bandeja y la ficha recibe la señal de
  // abrir el formulario. En comentarios (sin ficha por teléfono) solo se abre.
  function registrarVentaDe(c: Conversacion) {
    abrirConversacion(c);
    if (c.canal === 'whatsapp') setSenalVenta((n) => n + 1);
  }

  const vistaActiva = VISTAS.find((v) => v.id === vista)!;
  const claseEntrada =
    'flex min-h-0 flex-1 flex-col duration-300 ease-house animate-in fade-in ' +
    (direccion === 'abajo' ? 'slide-in-from-bottom-1' : 'slide-in-from-top-1');

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {/* ── EL RIEL: ícono + nombre. Nadie navega adivinando. ── */}
      <nav
        aria-label="Vistas"
        className="flex w-[4.75rem] shrink-0 flex-col items-center border-r border-border bg-card pb-3 pt-9"
        style={ARRASTRABLE}
        data-tauri-drag-region
      >
        <div className="mb-3" title="Hermes · Goberna">
          <Escudo size={26} />
        </div>

        <div className="flex flex-col gap-1" style={NO_ARRASTRABLE}>
          {VISTAS.map((v, i) => {
            const Icono = v.icono;
            const activa = vista === v.id;
            return (
              <button
                key={v.id}
                type="button"
                title={`${v.label} · ⌘${i + 1}`}
                onClick={() => cambiarVista(v.id)}
                className={
                  'relative flex w-[4.25rem] flex-col items-center gap-0.5 rounded-xl py-1.5 transition-[color,background-color,box-shadow,transform] duration-200 ease-house active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                  (activa
                    ? 'bg-navy text-white shadow-[0_4px_14px_-4px_rgba(14,42,82,0.55)]'
                    : 'text-muted-foreground hover:bg-secondary hover:text-navy')
                }
              >
                <Icono size={17} strokeWidth={activa ? 2.2 : 1.8} />
                <span className="max-w-full truncate px-0.5 text-[11px] font-medium leading-none">{v.label}</span>
                {v.id === 'agenda' && apuran > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 font-mono text-[11px] font-bold leading-none text-navy ring-2 ring-card">
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
            className="flex size-9 items-center justify-center rounded-lg bg-secondary font-heading text-[11px] font-bold text-navy"
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

      {/* ── EL CONTENIDO: barra fina arriba (título + línea de salud) y la vista ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 pb-2 pt-8"
          style={ARRASTRABLE}
          data-tauri-drag-region
        >
          <h1 className="font-heading text-sm font-bold tracking-tight text-navy">{vistaActiva.label}</h1>
          <div className="ml-auto flex items-center gap-2" style={NO_ARRASTRABLE}>
            <BarraFrescura />
            <EstadoWhatsapp />
          </div>
        </header>

        {/* La Bandeja vive SIEMPRE montada: ocultarla no es desmontarla. */}
        <div className={vista === 'bandeja' ? 'flex min-h-0 flex-1 gap-3 p-3' : 'hidden'}>
          <main className="min-h-0 w-[25rem] shrink-0">
            <ColaUnificada
              seleccionada={abierta?.clave ?? null}
              onSeleccionar={setAbierta}
              conversacionAbierta={abierta}
              etapas={dash?.etapas}
              miVendedora={vendedora.id}
              onIrAgenda={() => cambiarVista('agenda')}
              inputRef={busquedaRef}
            />
          </main>
          <section className="min-h-0 min-w-0 flex-1">
            <ConversacionActiva conversacion={abierta} onCerrar={() => setAbierta(null)} />
          </section>
          {abierta && (
            <aside className="min-h-0 w-72 shrink-0">
              {abierta.canal === 'whatsapp' ? (
                <FichaContacto
                  conversacion={abierta}
                  onCorreo={mandarCorreoA}
                  onAgendarBienvenida={agendarBienvenida}
                  senalVenta={senalVenta}
                />
              ) : (
                <PanelContexto conversacion={abierta} />
              )}
            </aside>
          )}
        </div>

        {vista !== 'bandeja' && (
          <div key={vista} className={claseEntrada}>
            {vista === 'dashboard' && (
              <VistaDashboard
                onAbrir={abrirConversacion}
                onBuscarPersona={buscarPersona}
                onIrAgenda={() => cambiarVista('agenda')}
                miVendedora={vendedora.id}
                onMandarCorreo={mandarCorreoA}
              />
            )}
            {vista === 'embudo' && <VistaEmbudo onAbrir={abrirConversacion} onRegistrarVenta={registrarVentaDe} />}
            {vista === 'agenda' && (
              <VistaAgenda
                onAbrir={abrirConversacion}
                crearInicial={crearInicialAgenda}
                onCrearInicialUsado={() => setPuente(null)}
              />
            )}
            {vista === 'personas' && <VistaPersonas telefonoInicial={telefonoPersonas} onEscribir={escribirA} />}
            {vista === 'correos' && (
              <VistaCorreos correoInicial={puente?.tipo === 'correo' ? puente.para : null} onConsumido={() => setPuente(null)} />
            )}
          </div>
        )}
      </div>

      {cabina && <Cabina onCerrar={() => setCabina(false)} />}
    </div>
  );
}
