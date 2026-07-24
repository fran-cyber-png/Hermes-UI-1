import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, Inbox, MessageSquareText, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { useConversaciones, type Conversacion } from '../canales/conversaciones';
import { BadgeCanal } from '../canales/BadgeCanal';
import { Intereses } from '../gestion/Intereses';
import { hace } from '../../lib/datos/frescura';
import type { Etapa } from '../../lib/etapas';
import { tempBorde, tempClass } from '../../lib/formato';
import { decidirDrop, decidirRebote, reintentoTrasInteres } from './compuertas';
import { ModalInteresCotizado, ModalVentaCierre } from './ModalesCompuerta';
import {
  COLUMNAS_TRABAJO,
  etapaDeTarjeta,
  quedanPorTraer,
  repartirColumnas,
  type EtapaTrabajo,
} from './tablero';

/**
 * EL TABLERO HONESTO (#90) — el Pipeline que cuenta de verdad.
 *
 * Interesados DEJÓ de ser columna: es la bandeja compacta de arriba (contador
 * real + acceso a Mensajes, donde ese trabajo se hace de verdad). Las columnas
 * de trabajo — Contactados · Cotizados · Cierre · Perdidos — cargan POR columna
 * (`?etapa=`, #89) con su conteo real por etapa efectiva (ADR 0013) sobre la
 * ventana de 30 días. Murieron el fallback client-side a 'interesado', el
 * «N de M» que mezclaba universos y el «hay N más» que traía 30 del feed
 * entero (#9).
 *
 * Lo que NO cambió (#60): se ARRASTRA igual, y las compuertas GUÍAN en vez de
 * rebotar — a Cotizados sin curso de interés, un modal lo pide ahí mismo; a
 * Cierre no se pasa declarándolo, se llega registrando la venta (la compuerta
 * del server queda intacta). El movimiento optimista vive en `overrides`
 * (tablero.ts) hasta que la verdad del server refresca las columnas.
 */

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

/** La grilla real: 3 columnas de trabajo + Perdidos como cajón angosto. */
const GRID =
  'grid min-h-0 flex-1 grid-cols-[repeat(3,minmax(200px,1fr))_minmax(150px,0.7fr)] gap-2.5 overflow-x-auto';

