import { useState } from 'react';
import { AlarmClock, CalendarPlus, Check, Loader2 } from 'lucide-react';
import { avisar } from '../../lib/avisos';
import { usePopover } from '../../lib/teclado/usePopover';
import type { Conversacion } from '../../dominio/conversaciones';
import { HORAS_RAPIDAS, opcionesRapidas, useAgenda } from './agenda';
import { TIPOS_ELEGIBLES, type TipoNota } from './tipoDeNota';

/**
 * AGENDAR SIN SALIR DEL CHAT — el gesto más repetido del día.
 *
 * La forma es la de siempre y no se toca: **dos toques**. Abrir y tocar un día
 * ya agenda. Todo lo demás (qué clase de actividad es, otra hora, otra fecha)
 * es opcional y vive debajo, así que el camino rápido no paga el precio del
 * completo.
 *
 * Lo que NO hace: enviar. Un recordatorio es memoria organizada, y la promesa
 * de la casa —«nada se envía solo»— está escrita al pie del popover porque es
 * la pregunta que toda vendedora hace la primera vez.
 *
 * Vivía adentro de `gestion/BarraGestion.tsx`. Se mudó acá cuando ganó el tipo,
 * la hora y la fecha libre: la barra es el CONTENEDOR de la gestión, no el
 * lugar donde se implementa cada herramienta.
 */
export function AgendarRapido({ conversacion }: { conversacion: Conversacion }) {
  const { crear } = useAgenda();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState('');
  const [tipo, setTipo] = useState<TipoNota>('seguimiento');
  /** La hora elegida, que reencuadra TODOS los días de arriba. `null` = la natural. */
  const [hora, setHora] = useState<number | null>(null);
  const [fechaLibre, setFechaLibre] = useState('');
  /** La etiqueta del chip clickeado — el spinner va solo ahí. */
  const [pendiente, setPendiente] = useState<string | null>(null);
  /** Qué quedó agendado («Mañana 9:00») — el botón lo confirma hasta el próximo gesto. */
  const [listo, setListo] = useState<string | null>(null);

  // Sin el foco en la nota, Escape no cerraba este panel y se lo llevaba el
  // shell (adiós conversación de atrás).
  const { propsOverlay } = usePopover(abierto, () => setAbierto(false), { z: 'z-20' });

  async function agendar(o: { etiqueta: string; cuando: Date }) {
    setPendiente(o.etiqueta);
    try {
      await crear.mutateAsync({
        clave: conversacion.clave,
        canal: conversacion.canal,
        personaId: conversacion.persona_id,
        personaNombre: conversacion.persona_nombre,
        numeroPropio: conversacion.numero_propio,
        nota: nota.trim() || `Seguimiento a ${conversacion.persona_nombre ?? conversacion.persona_id ?? 'lead'}`,
        cuando: o.cuando.toISOString(),
        tipo,
      });
      setNota('');
      setAbierto(false);
      setListo(o.etiqueta);
      avisar(`Seguimiento agendado · ${o.etiqueta.toLowerCase()}`);
    } catch {
      // El error queda visible en el popover vía crear.isError.
    } finally {
      setPendiente(null);
    }
  }

  const dias = opcionesRapidas(new Date(), hora ?? undefined);

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => {
          setListo(null);
          setAbierto((v) => !v);
        }}
        title="Agendar seguimiento (A)"
        className={
          'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
          (listo
            ? 'bg-success/10 text-success'
            : abierto
              ? 'bg-navy text-white'
              : 'border border-border text-muted-foreground hover:border-primary hover:text-foreground')
        }
      >
        {listo ? <Check size={11} /> : <AlarmClock size={11} />}
        {listo ? `Agendado · ${listo}` : 'Agendar'}
      </button>

      {abierto && (
        <>
          <span {...propsOverlay} />
          <div className="absolute right-0 top-8 z-30 w-72 rounded-xl bg-card p-2.5 shadow-panel">
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setAbierto(false);
                }
              }}
              autoFocus
              placeholder="Qué vas a hacer (opcional)…"
              className="mb-2 w-full rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px] outline-none focus:border-primary"
            />

            {/* CUÁNDO — un toque acá y ya quedó agendado. */}
            <div className="flex flex-wrap gap-1.5">
              {dias.map((o) => (
                <button
                  key={o.etiqueta}
                  type="button"
                  disabled={pendiente != null}
                  onClick={() => void agendar(o)}
                  className="rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-secondary/40 hover:text-foreground disabled:opacity-50"
                >
                  {pendiente === o.etiqueta ? <Loader2 size={10} className="inline animate-spin" /> : o.etiqueta}
                </button>
              ))}
            </div>

            {/* A QUÉ HORA — no agenda: reencuadra los días de arriba. */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Hora
              </span>
              {HORAS_RAPIDAS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={hora === h}
                  onClick={() => setHora((v) => (v === h ? null : h))}
                  className={
                    'rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors ' +
                    (hora === h ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                  }
                >
                  {h}:00
                </button>
              ))}
            </div>

            {/* QUÉ ES — el tipo viaja guardado, así que el color del calendario
                deja de adivinarse del texto de la nota (`tipoDeNota.ts`). */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Qué es
              </span>
              {TIPOS_ELEGIBLES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tipo === t.id}
                  onClick={() => setTipo(t.id)}
                  className={
                    'rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-colors ' +
                    (tipo === t.id ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                  }
                >
                  {t.rotulo}
                </button>
              ))}
            </div>

            {/* OTRA FECHA — el escape del camino rápido, sin abrir otra pantalla. */}
            <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
              <input
                type="datetime-local"
                value={fechaLibre}
                onChange={(e) => setFechaLibre(e.target.value)}
                aria-label="Elegir fecha"
                className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] outline-none focus:border-primary"
              />
              <button
                type="button"
                disabled={!fechaLibre || pendiente != null}
                onClick={() => {
                  const d = new Date(fechaLibre);
                  if (Number.isNaN(d.getTime())) return;
                  void agendar({
                    etiqueta: d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                    cuando: d,
                  });
                }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                <CalendarPlus size={11} />
                Agendar
              </button>
            </div>

            {crear.isError && <p className="mt-1.5 text-[11px] text-destructive">No se agendó — probá de nuevo.</p>}
            <p className="mt-1.5 text-[11px] text-muted-foreground">Cae en tu Agenda. Nada se envía solo.</p>
          </div>
        </>
      )}
    </span>
  );
}
