import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlarmClockCheck,
  CalendarPlus,
  Clock3,
  Flag,
  Loader2,
  MessageSquareText,
  Phone,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { Conversacion } from '../../dominio/conversaciones';
import { BadgeCanal } from '../../components/BadgeCanal';
import { formatoTelefono } from '../../lib/formato';
import { useEscape } from '../../lib/teclado/useEscape';
import { useSesionWa } from '../whatsapp/conversacionWa';
import { conversacionDeRecordatorio, opcionesRapidas, useAgenda, type Recordatorio } from './agenda';
import { aLocal, horaDe, indiceTrasAhora, inicioDeSemana, mismaFecha, traducirCuando } from './fechas';
import { BARRA_TIPO, barraDeNota, estiloDeNota, tipoDominante } from './tipoDeNota';
import { useNotificacionesRecordatorio } from './useNotificacionesRecordatorio';
import { VistaSemanaConTimeline } from './VistaSemanaConTimeline';
import { VistaGantt } from './VistaGantt';
import { ProximasActividades } from './ProximasActividades';
import { diasDeGantt, rangoDeGantt } from './gantt';
import { MiniCalendario } from './MiniCalendario';
import { CalendarHeader } from './components/CalendarHeader';
import type { Modo } from './modos';
import { colorPuntoImportancia } from './importancia';
import { SelectorImportancia } from './SelectorImportancia';

/**
 * LA AGENDA — el calendario de la vendedora, estilo Google Calendar pero de
 * la casa: la grilla del mes manda, los seguimientos viven DENTRO de los días
 * como chips (coloreados por tipo de acción), y todo lo demás es un gesto:
 * clic en un día vacío → crear ahí; clic en un chip → el detalle con sus
 * acciones; ‹ › y «Hoy» junto al título, Mes · Semana · Día · Gantt arriba.
 *
 * Lo que NO es de Google: los vencidos gritan primero (rojo, arriba), el
 * dorado significa SOLO tiempo — la línea del ahora, el subrayado de hoy y la
 * pill de la semana — y nada se envía solo: la agenda te avisa, vos hacés.
 *
 * **Crear y el detalle son MODALES en el centro**, no popovers en la esquina.
 * Un panel abajo a la derecha se lee como una notificación —algo que avisa— y
 * los dos piden lo contrario: que se les responda antes de seguir. Es el mismo
 * molde que el resto de los modales de Hermes (scrim + `useEscape`).
 *
 * Debajo del calendario vive **el resumen de próximas actividades**
 * (`ProximasActividades`), que contesta «¿qué sigue?» sin obligar a recorrer la
 * grilla, y cada renglón abre este mismo detalle.
 */

const DIAS_SEMANA = ['LU', 'MA', 'MI', 'JU', 'VI', 'SÁ', 'DO'];

/** Cuántos días abarca la ventana del Gantt: tres semanas entran sin apretar. */
const DIAS_GANTT = 21;

// ── La línea del ahora: el único oro estructural — tiempo pasando ──────────

function LineaAhora() {
  return (
    <div aria-hidden className="flex shrink-0 items-center">
      <span className="size-1.5 shrink-0 rounded-full bg-gold" />
      <span className="h-[2px] min-w-0 flex-1 bg-gold" />
    </div>
  );
}

// ── El chip de un seguimiento dentro de una celda ──────────────────────────

