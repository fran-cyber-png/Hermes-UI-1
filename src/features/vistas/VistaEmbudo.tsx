import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeDollarSign, Check, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { useConversaciones, type Conversacion } from '../canales/conversaciones';
import type { Etapa } from '../../lib/etapas';
import { decidirDrop, decidirRebote, reintentoTrasInteres } from './compuertas';
import { ModalInteresCotizado, ModalVentaCierre } from './ModalesCompuerta';
import { BandejaDeuda } from './BandejaDeuda';
import { TarjetaEmbudo } from './TarjetaEmbudo';
import { cotizarEnUnClic } from './tarjeta';
import {
  COLUMNAS_TRABAJO,
  etapaDeTarjeta,
  quedanPorTraer,
  repartirColumnas,
  resumirColumna,
  type EtapaTrabajo,
} from './tablero';

/**
 * EL PIPELINE — el tablero de venta de la vendedora.
 *
 * QUÉ PASABA (medido en producción el 2026-07-25, 1.865 conversaciones): de 300
 * Contactadas muestreadas, las 300 estaban respondidas —es decir, TODA la única
 * columna con tarjetas era gente cuya pelota no es nuestra— mientras las 476 que
 * sí esperan respuesta vivían apretadas en un contador gris de una línea que
 * además decía algo falso («nadie les respondió aún») para 218 de ellas. Las
 * otras tres columnas estaban en cero sobre 1.366 px de ancho, y 611
 * conversaciones con el precio ya mandado no figuraban en Cotizados porque la
 * compuerta pide un interés tipeado a mano que nadie tipea (uno en toda la base).
 *
 * QUÉ HACE AHORA, en el mismo orden en que se lee:
 *
 *   1. LA BANDEJA (`BandejaDeuda`) encabeza el tablero y dice la verdad: cuántas
 *      esperan, cuántas están escribiendo AHORA, cuántas nunca abrimos y cuántas
 *      volvieron a escribir. Sigue sin ser columna (decisión del dueño, #87).
 *   2. LAS COLUMNAS pesan lo que trabajan: Contactados se lleva el ancho, y las
 *      vacías explican cómo se llenan en vez de ser un hueco blanco.
 *   3. EL RECORTE «Con precio» convierte las 1.389 en la lista que importa: las
 *      que ya están cotizadas de hecho y no figuran como tales.
 *   4. EL BOTÓN «Cotizado» de la tarjeta cierra el hueco: cuando ya sabemos el
 *      curso (registrado o del formulario), un clic asienta el interés y mueve.
 *      La compuerta del server NO se relaja — se satisface (`registrarGestion`).
 *
 * Lo que NO cambió: se arrastra igual, las compuertas guían con sus modales
 * (#60), el cierre se sigue ganando solo con una venta registrada, y la etapa la
 * dice el server (ADR 0013) — el front no inventa ninguna.
 */

/**
 * La grilla: el ancho es una declaración de dónde está el trabajo. Contactados
 * casi el doble que las de tránsito; Perdidos, un cajón. Aguanta 1280 sin
 * reflow (es una app de escritorio, no una página).
 */
const GRID =
  'grid min-h-0 flex-1 grid-cols-[minmax(320px,1.45fr)_minmax(235px,1.05fr)_minmax(235px,1.05fr)_minmax(180px,0.72fr)] gap-2.5 overflow-x-auto';

