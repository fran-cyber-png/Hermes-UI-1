import { useEffect, useState } from 'react';
import { Check, Clock, Lock, MessageCircle, Trash2, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { kicker } from '../../lib/styles';

export interface Capacidades {
  puedePrivado: boolean;
  motivo: 'ventana-cerrada' | 'privacidad' | 'instagram' | 'error' | null;
  dias?: number;
}

/** La ventana de Meta para escribirle en privado a quien comenta. */
const VENTANA_PRIVADO_DIAS = 7;

/**
 * Qué se puede hacer con este comentario, ANTES de escribir una palabra.
 *
 * Lo aprendimos rompiéndolo: se publicó "te enviamos la info por privado" sin
 * saber si el privado iba a salir. No salió. Quedó una promesa falsa, pública.
 *
 * Ahora Meta nos dice de antemano si la puerta del privado está abierta, y la
 * pantalla lo dice antes de que alguien redacte algo que no se va a poder
 * entregar.
 */
export default function QuePuedoHacer({
  interactionId,
  onCapacidades,
}: {
  interactionId: number;
  onCapacidades: (c: Capacidades) => void;
}) {
  const [cap, setCap] = useState<Capacidades | null>(null);

  useEffect(() => {
    setCap(null);
    // Por `api()`: la ruta está detrás del perímetro y necesita el Bearer. Si
    // falla, se declara `motivo: 'error'` en vez de dejar el esqueleto eterno.
    api<{ puede: boolean; motivo: Capacidades['motivo']; dias?: number }>(
      `/api/persona/${interactionId}/puede-privado`,
    )
      .then((d) => {
        const c = { puedePrivado: d.puede, motivo: d.motivo, dias: d.dias };
        setCap(c);
        onCapacidades(c);
      })
      .catch(() => {
        const c: Capacidades = { puedePrivado: false, motivo: 'error' };
        setCap(c);
        onCapacidades(c);
      });
  }, [interactionId, onCapacidades]);

  if (!cap) {
    return (
      <div className="mt-5 h-24 animate-pulse rounded-xl border border-border bg-muted/50" aria-hidden="true" />
    );
  }

  const explicacionPrivado =
    cap.motivo === 'ventana-cerrada'
      ? `Meta lo permite solo durante 7 días. Este comentario ya tiene ${cap.dias} días.`
      : cap.motivo === 'privacidad'
        ? 'Esta persona no acepta mensajes de páginas.'
        : cap.motivo === 'instagram'
          ? 'En Instagram, Meta lo tiene detrás de una revisión de app.'
          : 'Meta no lo permite en este comentario.';

  // La cuenta regresiva: oro ANTES de que sea tarde, no después.
  const quedan =
    cap.puedePrivado && typeof cap.dias === 'number' ? VENTANA_PRIVADO_DIAS - cap.dias : null;

  const Fila = ({
    ok,
    icono: Icono,
    titulo,
    detalle,
  }: {
    ok: boolean;
    icono: typeof Check;
    titulo: string;
    detalle: string;
  }) => (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5">
      <span
        className={
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ' +
          (ok ? 'bg-temp-fresco text-white' : 'bg-muted-foreground/25 text-muted-foreground')
        }
      >
        {ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Icono size={12} className="text-muted-foreground" />
          {titulo}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{detalle}</p>
      </div>
    </div>
  );

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-border">
      <div className={`border-b border-border bg-muted px-3.5 py-2 ${kicker}`}>
        Qué podés hacer con esto
      </div>

      <div className="divide-y divide-border bg-card">
        <Fila
          ok
          icono={MessageCircle}
          titulo="Responder en público"
          detalle="Siempre se puede, sin importar la antigüedad. Lo ven todos los que miran el post."
        />
        <Fila
          ok={cap.puedePrivado}
          icono={Lock}
          titulo="Mandale un mensaje privado"
          detalle={
            cap.puedePrivado
              ? 'Le llega por Messenger aunque nunca te haya escrito. Solo una vez por comentario.'
              : explicacionPrivado
          }
        />
        <Fila
          ok
          icono={Trash2}
          titulo="Borrar tu respuesta"
          detalle="Si te equivocaste, se saca. Responder no es irreversible."
        />
      </div>

      {quedan != null && quedan <= 2 && (
        <div className="flex items-start gap-2 border-t border-border bg-gold/10 px-3.5 py-2.5">
          <Clock size={13} className="mt-0.5 shrink-0 text-gold-ink" />
          <p className="text-xs font-semibold leading-relaxed text-gold-ink">
            {quedan <= 0
              ? 'Hoy es el último día para poder escribirle en privado.'
              : quedan === 1
                ? 'Te queda 1 día para poder escribirle en privado.'
                : `Te quedan ${quedan} días para poder escribirle en privado.`}
          </p>
        </div>
      )}

      {!cap.puedePrivado && cap.motivo === 'ventana-cerrada' && (
        <div className="flex items-start gap-2 border-t border-warning/30 bg-warning/10 px-3.5 py-2.5">
          <Clock size={13} className="mt-0.5 shrink-0 text-gold-ink" />
          <p className="text-xs leading-relaxed text-gold-ink">
            <strong>La ventana se cerró.</strong> Meta deja escribirle por privado a quien comenta solo durante 7
            días. Después, solo queda el comentario público. Por eso responder rápido no es una preferencia: es la
            diferencia entre poder hablarle o no.
          </p>
        </div>
      )}
    </div>
  );
}
