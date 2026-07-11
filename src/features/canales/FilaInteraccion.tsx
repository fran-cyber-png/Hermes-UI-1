import { Check, Clock, MessageCircle, MessageSquare, Send } from 'lucide-react';
import type { Interaccion } from './types';
import { VENTANA_DIAS } from './types';

const CANAL = {
  facebook: { nombre: 'Facebook', color: '#1877F2' },
  instagram: { nombre: 'Instagram', color: '#C13584' },
  whatsapp: { nombre: 'WhatsApp', color: '#25D366' },
} as const;

/** "hace 3 días", "hace 4 meses". Sin precisión falsa: nadie necesita las horas. */
function hace(dias: number): string {
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  if (dias < 365) return `hace ${Math.round(dias / 30)} meses`;
  const años = Math.floor(dias / 365);
  return años === 1 ? 'hace más de un año' : `hace ${años} años`;
}

/**
 * Una persona esperando, en una línea.
 *
 * Dos reglas mandan aquí:
 *
 *  · El botón dice lo que REALMENTE se puede hacer. Si la ventana de Meta ya
 *    cerró, dice "Responder en público" — porque el privado no va a salir, y
 *    ofrecerlo sería mentir antes de intentarlo.
 *  · Comentario y mensaje se distinguen, porque no son lo mismo: el comentario
 *    es público y tiene reloj (7 días para el privado); el mensaje ya es una
 *    conversación abierta y no tiene ventana que se cierre.
 */
export default function FilaInteraccion({
  i,
  respondida,
  onAbrir,
  mostrarCanal = true,
}: {
  i: Interaccion;
  respondida: boolean;
  onAbrir: (i: Interaccion) => void;
  /** En la pantalla de un canal, repetir el canal en cada fila es ruido. */
  mostrarCanal?: boolean;
}) {
  const canal = CANAL[i.canal as keyof typeof CANAL];
  const restan = VENTANA_DIAS - i.dias;
  const esMensaje = i.tipo === 'mensaje';

  return (
    <button
      type="button"
      onClick={() => onAbrir(i)}
      className={
        'group flex w-full items-start gap-4 border-b border-border px-5 py-4 text-left transition-colors last:border-b-0 ' +
        (respondida ? 'bg-success/5' : 'hover:bg-muted/50')
      }
    >
      <div className="flex w-28 shrink-0 flex-col items-start gap-1 pt-0.5">
        {/* El reloj solo aparece cuando corre. Un mensaje privado no tiene
            ventana que se cierre, así que mostrarle una sería inventarla. */}
        {i.ventana_abierta ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-gold/20 px-1.5 py-0.5 text-xs font-bold text-gold-ink">
            <Clock size={11} />
            {restan <= 1 ? 'último día' : `quedan ${restan} días`}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{hace(i.dias)}</span>
        )}

        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          {esMensaje ? <Send size={11} /> : <MessageCircle size={11} />}
          {esMensaje ? 'Mensaje' : 'Comentario'}
        </span>

        {mostrarCanal && canal && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: canal.color }}
            />
            {canal.nombre}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Lo que separa un lead de un aplauso. Sin esta marca, «Información» y
            «👏👏👏» se leen igual, y son cosas distintas. */}
        {i.pide_info && (
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-primary">
            Pide información
          </p>
        )}
        <p
          className={
            'line-clamp-2 text-sm ' +
            (i.pide_info ? 'font-semibold text-foreground' : 'text-muted-foreground')
          }
        >
          {i.texto || '(sin texto)'}
        </p>
        {i.contexto_texto && !esMensaje && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            en “{i.contexto_texto}”
          </p>
        )}
      </div>

      <div className="shrink-0 pt-0.5">
        {respondida ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
            <Check size={13} />
            Respondida
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-foreground transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
            <MessageSquare size={12} />
            {esMensaje ? 'Abrir chat' : i.ventana_abierta ? 'Escribirle' : 'Responder en público'}
          </span>
        )}
      </div>
    </button>
  );
}