function Chip({ r, vencido, onVer }: { r: Recordatorio; vencido: boolean; onVer: (r: Recordatorio) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onVer(r);
      }}
      title={r.importancia ? `Importancia: ${r.importancia.toUpperCase()}` : 'Sin importancia definida'}
      className={
        'flex w-full items-center gap-1 truncate rounded-md px-1 py-0.5 text-left text-[11px] font-medium transition-colors hover:brightness-95 ' +
        estiloDeNota(r, vencido, r.estado === 'hecho')
      }
    >
      {r.importancia && (
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorPuntoImportancia(r.importancia)}`} />
      )}
      <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-80">{horaDe(r)}</span>
      <span className="truncate">{r.nota}</span>
    </button>
  );
}

// ── La fila del modo día: hora · barrita de tipo · nota · persona ──────────

function FilaDia({ r, vencido, onVer }: { r: Recordatorio; vencido: boolean; onVer: (r: Recordatorio) => void }) {
  const hecho = r.estado === 'hecho';
  return (
    <button
      type="button"
      onClick={() => onVer(r)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/30"
    >
      <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{horaDe(r)}</span>
      <span aria-hidden className={'h-8 w-1 shrink-0 rounded-full ' + barraDeNota(r, vencido, hecho)} />
      <span className="min-w-0 flex-1">
        <span
          className={
            'block truncate text-sm font-semibold ' +
            (hecho ? 'text-muted-foreground line-through' : vencido ? 'text-destructive' : 'text-foreground')
          }
        >
          {r.nota}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {r.personaNombre ??
            (r.personaId ? <span className="font-mono tabular-nums">{formatoTelefono(r.personaId)}</span> : 'sin conversación atada')}
        </span>
      </span>
    </button>
  );
}

// ── El detalle, modal al centro ────────────────────────────────────────────

function Detalle({
  r,
  onCerrar,
  onAbrir,
}: {
  r: Recordatorio;
  onCerrar: () => void;
  onAbrir: (c: Conversacion) => void;
}) {
  const { cambiarEstado, borrar, actualizarImportancia } = useAgenda();
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hecho = r.estado === 'hecho';
  const fecha = new Date(r.cuando);
  const tieneConversacion = r.clave.startsWith('conv:') || r.clave.startsWith('int:');
  useEscape(onCerrar);

  // La red del borrar: el «¿Borrar?» armado se desarma solo a los 3 s.
  useEffect(() => {
    if (!confirmaBorrar) return;
    const t = setTimeout(() => setConfirmaBorrar(false), 3000);
    return () => clearTimeout(t);
  }, [confirmaBorrar]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Detalle del seguimiento"
          className="w-full max-w-sm animate-entrar rounded-2xl bg-card p-5 shadow-[0_1px_3px_rgba(14,42,82,0.10),0_24px_60px_-24px_rgba(14,42,82,0.35)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-heading text-base font-bold text-foreground">{r.nota}</div>
              <div className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {fecha.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })} · {horaDe(r)}
              </div>
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onCerrar}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative shrink-0">
              <span className="flex size-7 items-center justify-center rounded-[9px] bg-secondary font-heading text-[11px] font-bold text-secondary-foreground">
                {(r.personaNombre ?? r.personaId ?? '·').replace(/^@/, '').slice(0, 2).toUpperCase()}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5">
                <BadgeCanal canal={r.canal} size={11} />
              </span>
            </span>
            <span className="truncate">
              {r.personaNombre ??
                (r.personaId ? <span className="font-mono text-[11px] tabular-nums">{formatoTelefono(r.personaId)}</span> : 'sin conversación atada')}
            </span>
          </div>

          {/* Selector de importancia */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold text-foreground">Importancia</div>
            <SelectorImportancia
              valor={r.importancia}
              onChange={(importancia) => {
                actualizarImportancia.mutate({ id: r.id, importancia }, { onError: () => setError('No se guardó la importancia — probá de nuevo.') });
              }}
              disabled={actualizarImportancia.isPending}
            />
          </div>

          <div className="mt-4 flex gap-2">
            {tieneConversacion && (
              <button
                type="button"
                onClick={() => {
                  onAbrir(conversacionDeRecordatorio(r));
                  onCerrar();
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98]"
              >
                <MessageSquareText size={13} /> Abrir chat
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                cambiarEstado.mutate(
                  { id: r.id, estado: hecho ? 'pendiente' : 'hecho' },
                  { onSuccess: onCerrar, onError: () => setError('No se guardó el cambio — probá de nuevo.') },
                );
              }}
              className={
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-[color,background-color,transform] duration-200 ease-house active:scale-[0.98] ' +
                (hecho ? 'border border-border text-muted-foreground hover:text-foreground' : 'bg-success/10 text-success hover:bg-success/20')
              }
            >
              {cambiarEstado.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : hecho ? (
                <Undo2 size={13} />
              ) : (
                <AlarmClockCheck size={13} />
              )}
              {hecho ? 'Reabrir' : 'Hecho'}
            </button>
            {confirmaBorrar ? (
              <button
                type="button"
                onClick={() => {
                  borrar.mutate(r.id, { onSuccess: onCerrar, onError: () => setError('No se borró — probá de nuevo.') });
                }}
                className="rounded-lg bg-destructive px-2.5 text-[11px] font-bold text-white transition-[background-color,transform] duration-200 ease-house active:scale-[0.98]"
              >
                {borrar.isPending ? <Loader2 size={13} className="animate-spin" /> : '¿Borrar?'}
              </button>
            ) : (
              <button
                type="button"
                title="Borrar"
                onClick={() => setConfirmaBorrar(true)}
                className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
        </div>
      </div>
    </>
  );
}

/** Una fila del modal de crear: el ícono a la izquierda, el campo al lado (molde GCal). */
function FilaCampo({ icono, children }: { icono: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <span aria-hidden className="mt-1.5 shrink-0 text-muted-foreground">
        {icono}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Crear desde la agenda (modal al centro — con o sin conversación) ───────

function Crear({
  fechaInicial,
  notaInicial,
  telefonoInicial,
  onCerrar,
}: {
  fechaInicial: Date | null;
  notaInicial?: string;
  telefonoInicial?: string;
  onCerrar: () => void;
}) {
  const { crear } = useAgenda();
  const { data: sesion } = useSesionWa();
  const [nota, setNota] = useState(notaInicial ?? '');
  const [telefono, setTelefono] = useState(telefonoInicial ?? '');
  const [cuando, setCuando] = useState(aLocal(fechaInicial ?? opcionesRapidas()[1].cuando));
  const [confirmarSinAtar, setConfirmarSinAtar] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const rapidas = opcionesRapidas();
  // El contrato de cierre de TODOS los modales de Hermes: en captura, y con el
  // foco en un campo el Escape es del campo — no se lleva puesto lo tipeado.
  useEscape(onCerrar);

  const tel = telefono.replace(/\D/g, '');
  const conTel = tel.length >= 8 && sesion?.estado === 'conectado';
  // El dato nunca se descarta en silencio: si hay teléfono pero no se puede atar, se avisa y se confirma.
  const sinAtar = telefono.trim() !== '' && !conTel;
  const lineaViva = traducirCuando(cuando);

  async function guardar() {
    if (!nota.trim() || !cuando || crear.isPending) return;
    if (sinAtar && !confirmarSinAtar) {
      setConfirmarSinAtar(true);
      return;
    }
    const atado = tel.length >= 8 && sesion?.estado === 'conectado';
    try {
      await crear.mutateAsync({
        clave: atado ? `conv:whatsapp:${tel}:${sesion.telefono}` : 'general',
        canal: atado ? 'whatsapp' : 'general',
        personaId: atado ? tel : null,
        personaNombre: null,
        numeroPropio: atado ? sesion.telefono : null,
        nota: nota.trim(),
        cuando: new Date(cuando).toISOString(),
      });
      onCerrar();
    } catch {
      setErrorGuardar('No se guardó el seguimiento — probá de nuevo.');
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          role="dialog"
          aria-modal="true"
          aria-label="Nuevo seguimiento"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
          className="flex max-h-[90vh] w-full max-w-xl animate-entrar flex-col overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_rgba(14,42,82,0.10),0_24px_60px_-24px_rgba(14,42,82,0.35)]"
        >
          {/* Cabecera: cerrar a la izquierda, el título es el campo, Agendar a la derecha */}
          <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onCerrar}
              className="mt-2 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={18} />
            </button>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              autoFocus
              placeholder="Qué vas a hacer: llamada, reunión, mandar temario…"
              aria-label="Qué vas a hacer"
              className="min-w-0 flex-1 border-b-2 border-border bg-transparent px-1 py-1.5 text-lg text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary"
            />
            <button
              type="submit"
              disabled={crear.isPending || !nota.trim()}
              className="mt-1 flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
            >
              {crear.isPending ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
              {confirmarSinAtar ? 'Agendar sin atar' : 'Agendar'}
            </button>
          </header>

          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto border-t border-border">
            {/* Cuándo */}
            <FilaCampo icono={<Clock3 size={17} />}>
              <div className="flex flex-wrap gap-1.5">
                {rapidas.map((o) => {
                  const activa = cuando === aLocal(o.cuando);
                  return (
                    <button
                      key={o.etiqueta}
                      type="button"
                      onClick={() => setCuando(aLocal(o.cuando))}
                      className={
                        'rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ' +
                        (activa ? 'border border-navy bg-navy text-white' : 'border border-border text-foreground hover:border-primary')
                      }
                    >
                      {o.etiqueta}
                    </button>
                  );
                })}
              </div>
              <input
                type="datetime-local"
                value={cuando}
                onChange={(e) => setCuando(e.target.value)}
                aria-label="Cuándo"
                className="mt-2 w-full rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs outline-none focus:border-primary"
              />
              {lineaViva && <p className="mt-1 px-0.5 font-mono text-[11px] text-muted-foreground">{lineaViva}</p>}
            </FilaCampo>

            {/* A quién — el teléfono es lo que ata el seguimiento a un chat */}
            <FilaCampo icono={<Phone size={17} />}>
              <input
                value={telefono}
                onChange={(e) => {
                  setTelefono(e.target.value);
                  setConfirmarSinAtar(false);
                }}
                inputMode="tel"
                aria-label="Teléfono"
                placeholder="Teléfono (opcional — lo ata a un chat)"
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs outline-none focus:border-primary placeholder:font-sans"
              />
              {sinAtar && (
                <p className="mt-1 px-0.5 text-[11px] text-destructive">
                  {tel.length < 8 ? 'Número incompleto — se guarda sin atar al chat.' : 'WhatsApp está desconectado: se guarda sin atar al chat.'}
                  {confirmarSinAtar && ' Tocá Agendar de nuevo para confirmar.'}
                </p>
              )}
            </FilaCampo>

            {/* La promesa de la casa, donde siempre estuvo: al pie del formulario */}
            <FilaCampo icono={<Flag size={17} />}>
              <p className="py-1.5 text-[11px] text-muted-foreground">Nada se envía solo: la agenda te avisa, vos hacés.</p>
            </FilaCampo>
          </div>

          {errorGuardar && (
            <p className="shrink-0 border-t border-border px-5 py-2 text-[11px] text-destructive">{errorGuardar}</p>
          )}
        </form>
      </div>
    </>
  );
}

// ── LA VISTA ───────────────────────────────────────────────────────────────

export function VistaAgenda({
  onAbrir,
  crearInicial,
  onCrearInicialUsado,
  modoInicial = 'mes',
}: {
  onAbrir: (c: Conversacion) => void;
  /**
   * El puente (§2.9): llegar con el panel de crear abierto y datos precargados
   * (p. ej. «Agendar bienvenida» desde el recibo de venta). Fase 3 lo cablea;
   * la vista funciona igual sin él. App debe limpiar via onCrearInicialUsado.
   */
  crearInicial?: { telefono?: string; nota?: string } | null;
  onCrearInicialUsado?: () => void;
  /**
   * Con qué modo abre la agenda. Es el valor INICIAL y nada más: a partir de ahí
   * manda el estado, así que pasarlo no clava la vista. Existe para que la
   * galería de evidencia pueda fotografiar el Gantt sin un clic (regla dura #2).
   */
  modoInicial?: Modo;
}) {
  const { agenda, actualizarHora } = useAgenda();
  // La hora del cliente, recalculada por minuto: mueve la línea del ahora y
  // vuelve «mañana» en «vencido» sin que nadie toque nada.
  const [ahora, setAhora] = useState(() => new Date());
  const hoy = ahora;
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [foco, setFoco] = useState<Date>(hoy); // el mes/semana/día que se mira
  const [detalle, setDetalle] = useState<Recordatorio | null>(null);
  const [crearEn, setCrearEn] = useState<Date | null | 'cerrado'>('cerrado');
  const [semilla, setSemilla] = useState<{ nota?: string; telefono?: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Detalle y Crear son mutuamente excluyentes: abrir uno cierra el otro.
  function abrirDetalle(r: Recordatorio) {
    setCrearEn('cerrado');
    setDetalle(r);
  }
  function abrirCrear(f: Date | null) {
    setDetalle(null);
    setSemilla(null);
    setCrearEn(f);
  }
  function manejarActualizarHora(recordatorioId: number, nuevaFecha: Date) {
    actualizarHora.mutate({
      id: recordatorioId,
      cuando: nuevaFecha.toISOString(),
    });
  }

  // El puente entra: crear abierto con lo que mandó la otra vista.
  useEffect(() => {
    if (!crearInicial) return;
    setDetalle(null);
    setSemilla(crearInicial);
    setCrearEn(null);
    onCrearInicialUsado?.();
  }, [crearInicial, onCrearInicialUsado]);

  const rs = agenda.data?.recordatorios ?? [];

  // Hook de notificaciones
  useNotificacionesRecordatorio(rs);

  const porDia = useMemo(() => {
    const m = new Map<string, Recordatorio[]>();
    for (const r of rs) {
      const k = new Date(r.cuando).toDateString();
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    for (const lista of m.values()) lista.sort((a, b) => a.cuando.localeCompare(b.cuando));
    return m;
  }, [rs]);

  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const vencidos = rs.filter((r) => r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy);

  // Las celdas del mes: desde el lunes de la primera semana hasta completar 6 filas.
  const celdasMes = useMemo(() => {
    const primero = new Date(foco.getFullYear(), foco.getMonth(), 1);
    const desde = inicioDeSemana(primero);
    return Array.from({ length: 42 }, (_, i) => new Date(desde.getTime() + i * 86_400_000));
  }, [foco]);

  const diasSemana = useMemo(() => {
    const desde = inicioDeSemana(foco);
    return Array.from({ length: 7 }, (_, i) => new Date(desde.getTime() + i * 86_400_000));
  }, [foco]);

  // La ventana del Gantt arranca en el lunes de la semana del foco, así ‹ › la
  // mueve de a semanas enteras y el eje nunca queda cortado por la mitad.
  const diasGantt = useMemo(() => diasDeGantt(inicioDeSemana(foco), DIAS_GANTT), [foco]);

  function mover(direccion: 1 | -1) {
    const d = new Date(foco);
    if (modo === 'mes') d.setMonth(d.getMonth() + direccion);
    else if (modo === 'semana' || modo === 'gantt') d.setDate(d.getDate() + 7 * direccion);
    else d.setDate(d.getDate() + direccion);
    setFoco(d);
  }

  const vacioTotal = agenda.isSuccess && rs.length === 0;
  const delDiaFoco = porDia.get(foco.toDateString()) ?? [];
  const esFocoHoy = mismaFecha(foco, hoy);
  const corteDia = esFocoHoy ? indiceTrasAhora(delDiaFoco, ahora) : -1;

  const titleFormat =
    modo === 'mes'
      ? foco.toLocaleDateString('es', { month: 'long', year: 'numeric' })
      : modo === 'gantt'
        ? rangoDeGantt(diasGantt)
        : foco.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

  // «Hoy» encendido significa «ya estás mirando hoy»: en mes y gantt eso es que
  // el día de hoy CAE en la ventana, no que el foco sea exactamente hoy.
  const enHoy =
    modo === 'mes'
      ? hoy.getFullYear() === foco.getFullYear() && hoy.getMonth() === foco.getMonth()
      : modo === 'gantt'
        ? diasGantt.some((d) => mismaFecha(d, hoy))
        : modo === 'semana'
          ? diasSemana.some((d) => mismaFecha(d, hoy))
          : esFocoHoy;

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col bg-background transition-colors duration-300">
      {/* ── Toolbar superior con CalendarHeader ── */}
      <CalendarHeader
        title={titleFormat}
        modo={modo}
        overdue={vencidos.length}
        enHoy={enHoy}
        onToday={() => setFoco(new Date())}
        onPrevious={() => mover(-1)}
        onNext={() => mover(1)}
        onModoChange={setModo}
        onCreateClick={() => abrirCrear(null)}
        containerRef={containerRef}
      />

      {/* ── Contenedor principal con minicalendario ── */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        {/* Minicalendario a la izquierda */}
        <div className="shrink-0">
          <MiniCalendario
            foco={foco}
            onClickDia={(fecha) => {
              setFoco(fecha);
              setModo('dia');
            }}
            onCambiarMes={(direccion) => {
              const nuevaFecha = new Date(foco);
              nuevaFecha.setMonth(nuevaFecha.getMonth() + direccion);
              setFoco(nuevaFecha);
            }}
            porDia={porDia}
            hoy={hoy}
          />
        </div>

        {/* Calendario principal, con el resumen debajo */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-card border border-border shadow-sm">
        {vacioTotal && (
          <p className="shrink-0 border-b border-border bg-secondary/30 px-4 py-2 text-center text-xs text-muted-foreground">
            Todavía no agendaste nada. Clic en cualquier día para tu primer seguimiento — nada se envía solo.
          </p>
        )}
        {agenda.isError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">No se pudo cargar tu agenda.</p>
            <button
              type="button"
              onClick={() => void agenda.refetch()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Reintentar
            </button>
          </div>
        ) : agenda.isPending ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_repeat(6,1fr)]">
            <div className="grid grid-cols-7 border-b border-border">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="px-2 py-1.5 text-center font-mono text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, fila) => (
              <div key={fila} className="grid min-h-0 grid-cols-7 gap-1 p-1">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="animate-pulse rounded-lg bg-muted/40" />
                ))}
              </div>
            ))}
          </div>
        ) : modo === 'mes' ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_repeat(6,1fr)]">
            <div className="grid grid-cols-7 border-b border-border">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="px-2 py-1.5 text-center font-mono text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, fila) => (
              <div key={fila} className="grid min-h-0 grid-cols-7">
                {celdasMes.slice(fila * 7, fila * 7 + 7).map((fecha) => {
                  const delDia = porDia.get(fecha.toDateString()) ?? [];
                  const esHoy = mismaFecha(fecha, hoy);
                  const delMes = fecha.getMonth() === foco.getMonth();
                  const visibles = delDia.slice(0, 3);
                  const pendHoy = esHoy && delDia.some((r) => r.estado === 'pendiente');
                  const puntoDom = delDia.length > 0 ? BARRA_TIPO[tipoDominante(delDia)] : '';
                  const crearAca = () => abrirCrear(new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 9));
                  return (
                    <div
                      key={fecha.toISOString()}
                      role="gridcell"
                      tabIndex={0}
                      onClick={crearAca}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          crearAca();
                        }
                      }}
                      title="Clic para agendar en este día"
                      className={
                        'group flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-border/60 p-1 text-left transition-colors last:border-r-0 hover:bg-secondary/30 ' +
                        (delMes ? '' : 'bg-muted/30')
                      }
                    >
                      <span className="mb-0.5 flex flex-col items-center self-start">
                        <span
                          className={
                            'flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums ' +
                            (esHoy ? 'bg-navy font-bold text-white' : delMes ? 'text-foreground' : 'text-muted-foreground/60')
                          }
                        >
                          {fecha.getDate()}
                        </span>
                        {/* El subrayado dorado de hoy: solo si el día todavía debe algo. */}
                        {pendHoy && <span aria-hidden className="mt-px h-[2px] w-4 rounded-full bg-gold" />}
                        {delDia.length > 0 && (
                          <span aria-hidden className="mt-0.5 flex gap-0.5">
                            {Array.from({ length: Math.min(delDia.length, 3) }, (_, i) => (
                              <span key={i} className={'size-[3px] rounded-full ' + puntoDom} />
                            ))}
                          </span>
                        )}
                      </span>
                      {visibles.map((r) => (
                        <Chip key={r.id} r={r} vencido={r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy} onVer={abrirDetalle} />
                      ))}
                      {delDia.length > 3 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFoco(fecha);
                            setModo('dia');
                          }}
                          className="px-1 text-left text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary"
                        >
                          +{delDia.length - 3} más
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : modo === 'semana' ? (
          <VistaSemanaConTimeline
            diasSemana={diasSemana}
            hoy={hoy}
            ahora={ahora}
            porDia={porDia}
            onVer={abrirDetalle}
            onActualizarHora={manejarActualizarHora}
          />
        ) : modo === 'gantt' ? (
          <VistaGantt dias={diasGantt} hoy={hoy} recordatorios={rs} onVer={abrirDetalle} />
        ) : (
          /* ── Día ── */
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {vencidos.length > 0 && esFocoHoy && (
              <div className="mb-4">
                <h3 className="mb-2 text-[11px] font-semibold text-destructive">Promesas vencidas</h3>
                <div className="flex max-w-xl flex-col gap-1">
                  {vencidos.map((r) => (
                    <FilaDia key={r.id} r={r} vencido onVer={abrirDetalle} />
                  ))}
                </div>
              </div>
            )}
            {delDiaFoco.length === 0 ? (
              <div className="max-w-xl">
                {esFocoHoy && <LineaAhora />}
                <p className="mt-2 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nada agendado este día. Clic en <span className="font-semibold">Crear</span> — o en cualquier día del mes — para agendar.
                </p>
              </div>
            ) : (
              <div className="flex max-w-xl flex-col gap-1">
                {esFocoHoy && corteDia === 0 && <LineaAhora />}
                {delDiaFoco.map((r, i) => (
                  <Fragment key={r.id}>
                    <FilaDia r={r} vencido={r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy} onVer={abrirDetalle} />
                    {esFocoHoy && corteDia === i + 1 && <LineaAhora />}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

          {/* ── El resumen de lo que sigue, debajo del calendario ── */}
          {!agenda.isError && !agenda.isPending && (
            <ProximasActividades recordatorios={rs} ahora={ahora} onVer={abrirDetalle} />
          )}
        </div>

        {detalle && <Detalle r={detalle} onCerrar={() => setDetalle(null)} onAbrir={onAbrir} />}
        {crearEn !== 'cerrado' && (
          <Crear
            fechaInicial={crearEn}
            notaInicial={semilla?.nota}
            telefonoInicial={semilla?.telefono}
            onCerrar={() => {
              setCrearEn('cerrado');
              setSemilla(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