export function VistaEmbudo({
  onAbrir,
  onAgendarBienvenida,
  onIrAMensajes,
}: {
  onAbrir: (c: Conversacion) => void;
  /** La siguiente jugada del recibo de venta (cae en la Agenda vía puente). */
  onAgendarBienvenida?: (telefono: string | null) => void;
  /** La bandeja de Interesados no se trabaja acá: este botón lleva a Mensajes. */
  onIrAMensajes?: () => void;
}) {
  const qc = useQueryClient();
  // Cada columna carga LO SUYO (#89): traer más de Contactados trae Contactados.
  const contactados = useConversaciones('', '', 'contactado');
  const cotizados = useConversaciones('', '', 'cotizado');
  const cierres = useConversaciones('', '', 'cierre');
  const perdidos = useConversaciones('', '', 'perdido');
  const porColumna: Record<EtapaTrabajo, ReturnType<typeof useConversaciones>> = {
    contactado: contactados,
    cotizado: cotizados,
    cierre: cierres,
    perdido: perdidos,
  };

  // Los conteos reales por etapa (misma ventana, mismo seam): vienen en la
  // primera página de cualquier columna. El de `interesado` es la bandeja.
  const conteos =
    contactados.conteos ?? cotizados.conteos ?? cierres.conteos ?? perdidos.conteos;

  const [arrastrada, setArrastrada] = useState<Conversacion | null>(null);
  const [sobre, setSobre] = useState<EtapaTrabajo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rebotada, setRebotada] = useState<string | null>(null);
  const timerRebote = useRef<number | null>(null);
  /**
   * Los movimientos optimistas en vuelo: clave → etapa destino. La tarjeta se
   * pinta ya en la columna nueva (repartirColumnas) y el override se levanta
   * cuando la verdad del server refresca las columnas — nunca se restaura una
   * foto local que podría deshacer movimientos de OTRAS tarjetas.
   */
  const [overrides, setOverrides] = useState<Record<string, Etapa>>({});
  /** La tarjeta que la compuerta de Cotizados dejó ESPERANDO el curso de interés. */
  const [pendienteInteres, setPendienteInteres] = useState<Conversacion | null>(null);
  /** La conversación soltada en Cierre: abre el formulario de Registrar venta. */
  const [ventaPara, setVentaPara] = useState<Conversacion | null>(null);

  const cargando = COLUMNAS_TRABAJO.every((c) => porColumna[c.id].cargando);

  // El server desplegado todavía no habla de etapas (#88/#89 sin deploy): sin
  // `etapa_efectiva` cada columna traería el feed entero y el tablero MENTIRÍA
  // con cara de honesto. Mejor decirlo que pintarlo.
  const servidorSinEtapas = COLUMNAS_TRABAJO.some((col) => {
    const primera = porColumna[col.id].items[0];
    return primera != null && primera.etapa_efectiva === undefined;
  });

  const repartidas = repartirColumnas(
    COLUMNAS_TRABAJO.map((col) => [col.id, porColumna[col.id].items] as const),
    overrides,
  );

  function quitarOverride(clave: string) {
    setOverrides((o) => {
      const { [clave]: _, ...resto } = o;
      return resto;
    });
  }

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
    // Optimista: la tarjeta se muda al soltar (override). Si algo falla, NO se
    // restaura ninguna foto local: se levanta el override y la verdad del
    // server pinta el mapa.
    onMutate: (v) => {
      setOverrides((o) => ({ ...o, [v.c.clave]: v.etapa }));
    },
    onSuccess: async (_r, v) => {
      setAviso(null);
      // El override se levanta DESPUÉS del refetch: si no, la tarjeta volvería
      // a la columna vieja un instante, hasta que llegue lo fresco.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['conversaciones'] }),
        qc.invalidateQueries({ queryKey: ['embudo'] }),
        qc.invalidateQueries({ queryKey: ['gestiones'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      quitarOverride(v.c.clave);
    },
    onError: (err, v) => {
      const r = decidirRebote({
        destino: v.etapa,
        status: err instanceof ErrorApi ? err.status : null,
        mensaje: err instanceof ErrorApi ? err.message : null,
        // Carrera real: este POST pudo quedar en vuelo mientras otro drop abría
        // el modal de venta. En ese caso: aviso, jamás dos modales apilados.
        ventaAbierta: ventaPara != null,
      });
      if (r.accion === 'modal-interes') {
        // La compuerta pide el interés: la tarjeta se queda esperando en
        // Cotizados (el override sigue puesto) mientras el modal lo registra.
        setPendienteInteres(v.c);
        return;
      }
      // El fallback de siempre (red, validación): se levanta el override y el
      // motivo queda a la vista hasta el próximo arrastre o hasta cerrarlo.
      quitarOverride(v.c.clave);
      setAviso(r.mensaje);
      marcarRebote(v.c.clave);
    },
  });

  /** La vendedora desistió del interés: se levanta el override y la tarjeta vuelve. */
  function cancelarInteres() {
    if (!pendienteInteres) return;
    const c = pendienteInteres;
    setPendienteInteres(null);
    quitarOverride(c.clave);
    marcarRebote(c.clave);
  }

  /**
   * El interés quedó guardado: el drag original se completa solo (reintento del
   * POST). Todo camino termina en el server: onSuccess o onError deciden.
   */
  function guardadoInteres() {
    if (!pendienteInteres) return;
    const vars = reintentoTrasInteres(pendienteInteres);
    setPendienteInteres(null);
    if (vars) mover.mutate(vars);
  }

  function empezarArrastre(c: Conversacion) {
    setArrastrada(c);
    setAviso(null); // el próximo arrastre limpia el aviso de compuerta
    setRebotada(null);
  }

  function terminarArrastre() {
    setArrastrada(null);
    setSobre(null);
  }

  function soltar(etapa: EtapaTrabajo) {
    if (!arrastrada) return;
    const c = arrastrada;
    setArrastrada(null);
    setSobre(null);
    const actual = etapaDeTarjeta(c, overrides);
    if (actual == null) return; // sin etapa del server no se mueve nada a ciegas
    const d = decidirDrop({
      actual,
      destino: etapa,
      canal: c.canal,
      // Con un modal de compuerta abierto no se suelta nada: no se apilan.
      modalAbierto: pendienteInteres != null || ventaPara != null,
    });
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

  const interesados = conteos?.interesado ?? 0;
  const etapaArrastrada = arrastrada ? etapaDeTarjeta(arrastrada, overrides) : null;
  const tableroVacio =
    !cargando && conteos != null && COLUMNAS_TRABAJO.every((c) => (conteos[c.id] ?? 0) === 0) && interesados === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      {/* ── LA BANDEJA DE INTERESADOS: contador real, no una pila infinita. ── */}
      <div className="mb-2.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-card px-4 py-2.5 shadow-panel">
        <Inbox size={16} className="shrink-0 text-navy" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="font-heading text-xl font-bold tabular-nums text-foreground">
            {conteos ? interesados.toLocaleString('es-PE') : '—'}
          </span>
          <h3 className="font-heading text-[13px] font-bold text-foreground">Interesados</h3>
          <p className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:block">
            Levantaron la mano y nadie les respondió aún. Responder los pasa solos a Contactados.
          </p>
        </div>
        {onIrAMensajes && (
          <button
            type="button"
            onClick={onIrAMensajes}
            className="flex shrink-0 basis-full items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98] sm:basis-auto sm:justify-start"
          >
            Responder en Mensajes
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      <div className="mb-2.5 flex min-h-5 shrink-0 items-center gap-3 px-1">
        {arrastrada != null && (
          <p className="text-xs text-muted-foreground">
            A <span className="font-semibold">Cotizados</span> con curso de interés; a{' '}
            <span className="font-semibold">Cierre</span>, registrando la venta. Si falta algo, se
            pide al soltar.
          </p>
        )}
      </div>

      {servidorSinEtapas && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary/70 px-3 py-2 text-xs text-foreground">
          <AlertTriangle size={14} className="shrink-0 text-temp-frio" />
          <span className="flex-1">
            El server todavía no sirve la etapa efectiva (falta desplegar #88/#89): sin eso el
            tablero mentiría, así que no se pinta.
          </span>
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
          {[3, 2, 2, 2].map((bloques, i) => (
            <div key={i} className="flex min-h-0 flex-col gap-2 rounded-2xl bg-secondary/30 p-2">
              <div className="h-6 w-3/5 animate-pulse rounded-md bg-secondary/70" />
              {Array.from({ length: bloques }, (_, j) => (
                <div key={j} className="h-16 animate-pulse rounded-xl bg-secondary/60" />
              ))}
            </div>
          ))}
        </div>
      ) : servidorSinEtapas ? null : tableroVacio ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-sm font-semibold text-foreground">El embudo está vacío.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Cuando alguien escriba por WhatsApp, Facebook o Instagram, cae solo en Interesados — y
            al responderle, pasa solo a Contactados.
          </p>
        </div>
      ) : (
        <div className={GRID}>
          {COLUMNAS_TRABAJO.map((col) => {
            const enEtapa = repartidas.get(col.id) ?? [];
            const columna = porColumna[col.id];
            const total = conteos?.[col.id] ?? columna.total;
            const faltan = quedanPorTraer(total, columna.items.length);
            const esDestino = sobre === col.id && arrastrada != null;
            const esPerdidos = col.id === 'perdido';
            const esCierre = col.id === 'cierre';
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
                      className={
                        'font-heading text-xl font-bold tabular-nums ' +
                        (esPerdidos ? 'text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {(total ?? enEtapa.length).toLocaleString('es-PE')}
                    </span>
                    <h3
                      className={
                        'font-heading text-[13px] font-bold ' +
                        (esCierre ? 'text-navy' : esPerdidos ? 'text-muted-foreground' : 'text-foreground')
                      }
                    >
                      {col.titulo}
                    </h3>
                    {esCierre && enEtapa.length > 0 && (
                      <Check size={13} strokeWidth={3} className="self-center text-success" />
                    )}
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
                  {columna.hayMas && (
                    <button
                      type="button"
                      onClick={columna.cargarMas}
                      disabled={columna.cargandoMas}
                      className="rounded-xl border border-dashed border-border py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                    >
                      {columna.cargandoMas
                        ? 'Trayendo…'
                        : faltan > 0
                          ? `Ver más · faltan ${faltan.toLocaleString('es-PE')}`
                          : 'Ver más'}
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
        <ModalInteresCotizado c={pendienteInteres} onGuardado={guardadoInteres} onCancelar={cancelarInteres} />
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
