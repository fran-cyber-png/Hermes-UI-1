import { Check, Clock } from 'lucide-react';
import { temperatureOf, TEMPERATURE_META } from '../leads/temperature';
import { hace } from '../../lib/datos/frescura';
import { BadgeCanal } from './BadgeCanal';
import type { Conversacion } from './conversaciones';

const VENTANA_DIAS = 7;

/** Iniciales para el avatar. De un nombre "Andre Q." → "AQ"; de un @usuario → "AN". */
function iniciales(nombre: string | null): string {
  if (!nombre) return '·';
  const limpio = nombre.replace(/^@/, '').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return limpio.slice(0, 2).toUpperCase();
}

/**
 * Una conversación en la cola, en una fila.
 *
 * Sucede a `FilaInteraccion`. Novedades respecto de aquella: la banda de
 * temperatura como lectura periférica de urgencia (la cola "se enfría" hacia
 * abajo y se ve sin leer), el avatar con la insignia de canal encima, y el
 * contador de mensajes cuando la conversación agrupa más de uno.
 */
export function FilaConversacion({
  c,
  seleccionada,
  onAbrir,
}: {
  c: Conversacion;
  seleccionada: boolean;
  onAbrir: (c: Conversacion) => void;
}) {
  const temp = TEMPERATURE_META[temperatureOf(c.referencia)];
  const restan = VENTANA_DIAS - c.dias;
  const nombre = c.persona_nombre ?? (c.canal === 'whatsapp' ? c.persona_id : 'Usuario');
  // Horas reales desde la referencia — `c.dias` son días enteros, así que abajo
  // de un día daba siempre 0 → "hace 1 min". Con las horas, "hace 3 horas" es cierto.
  const horas = (Date.now() - new Date(c.referencia).getTime()) / 3_600_000;

  return (
    <button
      type="button"
      onClick={() => onAbrir(c)}
      className={
        'group relative flex w-full items-start gap-3 border-b border-border py-3 pl-4 pr-3 text-left transition-colors last:border-b-0 ' +
        (seleccionada ? 'bg-secondary' : c.respondida ? 'bg-success/5' : 'hover:bg-muted/50')
      }
    >
      {/* Banda de temperatura: 3px a la izquierda, codifica urgencia sin palabras. */}
      <span className={'absolute inset-y-0 left-0 w-[3px] ' + temp.bar} aria-hidden="true" />

      {/* Avatar con la insignia del canal superpuesta abajo-derecha. */}
      <span className="relative mt-0.5 shrink-0">
        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-bold text-navy">
          {iniciales(c.persona_nombre)}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5">
          <BadgeCanal canal={c.canal} />
        </span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{nombre}</span>
          {/* El reloj dorado SOLO cuando la ventana corre; si no, "hace N" en muted. */}
          {c.ventana_abierta ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-xs font-bold text-gold-ink">
              <Clock size={10} />
              {restan <= 1 ? 'último día' : `quedan ${restan}d`}
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">{hace(horas)}</span>
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          {c.pide_info && (
            <span className="font-bold uppercase tracking-wide text-primary">Pide info</span>
          )}
          <span className="text-muted-foreground">
            {c.tipo === 'mensaje' ? (c.n > 1 ? `${c.n} mensajes` : 'Mensaje') : 'Comentario'}
          </span>
          {c.respondida && (
            <span className="inline-flex items-center gap-0.5 text-success">
              <Check size={11} /> respondida
            </span>
          )}
        </div>

        <p
          className={
            'mt-0.5 line-clamp-1 text-sm ' +
            (c.pide_info && !c.respondida ? 'font-medium text-foreground' : 'text-muted-foreground')
          }
        >
          {c.texto || '(sin texto)'}
        </p>
        {c.contexto_texto && c.tipo === 'comentario' && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">en “{c.contexto_texto}”</p>
        )}
      </div>
    </button>
  );
}
