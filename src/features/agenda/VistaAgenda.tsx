import { useMemo, useState } from 'react';
import {
  AlarmClockCheck,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquareText,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { BadgeCanal } from '../canales/BadgeCanal';
import { useSesionWa } from '../whatsapp/conversacionWa';
import { conversacionDeRecordatorio, opcionesRapidas, useAgenda, type Recordatorio } from './agenda';

/**
 * LA AGENDA — el calendario de la vendedora, estilo Google Calendar pero de
 * la casa: la grilla del mes manda, los seguimientos viven DENTRO de los días
 * como chips (coloreados por tipo de acción), y todo lo demás es un gesto:
 * clic en un día vacío → crear ahí; clic en un chip → el detalle con sus
 * acciones; Hoy / ‹ › / Mes · Semana · Día arriba, como todo calendario serio.
 *
 * Lo que NO es de Google: los vencidos gritan primero (rojo, arriba), el
 * dorado sigue significando tiempo, y nada se envía solo — la agenda te
 * avisa, vos hacés.
 */

const DIAS_SEMANA = ['LU', 'MA', 'MI', 'JU', 'VI', 'SÁ', 'DO'];
const MODOS = ['mes', 'semana', 'dia'] as const;
type Modo = (typeof MODOS)[number];
const MODO_LABEL: Record<Modo, string> = { mes: 'Mes', semana: 'Semana', dia: 'Día' };

/** El color del chip según el tipo de acción (viene en el prefijo de la nota). */
function estiloDeNota(nota: string, vencido: boolean, hecho: boolean): string {
  if (hecho) return 'bg-muted text-muted-foreground line-through';
  if (vencido) return 'bg-destructive/10 text-destructive ring-1 ring-destructive/30';
  const n = nota.toLowerCase();
  if (n.startsWith('llamada')) return 'bg-primary/10 text-primary';
  if (n.startsWith('wsp')) return 'bg-success/10 text-success';
  if (n.startsWith('correo')) return 'bg-secondary text-secondary-foreground';
  if (n.startsWith('reunión') || n.startsWith('reunion')) return 'bg-navy text-white';
  return 'bg-gold/15 text-gold-ink';
}

function mismaFecha(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function inicioDeSemana(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  r.setHours(0, 0, 0, 0);
  return r;
}

function horaDe(r: Recordatorio): string {
  return new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
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
      className={
        'flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium transition-transform hover:scale-[1.02] ' +
        estiloDeNota(r.nota, vencido, r.estado === 'hecho')
      }
    >
      <span className="shrink-0 font-mono text-[9.5px] opacity-80">{horaDe(r)}</span>
      <span className="truncate">{r.nota}</span>
    </button>
  );
}

// ── El detalle flotante (popover a lo GCal, sin backdrop: no tapa la mesa) ──

function Detalle({
  r,
  onCerrar,
  onAbrir,
}: {
  r: Recordatorio;
  onCerrar: () => void;
  onAbrir: (c: Conversacion) => void;
}) {
  const { cambiarEstado, borrar } = useAgenda();
  const hecho = r.estado === 'hecho';
  const fecha = new Date(r.cuando);
  const tieneConversacion = r.clave.startsWith('conv:') || r.clave.startsWith('int:');

  return (
    <div className="fixed bottom-5 right-5 z-40 w-80 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(14,42,82,0.06),0_24px_60px_-24px_rgba(14,42,82,0.35)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-heading text-sm font-bold text-foreground">{r.nota}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {fecha.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })} · {horaDe(r)}
          </div>
        </div>
        <button type="button" onClick={onCerrar} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative shrink-0">
          <span className="flex size-7 items-center justify-center rounded-[9px] bg-secondary font-heading text-[10px] font-bold text-navy">
            {(r.personaNombre ?? r.personaId ?? '·').replace(/^@/, '').slice(0, 2).toUpperCase()}
          </span>
          <span className="absolute -bottom-0.5 -right-0.5">
            <BadgeCanal canal={r.canal} size={11} />
          </span>
        </span>
        <span className="truncate">{r.personaNombre ?? r.personaId ?? 'sin conversación atada'}</span>
      </div>

      <div className="mt-3 flex gap-2">
        {tieneConversacion && (
          <button
            type="button"
            onClick={() => {
              onAbrir(conversacionDeRecordatorio(r));
              onCerrar();
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover active:scale-[0.98]"
          >
            <MessageSquareText size={13} /> Abrir chat
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            cambiarEstado.mutate({ id: r.id, estado: hecho ? 'pendiente' : 'hecho' });
            onCerrar();
          }}
          className={
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all active:scale-[0.98] ' +
            (hecho ? 'border border-border text-muted-foreground hover:text-foreground' : 'bg-success/10 text-success hover:bg-success/20')
          }
        >
          {hecho ? <Undo2 size={13} /> : <AlarmClockCheck size={13} />}
          {hecho ? 'Reabrir' : 'Hecho'}
        </button>
        <button
          type="button"
          title="Borrar"
          onClick={() => {
            borrar.mutate(r.id);
            onCerrar();
          }}
          className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Crear desde la agenda (con o sin conversación — potenciado) ────────────

function Crear({ fechaInicial, onCerrar }: { fechaInicial: Date | null; onCerrar: () => void }) {
  const { crear } = useAgenda();
  const { data: sesion } = useSesionWa();
  const [nota, setNota] = useState('');
  const [telefono, setTelefono] = useState('');
  const aLocal = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours() || 9)}:${p(d.getMinutes())}`;
  };
  const [cuando, setCuando] = useState(aLocal(fechaInicial ?? opcionesRapidas()[1].cuando));

  async function guardar() {
    if (!nota.trim() || !cuando) return;
    const tel = telefono.replace(/\D/g, '');
    const conTel = tel.length >= 8 && sesion?.estado === 'conectado';
    await crear.mutateAsync({
      clave: conTel ? `conv:whatsapp:${tel}:${sesion.telefono}` : 'general',
      canal: conTel ? 'whatsapp' : 'general',
      personaId: conTel ? tel : null,
      personaNombre: null,
      numeroPropio: conTel ? sesion.telefono : null,
      nota: nota.trim(),
      cuando: new Date(cuando).toISOString(),
    });
    onCerrar();
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-80 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(14,42,82,0.06),0_24px_60px_-24px_rgba(14,42,82,0.35)]">
      <div className="flex items-center justify-between">
        <div className="font-heading text-sm font-bold text-foreground">Nuevo seguimiento</div>
        <button type="button" onClick={onCerrar} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X size={14} />
        </button>
      </div>
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        autoFocus
        placeholder="Qué vas a hacer: llamada, reunión, mandar temario…"
        className="mt-2.5 w-full rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs outline-none focus:border-primary"
      />
      <input
        type="datetime-local"
        value={cuando}
        onChange={(e) => setCuando(e.target.value)}
        className="mt-2 w-full rounded-lg border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs outline-none focus:border-primary"
      />
      <input
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        inputMode="tel"
        placeholder="Teléfono (opcional — lo ata a un chat)"
        className="mt-2 w-full rounded-lg border border-border bg-muted/40 px-2.5 py-2 font-mono text-xs outline-none focus:border-primary placeholder:font-sans"
      />
      <button
        type="button"
        onClick={() => void guardar()}
        disabled={crear.isPending || !nota.trim()}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
      >
        {crear.isPending ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}
        Agendar
      </button>
      <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground">Nada se envía solo: la agenda te avisa, vos hacés.</p>
    </div>
  );
}

// ── LA VISTA ───────────────────────────────────────────────────────────────

export function VistaAgenda({ onAbrir }: { onAbrir: (c: Conversacion) => void }) {
  const { agenda } = useAgenda();
  const hoy = new Date();
  const [modo, setModo] = useState<Modo>('mes');
  const [foco, setFoco] = useState<Date>(hoy); // el mes/semana/día que se mira
  const [detalle, setDetalle] = useState<Recordatorio | null>(null);
  const [crearEn, setCrearEn] = useState<Date | null | 'cerrado'>('cerrado');

  const rs = agenda.data?.recordatorios ?? [];

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
  const estaSemana = rs.filter((r) => {
    const d = new Date(r.cuando);
    const ini = inicioDeSemana(hoy);
    const fin = new Date(ini.getTime() + 7 * 86_400_000);
    return r.estado === 'pendiente' && d >= ini && d < fin;
  });

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

  function mover(direccion: 1 | -1) {
    const d = new Date(foco);
    if (modo === 'mes') d.setMonth(d.getMonth() + direccion);
    else if (modo === 'semana') d.setDate(d.getDate() + 7 * direccion);
    else d.setDate(d.getDate() + direccion);
    setFoco(d);
  }

  const titulo =
    modo === 'dia'
      ? foco.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
      : foco.toLocaleDateString('es', { month: 'long', year: 'numeric' });

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      {/* ── La toolbar, a lo GCal ── */}
      <div className="mb-2.5 flex shrink-0 items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => setFoco(new Date())}
          className="rounded-full border border-border px-3.5 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:bg-secondary/40"
        >
          Hoy
        </button>
        <div className="flex">
          <button type="button" onClick={() => mover(-1)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => mover(1)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight size={16} />
          </button>
        </div>
        <h2 className="font-heading text-base font-bold capitalize tracking-tight text-foreground">{titulo}</h2>

        <div className="ml-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          {vencidos.length > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
              {vencidos.length} vencido{vencidos.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="rounded-full bg-gold/15 px-2 py-0.5 font-semibold text-gold-ink">
            {estaSemana.length} esta semana
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-full border border-border bg-card p-0.5">
            {MODOS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors ' +
                  (modo === m ? 'bg-navy text-white' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {MODO_LABEL[m]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCrearEn(null)}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-[0_4px_14px_-4px_rgba(37,99,235,0.5)] transition-all hover:bg-primary-hover active:scale-[0.97]"
          >
            <CalendarPlus size={14} /> Crear
          </button>
        </div>
      </div>

      {/* ── El calendario ── */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
        {agenda.isPending ? (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> Cargando tu agenda…
          </p>
        ) : modo === 'mes' ? (
          <div className="grid h-full grid-rows-[auto_repeat(6,1fr)]">
            <div className="grid grid-cols-7 border-b border-border">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="px-2 py-1.5 text-center font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
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
                  return (
                    <button
                      key={fecha.toISOString()}
                      type="button"
                      onClick={() => setCrearEn(new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 9))}
                      title="Clic para agendar en este día"
                      className={
                        'group flex min-h-0 flex-col gap-0.5 overflow-hidden border-b border-r border-border/60 p-1 text-left transition-colors last:border-r-0 hover:bg-secondary/30 ' +
                        (delMes ? '' : 'bg-muted/30')
                      }
                    >
                      <span
                        className={
                          'mb-0.5 flex size-5 items-center justify-center self-start rounded-full text-[11px] tabular-nums ' +
                          (esHoy ? 'bg-navy font-bold text-white' : delMes ? 'text-foreground' : 'text-muted-foreground/60')
                        }
                      >
                        {fecha.getDate()}
                      </span>
                      {visibles.map((r) => (
                        <Chip key={r.id} r={r} vencido={r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy} onVer={setDetalle} />
                      ))}
                      {delDia.length > 3 && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFoco(fecha);
                            setModo('dia');
                          }}
                          className="px-1 text-[10px] font-semibold text-muted-foreground hover:text-primary"
                        >
                          +{delDia.length - 3} más
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : modo === 'semana' ? (
          <div className="grid h-full grid-cols-7">
            {diasSemana.map((fecha) => {
              const delDia = porDia.get(fecha.toDateString()) ?? [];
              const esHoy = mismaFecha(fecha, hoy);
              return (
                <div key={fecha.toISOString()} className="flex min-h-0 flex-col border-r border-border/60 last:border-r-0">
                  <button
                    type="button"
                    onClick={() => {
                      setFoco(fecha);
                      setModo('dia');
                    }}
                    className={'border-b border-border px-2 py-2 text-center transition-colors hover:bg-secondary/30 ' + (esHoy ? 'bg-secondary/50' : '')}
                  >
                    <div className="font-mono text-[10px] tracking-wider text-muted-foreground">{DIAS_SEMANA[(fecha.getDay() + 6) % 7]}</div>
                    <div className={'mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-sm tabular-nums ' + (esHoy ? 'bg-navy font-bold text-white' : 'text-foreground')}>
                      {fecha.getDate()}
                    </div>
                  </button>
                  <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5">
                    {delDia.map((r) => (
                      <Chip key={r.id} r={r} vencido={r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy} onVer={setDetalle} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Día ── */
          <div className="h-full overflow-y-auto p-4">
            {vencidos.length > 0 && mismaFecha(foco, hoy) && (
              <div className="mb-4">
                <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-destructive">Vencidos</h3>
                <div className="flex max-w-xl flex-col gap-1.5">
                  {vencidos.map((r) => (
                    <Chip key={r.id} r={r} vencido onVer={setDetalle} />
                  ))}
                </div>
              </div>
            )}
            {(porDia.get(foco.toDateString()) ?? []).length === 0 ? (
              <p className="max-w-xl rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Nada agendado este día. Clic en <b>Crear</b> — o en cualquier día del mes — para agendar.
              </p>
            ) : (
              <div className="flex max-w-xl flex-col gap-1.5">
                {(porDia.get(foco.toDateString()) ?? []).map((r) => (
                  <Chip key={r.id} r={r} vencido={r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy} onVer={setDetalle} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {detalle && <Detalle r={detalle} onCerrar={() => setDetalle(null)} onAbrir={onAbrir} />}
      {crearEn !== 'cerrado' && <Crear fechaInicial={crearEn} onCerrar={() => setCrearEn('cerrado')} />}
    </div>
  );
}
