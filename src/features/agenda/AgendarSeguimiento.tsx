import { useState } from 'react';
import { AlarmClock, Check, Loader2 } from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { opcionesRapidas, useAgenda } from './agenda';

/**
 * "LO LLAMO MAÑANA" EN DOS TOQUES — el agendador rápido del panel derecho.
 *
 * Plegado es un botón; abierto son tres chips de fecha + una nota corta. Nada
 * de modales: se expande en el lugar (la mesa no se tapa a sí misma). El
 * recordatorio queda en la vista Agenda; jamás envía nada solo.
 */
export function AgendarSeguimiento({ conversacion }: { conversacion: Conversacion }) {
  const { crear } = useAgenda();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState('');
  const [cuando, setCuando] = useState<Date | null>(null);
  const [personalizada, setPersonalizada] = useState('');
  const [guardado, setGuardado] = useState<string | null>(null);

  const opciones = opcionesRapidas();

  async function guardar() {
    const fecha = personalizada ? new Date(personalizada) : cuando;
    if (!fecha || !nota.trim()) return;
    await crear.mutateAsync({
      clave: conversacion.clave,
      canal: conversacion.canal,
      personaId: conversacion.persona_id,
      personaNombre: conversacion.persona_nombre,
      numeroPropio: conversacion.numero_propio,
      nota: nota.trim(),
      cuando: fecha.toISOString(),
    });
    setGuardado(
      fecha.toLocaleDateString('es', { weekday: 'long', day: 'numeric' }) +
        ' ' +
        fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
    );
    setNota('');
    setCuando(null);
    setPersonalizada('');
    setAbierto(false);
  }

  return (
    <div className="border-t border-border p-3">
      {guardado && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
          <Check size={13} /> Agendado para el {guardado} — está en tu Agenda.
        </div>
      )}

      {!abierto ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2 text-xs font-bold text-foreground transition-colors hover:border-primary hover:bg-secondary/40"
        >
          <AlarmClock size={14} /> Agendar seguimiento
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-2.5">
          <div className="flex flex-wrap gap-1.5">
            {opciones.map((o) => (
              <button
                key={o.etiqueta}
                type="button"
                onClick={() => {
                  setCuando(o.cuando);
                  setPersonalizada('');
                }}
                className={
                  'rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ' +
                  (cuando?.getTime() === o.cuando.getTime() && !personalizada
                    ? 'bg-navy text-white'
                    : 'border border-border bg-card text-muted-foreground hover:text-foreground')
                }
              >
                {o.etiqueta}
              </button>
            ))}
            <input
              type="datetime-local"
              value={personalizada}
              onChange={(e) => {
                setPersonalizada(e.target.value);
                setCuando(null);
              }}
              className={
                'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold outline-none transition-colors ' +
                (personalizada ? 'border-navy bg-navy text-white' : 'border-border bg-card text-muted-foreground')
              }
            />
          </div>

          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void guardar()}
            autoFocus
            placeholder="Qué vas a hacer: llamarla, mandarle el temario…"
            className="mt-2 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={crear.isPending || !nota.trim() || (!cuando && !personalizada)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
            >
              {crear.isPending ? <Loader2 size={12} className="animate-spin" /> : <AlarmClock size={12} />}
              Agendar
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
