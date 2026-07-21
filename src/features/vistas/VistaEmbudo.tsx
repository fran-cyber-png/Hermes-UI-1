import { Clock } from 'lucide-react';
import { useConversaciones, type Conversacion } from '../canales/conversaciones';
import { BadgeCanal } from '../canales/BadgeCanal';
import { hace } from '../../lib/datos/frescura';

/**
 * EL EMBUDO — las mismas conversaciones de la Bandeja, leídas por etapa.
 *
 * Versión de lectura: las etapas se DERIVAN de lo que ya sabemos (¿pide info?
 * ¿alguien le respondió?), no de un estado que alguien arrastró. Las etapas
 * completas del embudo (Interesado, Venta registrada) y el arrastre entre
 * columnas llegan con H3 (`docs/plan-crm-definitivo.md`) — hasta entonces este
 * tablero se lee, no se toca, y lo dice.
 *
 * Clic en una tarjeta → la Bandeja, con esa conversación abierta. Acá se mira;
 * allá se trabaja.
 */

const ETAPAS = [
  {
    id: 'piden',
    titulo: 'Piden info',
    vacio: 'Nadie está pidiendo información sin respuesta.',
    filtra: (c: Conversacion) => c.pide_info && !c.respondida,
  },
  {
    id: 'sin-responder',
    titulo: 'Sin responder',
    vacio: 'Todo lo demás está respondido.',
    filtra: (c: Conversacion) => !c.pide_info && !c.respondida,
  },
  {
    id: 'respondidas',
    titulo: 'Respondidas',
    vacio: 'Todavía no se respondió ninguna.',
    filtra: (c: Conversacion) => c.respondida,
  },
] as const;

function TarjetaEmbudo({ c, onAbrir }: { c: Conversacion; onAbrir: (c: Conversacion) => void }) {
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;
  const restan = 7 - c.dias;
  return (
    <button
      type="button"
      onClick={() => onAbrir(c)}
      className="group w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(14,42,82,0.05)] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-center gap-2">
        <BadgeCanal canal={c.canal} />
        <span className="min-w-0 truncate font-heading text-[13px] font-semibold text-foreground">
          {c.persona_nombre ?? c.persona_id ?? 'Sin nombre'}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{hace(horas)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.texto || '(sin texto)'}</p>
      {c.ventana_abierta && (
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-[11px] font-bold text-gold-ink">
          <Clock size={10} /> {restan <= 1 ? 'último día de ventana' : `ventana: quedan ${restan}d`}
        </span>
      )}
    </button>
  );
}

export function VistaEmbudo({ onAbrir }: { onAbrir: (c: Conversacion) => void }) {
  // La misma query de la cola, sin filtro de intención: el embudo mira todo.
  const { items, cargando, hayMas, cargandoMas, cargarMas } = useConversaciones('');

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-3 flex items-center gap-3 px-1">
        <h1 className="font-heading text-base font-bold text-foreground">Embudo</h1>
        <p className="text-xs text-muted-foreground">
          Se lee, no se arrastra: las etapas completas (Interesado, Venta) llegan con la siguiente fase.
        </p>
        {hayMas && (
          <button
            type="button"
            onClick={cargarMas}
            disabled={cargandoMas}
            className="ml-auto rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            {cargandoMas ? 'Cargando…' : 'Traer más conversaciones'}
          </button>
        )}
      </div>

      {cargando ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
          {ETAPAS.map((etapa) => {
            const enEtapa = items.filter(etapa.filtra);
            return (
              <section key={etapa.id} className="flex min-h-0 flex-col rounded-2xl border border-border bg-card/60 p-2.5 shadow-panel">
                <header className="flex items-baseline gap-2 px-1 pb-2">
                  <h2 className="font-heading text-[13px] font-bold text-foreground">{etapa.titulo}</h2>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{enEtapa.length}</span>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5">
                  {enEtapa.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      {etapa.vacio}
                    </p>
                  ) : (
                    enEtapa.map((c) => <TarjetaEmbudo key={c.clave} c={c} onAbrir={onAbrir} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
