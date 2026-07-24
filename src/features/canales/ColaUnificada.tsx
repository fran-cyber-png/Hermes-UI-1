import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Mail, MailOpen, MessageSquarePlus, Pin, Search, Star, Tags, X } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { hace, useFrescura } from '../../lib/datos/frescura';
import { useSelloDeViejo } from '../../lib/datos/useSelloDeViejo';
import { SelloDeAntes } from '../../components/SelloDeAntes';
import { useSesionWa } from '../whatsapp/conversacionWa';
import { pendientesQueApuran, useAgenda } from '../agenda/agenda';
import { useCategorias } from '../gestion/categorias';
import { GestorCategorias } from '../gestion/GestorCategorias';
import { CLASE_FONDO, esColorCategoria } from '../gestion/paletaCategorias';
import type { DatosDashboard } from '../dashboard/dashboard';
import {
  FILTROS_SEC,
  KEY_TAB,
  TABS,
  migracionDesdeKeyVieja,
  migrarFiltroViejo,
  type FiltroSec,
  type Tab,
} from './cola';
import { useConversaciones, useEstadoConversacion, type Conversacion } from './conversaciones';
import { FilaConversacion } from './FilaConversacion';
import { ListaCategorias } from './ListaCategorias';
import { nombreCanal } from './BadgeCanal';

/** Solo anima lo que llegó AHORA (SSE): lo viejo que entra por «Ver más» no. */
const RECIEN_LLEGADA_MS = 10 * 60_000;

/**
 * LA COLA UNIFICADA — el corazón de Hermes, ahora la MESA DE TRABAJO (#49).
 *
 * Una sola lista con los cuatro canales mezclados (comentarios FB/IG, DMs de
 * Messenger, chats de WhatsApp), ordenada por el servidor según la urgencia
 * canónica de seis niveles (`server/src/cola/urgencia.ts`). El canal es una
 * insignia, no una columna.
 *
 * La cola potenciada suma la organización estilo WhatsApp Business: TABS
 * (`Todo · No leídos · Favoritos`) como eje, filtros secundarios (`Piden info`,
 * `Por vencer`), una BANDA de conversaciones fijadas arriba de todo, y el MODO
 * LISTAS: la lista de la izquierda se convierte en la lista de categorías, y
 * entrar a una la filtra (drill-down). El pin, la favorita y el «no leído» son
 * POR VENDEDORA (`estado_conversacion`).
 */
