import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, MessageSquareText, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { useConversaciones, type Conversacion } from '../canales/conversaciones';
import { useDashboard } from '../dashboard/dashboard';
import { BadgeCanal } from '../canales/BadgeCanal';
import { Intereses } from '../gestion/Intereses';
import { hace } from '../../lib/datos/frescura';
import { ETAPAS, type Etapa } from '../../lib/etapas';
import { tempBorde, tempClass } from '../../lib/formato';
import { decidirDrop, decidirRebote, reintentoTrasInteres } from './compuertas';
import { ModalInteresCotizado, ModalVentaCierre } from './ModalesCompuerta';

/**
 * EL EMBUDO — kanban real, con las etapas del negocio y sus compuertas.
 *
 *   Interesados → Contactados → Cotizados → Cierre · Perdidos
 *
 * Se ARRASTRA: soltar una tarjeta en otra columna registra la gestión (con
 * actualización optimista: la tarjeta se muda ya). El embudo no miente, y las
 * compuertas GUÍAN en vez de rebotar (#60): a Cotizados no se pasa sin un
 * curso de interés — si falta, un modal lo pide ahí mismo y al guardarlo el
 * movimiento se completa solo; a Cierre no se pasa declarándolo — soltar ahí
 * abre el formulario de Registrar venta con la conversación precargada, y es
 * la venta la que mueve el lead (el server asienta `cierre` al crearla). Las
 * compuertas del server no se relajan: los modales las satisfacen. El `aviso`
 * de texto queda como fallback (error de red), no como la vía principal.
 * La manchette de cada columna es honesta: si hay más historia en el server
 * que tarjetas cargadas, dice «N de M» (o «N+» cuando el total con la misma
 * definición no existe — ver nota en `totales`).
 */

const COLUMNAS: { id: Etapa; titulo: string; pista: string }[] = [
  { id: 'interesado', titulo: 'Interesados', pista: 'Levantaron la mano. Todo lo nuevo cae acá.' },
  { id: 'contactado', titulo: 'Contactados', pista: 'Ya les hablamos.' },
  { id: 'cotizado', titulo: 'Cotizados', pista: 'Compuerta: exige curso de interés.' },
  { id: 'cierre', titulo: 'Cierre', pista: 'Se llega registrando la venta.' },
  { id: 'perdido', titulo: 'Perdidos', pista: 'Se enfrió o dijo que no.' },
];

/** La grilla real: 4 columnas de trabajo + Perdidos como cajón angosto. */
const GRID =
  'grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(190px,1fr))_minmax(150px,0.75fr)] gap-2.5 overflow-x-auto';

function TarjetaEmbudo({
  c,
  onAbrir,
  alArrastrar,
  alTerminar,
  arrastrando,
  rebotada,
}: {
  c: Conversacion;
  onAbrir: (c: Conversacion) => void;
  alArrastrar: (c: Conversacion) => void;
  alTerminar: () => void;
  arrastrando: boolean;
  rebotada: boolean;
}) {
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        alArrastrar(c);
      }}
      onDragEnd={alTerminar}
      className={
        'group cursor-grab rounded-xl border-l-2 bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(14,42,82,0.06)] transition-[box-shadow,opacity,transform] duration-200 ease-house hover:shadow-panel active:cursor-grabbing ' +
        tempBorde(c.referencia) +
        (arrastrando ? ' scale-[0.98] opacity-40' : '') +
        (rebotada ? ' ring-1 ring-temp-frio' : '')
      }
    >
      <div className="flex items-center gap-2">
        <BadgeCanal canal={c.canal} />
        <span className="min-w-0 truncate font-heading text-[13px] font-semibold text-foreground">
          {c.persona_nombre ?? c.persona_id ?? 'Sin nombre'}
        </span>
        <span className={'ml-auto shrink-0 font-mono text-[11px] tabular-nums ' + tempClass(c.referencia)}>
          {hace(horas)}
        </span>
        <button
          type="button"
          title="Abrir en la Bandeja"
          onClick={() => onAbrir(c)}
          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-[color,background-color,opacity] duration-200 group-hover:opacity-100 hover:bg-secondary hover:text-navy focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.96]"
        >
          <MessageSquareText size={13} />
        </button>
      </div>
      {c.texto && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{c.texto}</p>}
      <Intereses clave={c.clave} compacto />
    </div>
  );
}

