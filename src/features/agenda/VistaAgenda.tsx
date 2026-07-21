import { useMemo, useState } from 'react';
import { AlarmClockCheck, ChevronLeft, ChevronRight, Loader2, MessageSquareText, Trash2, Undo2 } from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { BadgeCanal } from '../canales/BadgeCanal';
import { conversacionDeRecordatorio, useAgenda, type Recordatorio } from './agenda';

/**
 * LA AGENDA — el calendario de promesas de la vendedora.
 *
 * Izquierda: el mes, navegable, con un punto dorado en los días que tienen
 * seguimientos pendientes (dorado = tiempo, la única acepción del oro acá).
 * Derecha: lo que apura — vencidos primero, después el día elegido.
 *
 * Nada acá envía nada: "hecho" se marca a mano, y el chat se abre con un clic
 * para hacer la llamada de verdad.
 */

const DIAS_SEMANA = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];

function mismaFecha(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function Fila({
  r,
  vencido,
  onAbrir,
}: {
  r: Recordatorio;
  vencido: boolean;
  onAbrir: (c: Conversacion) => void;
}) {
  const { cambiarEstado, borrar } = useAgenda();
  const hecho = r.estado === 'hecho';
  const hora = new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className={
        'flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(14,42,82,0.05)] transition-opacity ' +
        (hecho ? 'border-border opacity-55' : vencido ? 'border-destructive/40' : 'border-border')
      }
    >
      <span className={'font-mono text-xs tabular-nums ' + (vencido && !hecho ? 'font-bold text-destructive' : 'text-muted-foreground')}>
        {hora}
      </span>
      <span className="relative shrink-0">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-secondary font-heading text-[11px] font-bold text-navy">
          {(r.personaNombre ?? r.personaId ?? '·').replace(/^@/, '').slice(0, 2).toUpperCase()}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5">
          <BadgeCanal canal={r.canal} size={12} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className={'truncate text-[13px] font-semibold ' + (hecho ? 'text-muted-foreground line-through' : 'text-foreground')}>
          {r.nota}
        </div>
        <div className="truncate text-xs text-muted-foreground">{r.personaNombre ?? r.personaId ?? 'sin nombre'}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          title="Abrir el chat"
          onClick={() => onAbrir(conversacionDeRecordatorio(r))}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-navy"
        >
          <MessageSquareText size={14} />
        </button>
        <button
          type="button"
          title={hecho ? 'Volver a pendiente' : 'Marcar hecho'}
          onClick={() => cambiarEstado.mutate({ id: r.id, estado: hecho ? 'pendiente' : 'hecho' })}
          className={
            'rounded-lg p-1.5 transition-colors ' +
            (hecho ? 'text-muted-foreground hover:bg-muted' : 'text-success hover:bg-success/10')
          }
        >
          {hecho ? <Undo2 size={14} /> : <AlarmClockCheck size={14} />}
        </button>
        <button
          type="button"
          title="Borrar"
          onClick={() => borrar.mutate(r.id)}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function VistaAgenda({ onAbrir }: { onAbrir: (c: Conversacion) => void }) {
  const { agenda } = useAgenda();
  const hoy = new Date();
  const [mes, setMes] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const [dia, setDia] = useState<Date>(hoy);

  const rs = agenda.data?.recordatorios ?? [];

  const { vencidos, delDia, diasConPendientes } = useMemo(() => {
    const ahora = new Date();
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const vencidos = rs.filter((r) => r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy);
    const delDia = rs.filter((r) => mismaFecha(new Date(r.cuando), dia));
    const diasConPendientes = new Set(
      rs.filter((r) => r.estado === 'pendiente').map((r) => new Date(r.cuando).toDateString()),
    );
    return { vencidos, delDia, diasConPendientes };
  }, [rs, dia]);

  // La grilla del mes: arranca en lunes.
  const celdas = useMemo(() => {
    const primero = new Date(mes);
    const arranque = (primero.getDay() + 6) % 7;
    const enElMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
    const c: (Date | null)[] = Array.from({ length: arranque }, () => null);
    for (let d = 1; d <= enElMes; d++) c.push(new Date(mes.getFullYear(), mes.getMonth(), d));
    return c;
  }, [mes]);

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-4">
      <div className="grid w-full max-w-4xl grid-cols-1 content-start gap-4 md:grid-cols-[300px_1fr]">
        {/* ── El mes ── */}
        <section className="h-fit rounded-2xl border border-border bg-card p-4 shadow-panel">
          <header className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft size={15} />
            </button>
            <h2 className="font-heading text-sm font-bold capitalize text-foreground">
              {mes.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
            </h2>
            <button
              type="button"
              onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight size={15} />
            </button>
          </header>

          <div className="grid grid-cols-7 gap-1 text-center">
            {DIAS_SEMANA.map((d) => (
              <span key={d} className="pb-1 font-mono text-[10px] uppercase text-muted-foreground">
                {d}
              </span>
            ))}
            {celdas.map((fecha, i) =>
              !fecha ? (
                <span key={`v${i}`} />
              ) : (
                <button
                  key={fecha.toISOString()}
                  type="button"
                  onClick={() => setDia(fecha)}
                  className={
                    'relative flex aspect-square items-center justify-center rounded-lg text-xs tabular-nums transition-colors ' +
                    (mismaFecha(fecha, dia)
                      ? 'bg-navy font-bold text-white'
                      : mismaFecha(fecha, hoy)
                        ? 'bg-secondary font-bold text-navy'
                        : 'text-foreground hover:bg-muted')
                  }
                >
                  {fecha.getDate()}
                  {diasConPendientes.has(fecha.toDateString()) && (
                    <span
                      className={
                        'absolute bottom-1 size-1.5 rounded-full ' +
                        (mismaFecha(fecha, dia) ? 'bg-gold' : 'bg-gold-ink')
                      }
                    />
                  )}
                </button>
              ),
            )}
          </div>

          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            El punto dorado marca días con seguimientos pendientes. Nada se envía solo: la agenda te
            avisa, vos hacés.
          </p>
        </section>

        {/* ── Lo que apura + el día ── */}
        <section className="flex min-w-0 flex-col gap-4">
          {vencidos.length > 0 && (
            <div>
              <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-destructive">
                Vencidos ({vencidos.length})
              </h3>
              <div className="flex flex-col gap-2">
                {vencidos.map((r) => (
                  <Fila key={r.id} r={r} vencido onAbrir={onAbrir} />
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {mismaFecha(dia, hoy)
                ? 'Hoy'
                : dia.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
              {delDia.length > 0 && <span className="ml-1.5 font-mono">({delDia.length})</span>}
            </h3>
            {agenda.isPending ? (
              <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Cargando tu agenda…
              </p>
            ) : delDia.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Nada agendado para este día. Los seguimientos se crean desde cualquier conversación
                con “Agendar seguimiento”.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {delDia.map((r) => (
                  <Fila key={r.id} r={r} vencido={false} onAbrir={onAbrir} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