export function VistaEmbudo({
  onAbrir,
  onAgendarBienvenida,
  onIrAMensajes,
}: {
  onAbrir: (c: Conversacion) => void;
  /** La siguiente jugada del recibo de venta (cae en la Agenda vía puente). */
  onAgendarBienvenida?: (telefono: string | null) => void;
  /** La bandeja no se trabaja acá: este botón lleva a Mensajes. */
  onIrAMensajes?: () => void;
}) {
  const qc = useQueryClient();
  /** El recorte de Contactados: solo las que ya tienen un precio encima. */
  const [soloConPrecio, setSoloConPrecio] = useState(false);

  // Cada columna carga LO SUYO (#89) y pide el cruce con el formulario (`lead`):
  // el nombre real y el curso que la persona eligió salen de ahí.
  const contactados = useConversaciones({
    tab: 'todo',
    filtroSec: '',
    categoria: null,
    etapa: 'contactado',
    precio: soloConPrecio,
    lead: true,
  });
  const cotizados = useConversaciones({ tab: 'todo', filtroSec: '', categoria: null, etapa: 'cotizado', lead: true });
  const cierres = useConversaciones({ tab: 'todo', filtroSec: '', categoria: null, etapa: 'cierre', lead: true });
  const perdidos = useConversaciones({ tab: 'todo', filtroSec: '', categoria: null, etapa: 'perdido', lead: true });
  const porColumna: Record<EtapaTrabajo, ReturnType<typeof useConversaciones>> = {
    contactado: contactados,
    cotizado: cotizados,
    cierre: cierres,
    perdido: perdidos,
  };

  // El desglose (conteos reales por etapa × turno × precio) viene en la primera
  // página de cualquier columna: es la MISMA foto, contada una vez.
  const desglose =
    contactados.desglose ?? cotizados.desglose ?? cierres.desglose ?? perdidos.desglose;
  // El respaldo mientras el server desplegado no sirva el desglose: el front sale
  // a producción sin reinicio (N4) y el server recién en el botón (N5).
  const conteos = contactados.conteos ?? cotizados.conteos ?? cierres.conteos ?? perdidos.conteos;

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

  /**
   * Mover una tarjeta de etapa. `curso` (opcional) es el camino corto a
   * Cotizados: asienta el interés ANTES de mover, así la compuerta del server
   * —que no se toca— encuentra lo que exige. Las dos llamadas son consecuencia
   * de UN clic humano; nada se mueve solo.
   */
  const mover = useMutation({
    mutationFn: async (v: { c: Conversacion; etapa: Etapa; curso?: string }) => {
      if (v.curso) {
        await api('/api/gestiones/intereses', {
          method: 'POST',
          body: JSON.stringify({ clave: v.c.clave, curso: v.curso }),
        });
      }
      return api('/api/gestiones', {
        method: 'POST',
        body: JSON.stringify({
          clave: v.c.clave,
          canal: v.c.canal,
          personaId: v.c.persona_id,
          personaNombre: v.c.persona_nombre,
          numeroPropio: v.c.numero_propio,
          etapa: v.etapa,
        }),
      });
    },
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
        qc.invalidateQueries({ queryKey: ['intereses', v.c.clave] }),
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

  /**
   * EL CAMINO CORTO A COTIZADO — el botón de la tarjeta. Si ya sabemos el curso
   * (registrado, o el que la persona eligió en el formulario), un clic asienta el
   * interés y mueve. Si no lo sabemos, no se inventa: se abre el modal que lo
   * pregunta, que es exactamente el mismo camino del arrastre.
   */
  function cotizarDesdeTarjeta(c: Conversacion) {
    setAviso(null);
    const unClic = cotizarEnUnClic(c);
    if (!unClic) {
      setOverrides((o) => ({ ...o, [c.clave]: 'cotizado' }));
      setPendienteInteres(c);
      return;
    }
    mover.mutate({ c, etapa: 'cotizado', curso: unClic.hayQueRegistrar ? unClic.curso : undefined });
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
    // Soltar en Cotizados con el curso ya sabido evita el rebote: se asienta el
    // interés en el mismo movimiento (la compuerta se satisface, no se saltea).
    const unClic = d.etapa === 'cotizado' ? cotizarEnUnClic(c) : null;
    mover.mutate({ c, etapa: d.etapa, curso: unClic?.hayQueRegistrar ? unClic.curso : undefined });
  }

  const etapaArrastrada = arrastrada ? etapaDeTarjeta(arrastrada, overrides) : null;
  const resumenContactados = resumirColumna(desglose, 'contactado', conteos);
  const tableroVacio =
    !cargando &&
    (desglose != null || conteos != null) &&
    (desglose?.length ?? Object.keys(conteos ?? {}).length) === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <BandejaDeuda
        desglose={desglose}
        conteos={conteos}
        cargando={cargando}
        onIrAMensajes={onIrAMensajes}
      />

      <div className="mb-2 flex min-h-4 shrink-0 items-center gap-3 px-1">
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
          {[4, 2, 2, 2].map((bloques, i) => (
            <div key={i} className="flex min-h-0 flex-col gap-2 rounded-2xl bg-secondary/30 p-2">
              <div className="h-6 w-3/5 animate-pulse rounded-md bg-secondary/70" />
              {Array.from({ length: bloques }, (_, j) => (
                <div key={j} className="h-12 animate-pulse rounded-xl bg-secondary/60" />
              ))}
            </div>
          ))}
        </div>
      ) : servidorSinEtapas ? null : tableroVacio ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-sm font-semibold text-foreground">El embudo está vacío.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Cuando alguien escriba por WhatsApp, Facebook o Instagram, cae solo en la bandeja — y al
            responderle, pasa solo a Contactados.
          </p>
        </div>
      ) : (
        <div className={GRID}>
          {COLUMNAS_TRABAJO.map((col) => {
            const enEtapa = repartidas.get(col.id) ?? [];
            const columna = porColumna[col.id];
            const resumen = resumirColumna(desglose, col.id, conteos);
            // Con el recorte puesto, el «Ver más» cuenta lo recortado — no el total.
            const total =
              col.id === 'contactado' && soloConPrecio ? columna.total : resumen.total || columna.total;
            const faltan = quedanPorTraer(total, columna.items.length);
            const esDestino = sobre === col.id && arrastrada != null;
            const esPerdidos = col.id === 'perdido';
            const esCierre = col.id === 'cierre';
            const esContactados = col.id === 'contactado';
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

                  {/* EL RECORTE que convierte 1.389 en la lista que importa. */}
                  {esContactados && resumenContactados.conPrecio > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSoloConPrecio(false)}
                        aria-pressed={!soloConPrecio}
                        className={
                          'rounded-full border px-2 py-px text-[11px] font-semibold transition-colors ' +
                          (soloConPrecio
                            ? 'border-border text-muted-foreground hover:text-foreground'
                            : 'border-navy bg-navy text-white')
                        }
                      >
                        Todas
                      </button>
                      <button
                        type="button"
                        onClick={() => setSoloConPrecio(true)}
                        aria-pressed={soloConPrecio}
                        title="Ya les mandaste el precio o la forma de pagar: están cotizadas de hecho"
                        className={
                          'inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-semibold transition-colors ' +
                          (soloConPrecio
                            ? 'border-navy bg-navy text-white'
                            : 'border-border text-muted-foreground hover:text-foreground')
                        }
                      >
                        <BadgeDollarSign size={10} />
                        Con precio {resumenContactados.conPrecio.toLocaleString('es-PE')}
                      </button>
                    </div>
                  )}
                </header>

                <div data-scroll-columna className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-0.5">
                  {enEtapa.map((c, i) => (
                    <TarjetaEmbudo
                      key={c.clave}
                      c={c}
                      indice={i}
                      onAbrir={onAbrir}
                      alArrastrar={empezarArrastre}
                      alTerminar={terminarArrastre}
                      arrastrando={arrastrada?.clave === c.clave}
                      rebotada={rebotada === c.clave}
                      // El camino corto solo desde Contactados, y solo donde hay
                      // algo que asentar: un botón en toda tarjeta es ruido.
                      onCotizar={
                        esContactados && (c.precio_enviado || (c.cursos?.length ?? 0) > 0)
                          ? cotizarDesdeTarjeta
                          : undefined
                      }
                      cotizando={mover.isPending && mover.variables?.c.clave === c.clave}
                    />
                  ))}

                  {enEtapa.length === 0 && !esDestino && (
                    <div className="flex flex-1 items-center justify-center px-3 pb-10">
                      <p className="max-w-[24ch] text-center text-[11px] leading-relaxed text-muted-foreground">
                        {soloConPrecio && esContactados
                          ? 'Ninguna con precio enviado en esta ventana.'
                          : col.vacio}
                      </p>
                    </div>
                  )}

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
