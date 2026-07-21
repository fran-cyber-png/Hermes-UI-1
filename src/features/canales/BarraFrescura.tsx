import { AlertTriangle, Check } from 'lucide-react';
import { hace, useFrescura } from '../../lib/datos/frescura';

/**
 * La franja que dice de cuándo son los datos.
 *
 * ── Por qué existe una barra entera para esto ──
 * Es la única defensa contra el peor modo de falla de esta pantalla: que la
 * ingesta se detenga y la bandeja se vea igual de tranquila que cuando está
 * al día. Un cero puede significar "no hay trabajo" o "no estoy mirando", y esas
 * dos cosas son opuestas.
 *
 * Por eso NO es un iconito discreto en una esquina. Cuando el dato está viejo, la
 * barra se pone ámbar, ocupa el ancho completo y dice el número de días en la
 * cara. La única forma de que un vendedor confíe en una cola es que la cola le
 * avise cuando no se puede confiar en ella.
 */
export default function BarraFrescura() {
  const { data, isPending } = useFrescura();

  if (isPending || !data) return null;

  if (data.fresca) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Check size={13} className="text-temp-fresco" />
        Datos al día · {hace(data.horasDesdeIngesta)}
      </div>
    );
  }

  const dias = data.horasDesdeIngesta == null ? null : Math.floor(data.horasDesdeIngesta / 24);

  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-gold-ink" />
      <div className="text-xs leading-snug">
        <span className="font-bold text-foreground">
          {data.ultimaIngesta == null
            ? 'Nunca se capturaron datos.'
            : `La captura está detenida ${hace(data.horasDesdeIngesta)}.`}
        </span>{' '}
        <span className="text-muted-foreground">
          {dias != null && dias >= 7
            ? // 7 días es exactamente la ventana de Meta: pasado eso, TODA la cola de
              // "les puedo escribir" es necesariamente cero, venga o no venga gente nueva.
              'Con más de 7 días de atraso, “les puedo escribir” siempre da cero — no porque estés al día, sino porque no hay nada reciente que mirar.'
            : 'Lo que ves abajo puede no ser lo que está pasando ahora.'}{' '}
          Corré <code className="rounded bg-muted px-1 py-0.5 font-mono">npm run ingest:interactions</code> en{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">server/</code>.
        </span>
      </div>
    </div>
  );
}