export function ColaUnificada({
  seleccionada,
  onSeleccionar,
  conversacionAbierta,
  etapas,
  miVendedora,
  onIrAgenda,
  inputRef,
}: {
  seleccionada: string | null;
  onSeleccionar: (c: Conversacion) => void;
  /** La conversación abierta completa (para la fila pin cuando el filtro la esconde). */
  conversacionAbierta?: Conversacion | null;
  /** Etapa del embudo por persona (teléfono/id) — chip en cada fila si llega. */
  etapas?: Record<string, string>;
  /** Username de la vendedora, para el «Respondiste a {n} personas hoy». */
  miVendedora?: string;
  /** Siguiente jugada del vacío despachado cuando no hay pide-info pendiente. */
  onIrAgenda?: () => void;
  /** Ref de la búsqueda, para el atajo «/» global (se cablea en el shell). */
  inputRef?: Ref<HTMLInputElement>;
}) {
  // El tab es el eje (persistido). El default dejó de ser `puedo-escribirle`:
  // `migrarFiltroViejo` mapea cualquier valor viejo/basura a un tab válido, así
  // el caché persistido no abre mostrando un filtro que ya no existe (#49).
  const [tabGuardado, setTab] = useLocalStorage<string>(KEY_TAB, 'todo');
  const tab: Tab = migrarFiltroViejo(tabGuardado);
  // Filtros secundarios y modo Listas: efímeros (la sesión arranca en limpio).
  const [filtroSec, setFiltroSec] = useState<FiltroSec>('');
  const [modoListas, setModoListas] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState<{ nombre: string; color: string } | null>(null);
  const [gestorAbierto, setGestorAbierto] = useState(false);

  // La key de la cola cambió con los tabs: quien venía usando la vieja tiene que
  // encontrar SU filtro, no un default mudo. Se traduce una vez, al montar.
  useEffect(() => {
    const migrado = migracionDesdeKeyVieja(
      (k) => {
        try {
          return window.localStorage.getItem(k);
        } catch {
          return null;
        }
      },
      (k) => {
        try {
          window.localStorage.removeItem(k);
        } catch {
          // Bloqueado: no es crítico, solo se reintentaría la próxima vez.
        }
      },
    );
    if (!migrado) return;
    setTab(migrado.tab);
    setFiltroSec(migrado.filtroSec);
    // Solo al montar: la migración es de una vez y borra su propia key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: catalogo = [] } = useCategorias();
  const estadoMut = useEstadoConversacion();
  const [avisoPin, setAvisoPin] = useState<string | null>(null);

  const { items, total, hayMas, cargando, cargandoMas, cargarMas, traidoEn, actualizando, sinEstado } =
    useConversaciones({ tab, filtroSec, categoria: categoriaActiva?.nombre ?? null });
  // Al abrir la app la cola viene del caché persistido: hasta que llegue lo
  // fresco hay que decir de cuándo es lo que se está mirando.
  const deAntes = useSelloDeViejo(traidoEn);
  const tabMeta = TABS.find((t) => t.valor === tab) ?? TABS[0];

  // Búsqueda: filtra lo YA cargado (nombre, teléfono, texto). Si no aparece,
  // «Buscar en más historia» trae más — honesto: busca en lo que hay, no en toda la base.
  const [busqueda, setBusqueda] = useState('');
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) =>
      [c.persona_nombre, c.persona_id, c.texto, c.contexto_texto].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [items, busqueda]);

  /**
   * El estado vacío NO puede decir «estás al día» si en realidad no estamos
   * mirando: cero filas significa o que no hay trabajo, o que la captura está
   * muerta — y sin este chequeo la pantalla elige siempre la versión que deja a
   * la vendedora tranquila mientras pierde gente.
   */
  const { data: frescura } = useFrescura();
  const vacioPorAtraso = frescura != null && !frescura.fresca && frescura.total > 0;

  // Cierre de edición despachada: la cola de «Todo» en cero CON datos frescos y
  // sin ningún filtro es trabajo terminado — la Deuda en cero. Se celebra con la
  // cifra del día + la siguiente jugada.
  const sinFiltros = tab === 'todo' && !filtroSec && !categoriaActiva;
  const despachada = !cargando && visibles.length === 0 && !busqueda && sinFiltros && frescura?.fresca === true;

  const statsDia = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DatosDashboard>('/api/dashboard'),
    enabled: despachada && miVendedora != null,
    staleTime: 30_000,
  });
  const nHoy = miVendedora
    ? statsDia.data?.porVendedora.find((v) => v.vendedora === miVendedora)?.conversaciones_hoy
    : undefined;

  const conteoPideInfo = useQuery({
    queryKey: ['conversaciones', 'conteo', 'pide-info'],
    queryFn: () => api<{ total?: number }>('/api/conversaciones?intencion=pide-info&limit=1&offset=0'),
    enabled: despachada,
    staleTime: 60_000,
  });
  const nPideInfo = conteoPideInfo.data?.total ?? 0;

  const { agenda } = useAgenda();
  const nAgenda = pendientesQueApuran(agenda.data?.recordatorios);

  // Solo la fila recién llegada por SSE entra animada: guardamos la foto de
  // claves del render anterior y marcamos lo que no estaba (y es reciente).
  const [clavesPrevias, setClavesPrevias] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (cargando) return;
    setClavesPrevias((prev) => {
      if (prev != null && prev.size === items.length && items.every((c) => prev.has(c.clave))) return prev;
      return new Set(items.map((c) => c.clave));
    });
  }, [items, cargando]);
  function esNueva(c: Conversacion): boolean {
    return (
      clavesPrevias != null &&
      !clavesPrevias.has(c.clave) &&
      Date.now() - new Date(c.ultimo_at).getTime() < RECIEN_LLEGADA_MS
    );
  }

  // Roving tabindex: una sola fila tabulable; ↑↓ mueven el foco, Enter abre.
  const refsFilas = useRef<(HTMLButtonElement | null)[]>([]);
  const [idxFoco, setIdxFoco] = useState(0);
  const idxSeguro = Math.min(idxFoco, Math.max(0, visibles.length - 1));
  function onTeclasLista(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    e.preventDefault();
    const proximo = Math.min(Math.max(idxSeguro + (e.key === 'ArrowDown' ? 1 : -1), 0), visibles.length - 1);
    setIdxFoco(proximo);
    refsFilas.current[proximo]?.focus();
  }

  // Chat nuevo: hablarle a alguien que NO está en la cola (un lead de landing
  // con teléfono, un referido). Abre el hilo vacío; el envío sigue pasando por
  // EnvioControlado — esto no manda nada solo.
  const { data: sesion } = useSesionWa();
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevoTel, setNuevoTel] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const conectado = sesion?.estado === 'conectado';

  function abrirChatNuevo() {
    const tel = nuevoTel.replace(/\D/g, '');
    if (tel.length < 8 || sesion?.estado !== 'conectado') return;
    const numeroPropio = sesion.telefono;
    onSeleccionar({
      clave: `conv:whatsapp:${tel}:${numeroPropio}`,
      canal: 'whatsapp',
      tipo: 'mensaje',
      persona_id: tel,
      persona_nombre: nuevoNombre.trim() || null,
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
      nivel: 5, // neutro: el «resto» de la escala 0–5; la cola recalcula el real al cargar
    });
    setNuevoAbierto(false);
    setNuevoTel('');
    setNuevoNombre('');
  }

  // Toggle de estado personal (pin / favorita / leído) desde la fila. Fijar con
  // el tope lleno rebota con 409: se muestra, no se esconde (política de la casa).
  function togglear(c: Conversacion, campo: 'fijada' | 'favorita') {
    setAvisoPin(null);
    estadoMut.mutate(
      { clave: c.clave, [campo]: !c[campo] },
      {
        onError: (e) => {
          if (e instanceof ErrorApi && e.status === 409) setAvisoPin(e.message);
        },
      },
    );
  }
  function marcarLeido(c: Conversacion, leido: boolean) {
    estadoMut.mutate({ clave: c.clave, leido });
  }

  // Fila pin de orientación: la conversación abierta no aparece bajo el filtro
  // (o la búsqueda) activo — se fija arriba para que la vendedora no la pierda.
  const noEstaEnLista = seleccionada != null && !cargando && !visibles.some((c) => c.clave === seleccionada);
  const hayFiltroActivo = tab !== 'todo' || filtroSec !== '' || categoriaActiva != null;
  const pinVisible = noEstaEnLista && (busqueda !== '' || hayFiltroActivo);
  const canalPin =
    conversacionAbierta?.canal ?? (seleccionada?.startsWith('conv:') ? seleccionada.split(':')[1] : null);
  const origenPin = canalPin ? nombreCanal(canalPin) : 'un comentario';

  /** Vuelve a la cola completa: sin búsqueda, sin filtros y fuera del modo Listas. */
  function limpiarFiltros() {
    setBusqueda('');
    setTab('todo');
    setFiltroSec('');
    setCategoriaActiva(null);
    setModoListas(false);
  }

  /**
   * Entrar a una lista arranca LIMPIO. Si no, los tabs y los filtros secundarios
   * quedan aplicados pero fuera de la vista (la cabecera del drill-down no los
   * muestra): «Precio (12)» abría con 2 filas y la vendedora no tenía cómo saber
   * que su tab «No leídos» de hace un rato seguía angostando.
   */
  function entrarACategoria(cat: { nombre: string; color: string }) {
    setTab('todo');
    setFiltroSec('');
    setBusqueda('');
    setCategoriaActiva(cat);
  }

  // ── MODO LISTAS: la lista de la izquierda se vuelve la lista de categorías ──
  if (modoListas && !categoriaActiva) {
    return (
      <>
        <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <button
              type="button"
              onClick={() => setModoListas(false)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary/10"
            >
              <ChevronLeft size={14} /> Cola
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ListaCategorias onElegir={entrarACategoria} onGestionar={() => setGestorAbierto(true)} />
          </div>
        </div>
        {gestorAbierto && <GestorCategorias onCerrar={() => setGestorAbierto(false)} />}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* Header: búsqueda + acciones arriba, tabs + filtros abajo, un solo bloque. */}
      <div className="shrink-0 border-b border-border px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 transition-[border-color,background-color] focus-within:border-primary focus-within:bg-card">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && busqueda) {
                  e.stopPropagation();
                  setBusqueda('');
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIdxFoco(0);
                  refsFilas.current[0]?.focus();
                }
              }}
              placeholder="Buscar nombre, teléfono o texto…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            type="button"
            title="Listas (organizá por categoría)"
            aria-label="Listas por categoría"
            onClick={() => setModoListas(true)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Tags size={15} />
          </button>
          <button
            type="button"
            title={conectado ? 'Chat nuevo (a un número que no está en la cola)' : 'WhatsApp no está conectado'}
            disabled={!conectado}
            onClick={() => setNuevoAbierto((v) => !v)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_rgba(37,99,235,0.5)] transition-[background-color,transform,box-shadow] hover:bg-primary-hover active:scale-[0.95] disabled:opacity-40 disabled:shadow-none"
          >
            <MessageSquarePlus size={15} />
          </button>
        </div>

        {nuevoAbierto && (
          <div className="mb-2 rounded-xl border border-border bg-muted/30 p-2">
            <div className="flex gap-1.5">
              <input
                value={nuevoTel}
                onChange={(e) => setNuevoTel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && abrirChatNuevo()}
                autoFocus
                inputMode="tel"
                placeholder="Teléfono con país, ej. 51 986…"
                className="w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary placeholder:font-sans"
              />
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && abrirChatNuevo()}
                placeholder="Nombre (opcional)"
                className="w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={abrirChatNuevo}
                disabled={nuevoTel.replace(/\D/g, '').length < 8}
                className="rounded-lg bg-navy px-3 text-xs font-bold text-white transition-[background-color,transform] hover:bg-navy/90 active:scale-[0.97] disabled:opacity-40"
              >
                Abrir
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Abre el hilo vacío. El mensaje lo escribís vos — nada sale solo.
            </p>
          </div>
        )}

        {categoriaActiva ? (
          /* Drill-down de categoría: cabecera de «volver» en vez de tabs. */
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setCategoriaActiva(null)}
              className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary/10"
            >
              <ChevronLeft size={14} /> Listas
            </button>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={
                  'size-2.5 shrink-0 rounded-full ' +
                  (esColorCategoria(categoriaActiva.color) ? CLASE_FONDO[categoriaActiva.color] : 'bg-muted')
                }
              />
              <span className="truncate text-sm font-bold capitalize text-navy">{categoriaActiva.nombre}</span>
            </span>
            {!cargando && total > 0 && (
              <span className="pr-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                {total.toLocaleString('es')}
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              {/* Tabs: el eje de la cola. No se encogen: son el control principal. */}
              <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5" role="tablist" aria-label="Filtrar la cola">
                {TABS.map((t) => (
                  <button
                    key={t.valor}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.valor}
                    onClick={() => setTab(t.valor)}
                    className={
                      'rounded-md px-2.5 py-1 text-xs font-bold transition-colors ' +
                      (tab === t.valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {deAntes ? (
                <SelloDeAntes texto={deAntes} actualizando={actualizando} />
              ) : (
                !cargando &&
                total > 0 && (
                  <span className="pr-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {total.toLocaleString('es')} en cola
                  </span>
                )
              )}
            </div>

            {/* Filtros secundarios: angostan dentro del tab. Chips sobrios, apagables. */}
            <div className="mt-2 flex items-center gap-1.5">
              {FILTROS_SEC.map((f) => {
                const activo = filtroSec === f.valor;
                return (
                  <button
                    key={f.valor}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => setFiltroSec(activo ? '' : f.valor)}
                    className={
                      'rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ' +
                      (activo
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground')
                    }
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {avisoPin && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-warning/10 px-3 py-2 text-[12px] font-medium text-warning-foreground">
          <span className="min-w-0 flex-1">{avisoPin}</span>
          <button type="button" onClick={() => setAvisoPin(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X size={13} />
          </button>
        </div>
      )}

      {/* El server no pudo leer el estado personal: la cola sirve igual, pero
          fijar/marcar no va a guardar nada. Se dice, no se esconde. */}
      {sinEstado && (
        <p className="border-b border-border bg-warning/10 px-3 py-2 text-[12px] font-medium text-warning-foreground">
          Fijar, favoritos y «sin leer» no están disponibles todavía — falta aplicar el cambio de base en
          el servidor. El resto de la cola funciona normal.
        </p>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onKeyDown={onTeclasLista}
        data-scroll-cola
      >
        {pinVisible && (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-l-[3px] border-border border-l-navy bg-card py-2.5 pl-3 pr-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              Abierta desde {origenPin} — no coincide con {busqueda ? 'tu búsqueda' : 'este filtro'}
            </p>
            <button
              type="button"
              onClick={() => (busqueda ? setBusqueda('') : limpiarFiltros())}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10"
            >
              {busqueda ? 'Limpiar búsqueda' : 'Ver en Todo'}
            </button>
          </div>
        )}

        {cargando ? (
          /* Skeleton con la anatomía real de la fila: avatar + dos barras. */
          <div aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-border py-3 pl-4 pr-3">
                <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <div className={'h-3 animate-pulse rounded bg-muted ' + (i % 2 ? 'w-2/5' : 'w-1/3')} />
                  <div className={'h-3 animate-pulse rounded bg-muted ' + (i % 3 ? 'w-4/5' : 'w-3/5')} />
                </div>
              </div>
            ))}
          </div>
        ) : visibles.length === 0 ? (
          busqueda ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              Ninguna conversación cargada coincide con «{busqueda}».
            </p>
          ) : vacioPorAtraso && sinFiltros ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-bold text-foreground">No hay nada acá, pero no es porque estés al día.</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                La última captura fue {hace(frescura.horasDesdeIngesta)}. Hay{' '}
                {frescura.total.toLocaleString('es')} interacciones guardadas, pero ninguna es lo bastante
                reciente como para entrar en la cola.
              </p>
            </div>
          ) : despachada ? (
            <div className="px-6 py-14 text-center">
              {typeof nHoy === 'number' && nHoy > 0 ? (
                <>
                  <p className="font-heading text-3xl font-bold tabular-nums text-navy">
                    Respondiste a {nHoy} {nHoy === 1 ? 'persona' : 'personas'} hoy
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">Estás al día: no queda deuda en la cola.</p>
                </>
              ) : (
                <>
                  <p className="font-heading text-3xl font-bold text-navy">Estás al día</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">No queda deuda en la cola ahora mismo.</p>
                </>
              )}
              {nPideInfo > 0 ? (
                <button
                  type="button"
                  onClick={() => setFiltroSec('pide-info')}
                  className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  Ver los {nPideInfo} que piden info →
                </button>
              ) : onIrAgenda ? (
                <button
                  type="button"
                  onClick={onIrAgenda}
                  className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  Revisá tu Agenda{nAgenda > 0 ? ` — ${nAgenda} para hoy` : ''} →
                </button>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  Revisá tu Agenda{nAgenda > 0 ? ` — ${nAgenda} para hoy` : ''}.
                </p>
              )}
            </div>
          ) : sinFiltros && frescura == null ? (
            /* La frescura todavía no llegó: sin ella no se puede afirmar «al día». */
            <div className="space-y-2 px-6 py-12" aria-hidden="true">
              <div className="mx-auto h-3 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mx-auto h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {categoriaActiva ? `Nadie en «${categoriaActiva.nombre}» todavía.` : filtroSec ? 'Nada con ese filtro.' : tabMeta.vacio}
              </p>
              {hayFiltroActivo ? (
                <button
                  type="button"
                  onClick={limpiarFiltros}
                  className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  Ver todo lo que entró
                </button>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Podés abrir un chat nuevo con el botón + de arriba.
                </p>
              )}
            </div>
          )
        ) : (
          visibles.map((c, i) => (
            <div key={c.clave} className="group/fila relative">
              <FilaConversacion
                c={c}
                seleccionada={seleccionada === c.clave}
                onAbrir={onSeleccionar}
                etapa={etapas?.[c.persona_id ?? '']}
                mostrarPideInfo={filtroSec !== 'pide-info'}
                catalogoCategorias={catalogo}
                esNueva={esNueva(c)}
                indice={i}
                tabIndex={i === idxSeguro ? 0 : -1}
                onFocus={() => setIdxFoco(i)}
                ref={(el) => {
                  refsFilas.current[i] = el;
                }}
              />
              {/* Acciones de organización: fuera del <button> de la fila (HTML no
                  anida botones). Aparecen al pasar el mouse; el estado activo
                  (fijada/favorita) queda visible siempre.

                  `pointer-events-none` mientras están invisibles, y `-auto` al
                  aparecer: si no, la esquina derecha de CADA fila se come el clic
                  con botones que no se ven — tocás para abrir la conversación y
                  terminás fijándola. El foco de teclado también los reactiva
                  (`focus-within` prende la opacidad y el hijo recupera el clic). */}
              <div
                data-activo={c.fijada || c.favorita || undefined}
                className="pointer-events-none absolute right-2.5 top-2 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/fila:pointer-events-auto group-hover/fila:opacity-100 data-[activo=true]:pointer-events-auto data-[activo=true]:opacity-100"
              >
                <button
                  type="button"
                  aria-label={c.fijada ? 'Soltar' : 'Fijar arriba'}
                  aria-pressed={c.fijada}
                  title={c.fijada ? 'Soltar' : 'Fijar arriba'}
                  onClick={() => togglear(c, 'fijada')}
                  className={
                    'rounded-md bg-card/90 p-1 shadow-sm transition-colors ' +
                    (c.fijada ? 'text-navy' : 'text-muted-foreground/60 hover:text-navy')
                  }
                >
                  <Pin size={13} fill={c.fijada ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  aria-label={c.favorita ? 'Quitar de favoritos' : 'Marcar favorita'}
                  aria-pressed={c.favorita}
                  title={c.favorita ? 'Favorita' : 'Marcar favorita'}
                  onClick={() => togglear(c, 'favorita')}
                  className={
                    'rounded-md bg-card/90 p-1 shadow-sm transition-colors ' +
                    (c.favorita ? 'text-navy' : 'text-muted-foreground/60 hover:text-navy')
                  }
                >
                  <Star size={13} fill={c.favorita ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  aria-label={c.no_leido ? 'Marcar leído' : 'Marcar sin leer'}
                  title={c.no_leido ? 'Marcar leído' : 'Marcar sin leer'}
                  onClick={() => marcarLeido(c, Boolean(c.no_leido))}
                  className="rounded-md bg-card/90 p-1 text-muted-foreground/60 shadow-sm transition-colors hover:text-primary"
                >
                  {c.no_leido ? <MailOpen size={13} /> : <Mail size={13} />}
                </button>
              </div>
            </div>
          ))
        )}

        {/* Fuera del ternario a propósito: también bajo el vacío de búsqueda,
            donde se vuelve la salida del dead-end. */}
        {!cargando && hayMas && (
          <div className="p-3">
            <button
              type="button"
              onClick={cargarMas}
              disabled={cargandoMas}
              className="w-full rounded-lg border border-border py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
            >
              {cargandoMas ? 'Cargando…' : busqueda && visibles.length === 0 ? 'Buscar en más historia' : 'Ver más'}
            </button>
          </div>
        )}
        {!cargando && !hayMas && busqueda !== '' && visibles.length === 0 && (
          <p className="pb-4 text-center text-[11px] text-muted-foreground">Ya está cargada toda la historia.</p>
        )}
      </div>

      {gestorAbierto && <GestorCategorias onCerrar={() => setGestorAbierto(false)} />}
    </div>
  );
}