export function VistaEmbudo({
  onAbrir,
  onAgendarBienvenida,
}: {
  onAbrir: (c: Conversacion) => void;
  /** La siguiente jugada del recibo de venta (cae en la Agenda vía puente). */
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  const qc = useQueryClient();
  const { items, total, cargando, hayMas, cargandoMas, cargarMas } = useConversaciones('');
  // Comparte la queryKey ['dashboard'] con el Dashboard: es cache, no una llamada nueva.
  const dashboard = useDashboard();
  const [arrastrada, setArrastrada] = useState<Conversacion | null>(null);
  const [sobre, setSobre] = useState<Etapa | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rebotada, setRebotada] = useState<string | null>(null);
  const timerRebote = useRef<number | null>(null);
  /**
   * La tarjeta que la compuerta de Cotizados dejó ESPERANDO: se queda a la
   * vista en la columna destino mientras el modal pide el curso; `previo` es
   * la foto para devolverla si la vendedora cancela.
   */
  const [pendienteInteres, setPendienteInteres] = useState<{
    c: Conversacion;
    previo?: { etapas: Record<string, string> };
  } | null>(null);
  /** La conversación soltada en Cierre: abre el formulario de Registrar venta. */
  const [ventaPara, setVentaPara] = useState<Conversacion | null>(null);

  const etapas = useQuery({
    queryKey: ['embudo', 'etapas'],
    queryFn: () => api<{ etapas: Record<string, string> }>('/api/gestiones/etapas'),
  });


  /**
   * Totales por etapa del server (`data.embudo` del Dashboard). Paridad
   * VERIFICADA en código: ambas fuentes cuentan «última fila de gestiones por
   * clave, normalizada nuevo→interesado / venta→cierre» (gestiones.ts GET
   * /etapas y dashboard.ts calculan sobre la misma query). La ÚNICA
   * divergencia es Interesados: el kanban suma también las conversaciones SIN
   * gestión (fallback), y el embudo del server no — por eso esa columna nunca
   * dice «N de M»: dice «N+».
   */
  const totales = dashboard.data?.embudo;

  function marcarRebote(clave: string) {
    setRebotada(clave);
    if (timerRebote.current != null) window.clearTimeout(timerRebote.current);
    timerRebote.current = window.setTimeout(() => setRebotada(null), 1500);
  }

  const mover = useMutation({
    mutationFn: (v: { c: Conversacion; etapa: Etapa }) =>
      api('/api/gestiones', {
        method: 'POST',
        body: JSON.stringify({
          clave: v.c.clave,
          canal: v.c.canal,
          personaId: v.c.persona_id,
          personaNombre: v.c.persona_nombre,
          numeroPropio: v.c.numero_propio,
          etapa: v.etapa,
        }),
      }),
    // Optimista: la tarjeta se muda al soltar; si la compuerta rechaza, vuelve sola.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['embudo', 'etapas'] });
      const previo = qc.getQueryData<{ etapas: Record<string, string> }>(['embudo', 'etapas']);
      qc.setQueryData<{ etapas: Record<string, string> }>(['embudo', 'etapas'], (d) => ({
        etapas: { ...(d?.etapas ?? {}), [v.c.clave]: v.etapa },
      }));
      return { previo };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['embudo'] });
      void qc.invalidateQueries({ queryKey: ['gestiones'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setAviso(null);
    },
    onError: (err, v, ctx) => {
      const r = decidirRebote({
        destino: v.etapa,
        status: err instanceof ErrorApi ? err.status : null,
        mensaje: err instanceof ErrorApi ? err.message : null,
      });
      if (r.accion === 'modal-interes') {
        // La compuerta pide el interés: la tarjeta se queda esperando en
        // Cotizados mientras el modal lo registra. Recién si cancela, vuelve.
        setPendienteInteres({ c: v.c, previo: ctx?.previo });
        return;
      }
      if (ctx?.previo !== undefined) qc.setQueryData(['embudo', 'etapas'], ctx.previo);
      else void qc.invalidateQueries({ queryKey: ['embudo', 'etapas'] });
      // El fallback de siempre (red, validación): el motivo queda a la vista
      // hasta el próximo arrastre o hasta cerrarlo — nada se autodestruye por reloj.
      setAviso(r.mensaje);
      marcarRebote(v.c.clave);
    },
  });

  /** La vendedora desistió del interés: la tarjeta vuelve a su columna, explícitamente. */
  function cancelarInteres() {
    if (!pendienteInteres) return;
    const { c, previo } = pendienteInteres;
    setPendienteInteres(null);
    if (previo !== undefined) qc.setQueryData(['embudo', 'etapas'], previo);
    else void qc.invalidateQueries({ queryKey: ['embudo', 'etapas'] });
    marcarRebote(c.clave);
  }

  /** El interés quedó guardado: el drag original se completa solo (reintento del POST). */
  function guardadoInteres() {
    if (!pendienteInteres) return;
    const { c, previo } = pendienteInteres;
    setPendienteInteres(null);
    // El reintento parte de la foto REAL (no de la optimista que quedó a la
    // vista): así, si vuelve a fallar, el rollback devuelve la tarjeta bien.
    if (previo !== undefined) qc.setQueryData(['embudo', 'etapas'], previo);
    const vars = reintentoTrasInteres(c);
    if (vars) mover.mutate(vars);
  }

  const porEtapa = useMemo(() => {
    const mapa = new Map<Etapa, Conversacion[]>(COLUMNAS.map((e) => [e.id, []]));
    for (const c of items) {
      const declarada = etapas.data?.etapas[c.clave] ?? 'interesado';
      const etapa = (ETAPAS as readonly string[]).includes(declarada) ? (declarada as Etapa) : 'interesado';
      mapa.get(etapa)!.push(c);
    }
    return mapa;
  }, [items, etapas.data]);

  const etapaArrastrada = arrastrada
    ? ((etapas.data?.etapas[arrastrada.clave] ?? 'interesado') as Etapa)
    : null;

  function empezarArrastre(c: Conversacion) {
    setArrastrada(c);
    setAviso(null); // el próximo arrastre limpia el aviso de compuerta
    setRebotada(null);
  }

  function terminarArrastre() {
    setArrastrada(null);
    setSobre(null);
  }

  function soltar(etapa: Etapa) {
    if (!arrastrada) return;
    const c = arrastrada;
    setArrastrada(null);
    setSobre(null);
    const actual = (etapas.data?.etapas[c.clave] ?? 'interesado') as Etapa;
    const d = decidirDrop({ actual, destino: etapa, canal: c.canal });
    if (d.accion === 'nada') return;
    if (d.accion === 'modal-venta') {
      // El cierre no se declara: se gana registrando la venta (la compuerta del
      // server queda intacta). El modal abre el formulario con la conversación
      // precargada; al crear la venta, el server asienta `cierre` solo.
      setVentaPara(c);
      return;
    }
    if (d.accion === 'abrir') {
      // Comentario FB/IG: sin teléfono no hay ficha ni venta — a la Bandeja.
      onAbrir(c);
      return;
    }
    mover.mutate({ c, etapa: d.etapa });
  }

  const restantes = total > items.length ? total - items.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2.5 flex min-h-7 shrink-0 items-center gap-3 px-1">
        {arrastrada != null && (
          <p className="text-xs text-muted-foreground">
            A <span className="font-semibold">Cotizados</span> con curso de interés; a{' '}
            <span className="font-semibold">Cierre</span>, registrando la venta. Si falta algo, se
            pide al soltar.
          </p>
        )}
        {hayMas && (
          <button
            type="button"
            onClick={cargarMas}
            disabled={cargandoMas}
            className="ml-auto rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98] disabled:opacity-50"
          >
            {cargandoMas ? 'Trayendo…' : restantes > 0 ? `hay ${restantes} más` : 'Traer más'}
          </button>
        )}
      </div>

      {etapas.isError && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2 text-xs text-foreground">
          <AlertTriangle size={14} className="shrink-0 text-temp-frio" />
          <span className="flex-1">
            No se pudieron cargar las etapas — las tarjetas se ven todas en Interesados, no es que estén ahí.
          </span>
          <button
            type="button"
            onClick={() => void etapas.refetch()}
            className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold transition-colors hover:border-primary hover:text-foreground"
          >
            Reintentar
          </button>
        </div>
      )}

      {aviso && (
        <div
          aria-live="polite"
          className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2 text-xs text-foreground"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-temp-frio" />
          <span className="flex-1">{aviso}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setAviso(null)}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {cargando ? (
        <div className={GRID}>
          {[3, 2, 3, 2, 2].map((bloques, i) => (
            <div key={i} className="flex min-h-0 flex-col gap-2 rounded-2xl bg-secondary/30 p-2">
              <div className="h-6 w-3/5 animate-pulse rounded-md bg-secondary/70" />
              {Array.from({ length: bloques }, (_, j) => (
                <div key={j} className="h-16 animate-pulse rounded-xl bg-secondary/60" />
              ))}
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-sm font-semibold text-foreground">El embudo está vacío.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Cuando alguien escriba por WhatsApp, Facebook o Instagram, cae solo en Interesados. Mientras
            tanto, revisá Mensajes por si alguien espera respuesta.
          </p>
        </div>
      ) : (
        <div className={GRID}>
          {COLUMNAS.map((col) => {
            const enEtapa = porEtapa.get(col.id) ?? [];
            const n = enEtapa.length;
            const esDestino = sobre === col.id && arrastrada != null;
            const esPerdidos = col.id === 'perdido';
            const esCierre = col.id === 'cierre';
            // «N de M» solo cuando la definición cuadra (nunca en Interesados,
            // ver nota en `totales`) y el total del server no quedó atrás.
            const totalServer = col.id === 'interesado' || !totales ? undefined : (totales[col.id] ?? 0);
            const muestraDe = hayMas && totalServer != null && totalServer >= n;
            const muestraMas = hayMas && !muestraDe;
            const faltan = muestraDe && totalServer != null ? totalServer - n : 0;
            const fondo = esDestino ? 'bg-secondary' : esPerdidos ? 'bg-transparent' : 'bg-secondary/50';
            return (
              <section
                key={col.id}
                aria-label={col.titulo}
                onDragOver={(e) => {
                  e.preventDefault();
                  setSobre(col.id);
                }}
                onDragLeave={() => setSobre((s) => (s === col.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  soltar(col.id);
                }}
                className={
                  'flex min-h-0 flex-col rounded-2xl p-2 transition-colors ' +
                  fondo +
                  (esPerdidos ? ' border border-dashed border-border' : '') +
                  (esDestino && !esCierre ? ' ring-1 ring-primary/40' : '')
                }
              >
                <header className="px-1.5 pb-2 pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      aria-label={muestraMas ? `al menos ${n}` : undefined}
                      className={
                        'font-heading text-xl font-bold tabular-nums ' +
                        (esPerdidos ? 'text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {n}
                      {muestraMas ? '+' : ''}
                    </span>
                    {muestraDe && (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        de {totalServer}
                      </span>
                    )}
                    <h3
                      className={
                        'font-heading text-[13px] font-bold ' +
                        (esCierre ? 'text-navy' : esPerdidos ? 'text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {col.titulo}
                    </h3>
                    {esCierre && n > 0 && <Check size={13} strokeWidth={3} className="self-center text-success" />}
                  </div>
                  {esCierre && arrastrada != null && etapaArrastrada !== 'cierre' ? (
                    <p className="mt-0.5 text-xs font-semibold leading-tight text-navy">
                      Soltá para registrar la venta
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{col.pista}</p>
                  )}
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5">
                  {enEtapa.map((c) => (
                    <TarjetaEmbudo
                      key={c.clave}
                      c={c}
                      onAbrir={onAbrir}
                      alArrastrar={empezarArrastre}
                      alTerminar={terminarArrastre}
                      arrastrando={arrastrada?.clave === c.clave}
                      rebotada={rebotada === c.clave}
                    />
                  ))}
                  {esDestino && (
                    <div className="rounded-xl border border-dashed border-primary/60 p-3 text-center text-[11px] text-primary">
                      Soltá acá
                    </div>
                  )}
                  {faltan > 0 && (
                    <button
                      type="button"
                      onClick={cargarMas}
                      disabled={cargandoMas}
                      className="rounded-xl border border-dashed border-border py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                    >
                      {cargandoMas ? 'Trayendo…' : `hay ${faltan} más`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Las compuertas guían: el modal pide lo que falta, ahí mismo. */}
      {pendienteInteres && (
        <ModalInteresCotizado c={pendienteInteres.c} onGuardado={guardadoInteres} onCancelar={cancelarInteres} />
      )}
      {ventaPara && (
        <ModalVentaCierre
          c={ventaPara}
          onCerrar={() => setVentaPara(null)}
          onAbrir={onAbrir}
          onAgendarBienvenida={onAgendarBienvenida}
        />
      )}
    </div>
  );
}
