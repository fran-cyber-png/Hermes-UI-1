import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquarePlus, Search, X } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { api } from '../../lib/datos/cliente';
import { hace, useFrescura } from '../../lib/datos/frescura';
import { useSelloDeViejo } from '../../lib/datos/useSelloDeViejo';
import { SelloDeAntes } from '../../components/SelloDeAntes';
import { useSesionWa } from '../whatsapp/conversacionWa';
import { pendientesQueApuran, useAgenda } from '../agenda/agenda';
import type { DatosDashboard } from '../dashboard/dashboard';
import type { Intencion } from './types';
import { useConversaciones, type Conversacion } from './conversaciones';
import { FilaConversacion } from './FilaConversacion';
import { nombreCanal } from './BadgeCanal';

const FILTROS: { valor: Intencion; label: string; vacio: string }[] = [
  { valor: 'puedo-escribirle', label: 'Les puedo escribir', vacio: 'Nadie tiene la ventana abierta ahora mismo. Estás al día.' },
  { valor: 'pide-info', label: 'Piden info', vacio: 'Nadie pidió información todavía.' },
  { valor: '', label: 'Todo', vacio: 'No entró nada por ningún canal.' },
];

/** Solo anima lo que llegó AHORA (SSE): lo viejo que entra por «Ver más» no. */
const RECIEN_LLEGADA_MS = 10 * 60_000;

/**
 * LA COLA UNIFICADA — el corazón de Hermes.
 *
 * Una sola lista con los cuatro canales mezclados (comentarios FB/IG, DMs de
 * Messenger, chats de WhatsApp), ordenada por el servidor según la urgencia
 * canónica de seis niveles (`server/src/cola/urgencia.ts`): vivo, vencido,
 * expira, espera, silencio, resto — la misma que el radar del Dashboard. El
 * canal es una insignia, no una columna: nadie decide a quién responder según
 * por dónde le escribieron.
 *
 * Sucedió a la vieja `Bandeja` (archivada, ver ADR 0004): mismo esqueleto —
 * filtros por intención, «Ver más», vacíos honestos — pero contra
 * `/api/conversaciones`, una fila por conversación.
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
  const [intencion, setIntencion] = useLocalStorage<Intencion>('hermes.colaFiltro', 'puedo-escribirle');
  const { items, total, hayMas, cargando, cargandoMas, cargarMas, traidoEn, actualizando } =
    useConversaciones(intencion);
  // Al abrir la app la cola viene del caché persistido: hasta que llegue lo
  // fresco hay que decir de cuándo es lo que se está mirando.
  const deAntes = useSelloDeViejo(traidoEn);
  const filtro = FILTROS.find((f) => f.valor === intencion) ?? FILTROS[0];

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

  // Cierre de edición despachada: la cola en cero CON datos frescos es trabajo
  // terminado, y se celebra con la cifra del día + la siguiente jugada.
  const despachada =
    !cargando && visibles.length === 0 && !busqueda && intencion === 'puedo-escribirle' && frescura?.fresca === true;

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

  // Fila pin de orientación: la conversación abierta no aparece bajo el filtro
  // (o la búsqueda) activo — se fija arriba para que la vendedora no la pierda.
  const noEstaEnLista = seleccionada != null && !cargando && !visibles.some((c) => c.clave === seleccionada);
  const pinVisible = noEstaEnLista && (busqueda !== '' || intencion !== '');
  const canalPin =
    conversacionAbierta?.canal ?? (seleccionada?.startsWith('conv:') ? seleccionada.split(':')[1] : null);
  const origenPin = canalPin ? nombreCanal(canalPin) : 'un comentario';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* Header fusionado: búsqueda arriba, filtros + total abajo, un solo bloque. */}
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

        <div className="flex items-center justify-between gap-2">
          {/* Los filtros no se encogen nunca: son el control principal de la cola. */}
          <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                onClick={() => setIntencion(f.valor)}
                className={
                  'rounded-md px-2.5 py-1 text-xs font-bold transition-colors ' +
                  (intencion === f.valor ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {f.label}
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onTeclasLista}>
        {pinVisible && (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-l-[3px] border-border border-l-navy bg-card py-2.5 pl-3 pr-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              Abierta desde {origenPin} — no coincide con {busqueda ? 'tu búsqueda' : `«${filtro.label}»`}
            </p>
            <button
              type="button"
              onClick={() => (busqueda ? setBusqueda('') : setIntencion(''))}
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
          ) : vacioPorAtraso ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-bold text-foreground">No hay nada acá, pero no es porque estés al día.</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                La última captura fue {hace(frescura.horasDesdeIngesta)}. Hay{' '}
                {frescura.total.toLocaleString('es')} interacciones guardadas, pero ninguna es lo bastante
                reciente como para entrar en este filtro.
              </p>
            </div>
          ) : despachada ? (
            <div className="px-6 py-14 text-center">
              {typeof nHoy === 'number' && nHoy > 0 ? (
                <>
                  <p className="font-heading text-3xl font-bold tabular-nums text-navy">
                    Respondiste a {nHoy} {nHoy === 1 ? 'persona' : 'personas'} hoy
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">Estás al día: nadie espera respuesta ahora mismo.</p>
                </>
              ) : (
                <>
                  <p className="font-heading text-3xl font-bold text-navy">Estás al día</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">Nadie tiene la ventana abierta ahora mismo.</p>
                </>
              )}
              {nPideInfo > 0 ? (
                <button
                  type="button"
                  onClick={() => setIntencion('pide-info')}
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
          ) : intencion === 'puedo-escribirle' && frescura == null ? (
            /* La frescura todavía no llegó: sin ella no se puede afirmar «al día». */
            <div className="space-y-2 px-6 py-12" aria-hidden="true">
              <div className="mx-auto h-3 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mx-auto h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">{filtro.vacio}</p>
              {intencion === 'pide-info' ? (
                <button
                  type="button"
                  onClick={() => setIntencion('')}
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
            <FilaConversacion
              key={c.clave}
              c={c}
              seleccionada={seleccionada === c.clave}
              onAbrir={onSeleccionar}
              etapa={etapas?.[c.persona_id ?? '']}
              mostrarPideInfo={intencion !== 'pide-info'}
              esNueva={esNueva(c)}
              indice={i}
              tabIndex={i === idxSeguro ? 0 : -1}
              onFocus={() => setIdxFoco(i)}
              ref={(el) => {
                refsFilas.current[i] = el;
              }}
            />
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
    </div>
  );
}
