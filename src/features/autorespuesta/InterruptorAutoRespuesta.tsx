import { AlertTriangle, Bot, Loader2, Power } from 'lucide-react';
import { useAutoRespuesta } from './datos';
import { resumenDeCola, type ClaseAutoRespuesta } from './estado';

/**
 * EL INTERRUPTOR DE LA AUTO-RESPUESTA, en la cabecera (#125, ADR 0015).
 *
 * ── Por qué acá y no en un panel de ajustes ──
 * Está al lado del semáforo de WhatsApp porque es lo mismo: el estado del
 * CANAL. Ahí ya se mira para saber si el número está vivo; que la máquina esté
 * contestando sola es parte de esa misma pregunta. Un ajuste escondido en una
 * pantalla que se abre una vez por mes no sirve de kill-switch — y esto es,
 * antes que nada, un kill-switch (el freno sin deploy del ADR 0015).
 *
 * ── Por qué el estado ENCENDIDO grita y el apagado no ──
 * Prender esto tiene consecuencias: una máquina le escribe a clientes reales.
 * Apagado es el estado normal y se ve discreto; encendido pinta el chip entero
 * de azul con su punto vivo y dice cuántas hay en cola y a qué hora sale la
 * próxima. Nadie puede prenderlo sin darse cuenta, y nadie puede pasar una
 * jornada sin notar que está prendido. Sin confirmación modal a propósito:
 * apagar tiene que costar UN click, no dos.
 *
 * El oro no aparece: en Hermes el dorado significa tiempo que se acaba, y esto
 * no es eso. Azul de marca para lo encendido, rojo solo para el freno.
 */
export function InterruptorAutoRespuesta() {
  const { vista, cargando, cambiando, errorAlCambiar, cambiar } = useAutoRespuesta();

  if (cargando) return <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />;

  const resumen = resumenDeCola(vista);
  const encendida = vista.clase === 'encendida' || vista.clase === 'encendida-sin-efecto';

  return (
    <div
      className={'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ' + envoltura(vista.clase)}
      title={vista.detalle}
    >
      <Icono clase={vista.clase} />

      <div className="flex min-w-0 flex-col leading-tight">
        <span className={'font-mono text-[11px] ' + tono(vista.clase)}>{vista.etiqueta}</span>
        {(resumen || errorAlCambiar) && (
          <span
            className={
              'truncate font-mono text-[10px] ' +
              (errorAlCambiar ? 'font-semibold text-destructive' : encendida ? 'text-white/75' : 'text-muted-foreground')
            }
          >
            {errorAlCambiar ?? resumen}
          </span>
        )}
      </div>

      {vista.puedeCambiar && (
        <button
          type="button"
          role="switch"
          aria-checked={encendida}
          aria-label={vista.accion === 'apagar' ? 'Apagar la auto-respuesta' : 'Prender la auto-respuesta'}
          disabled={cambiando}
          onClick={() => cambiar(vista.accion === 'prender')}
          className={
            'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ' +
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-60 ' +
            (encendida
              ? 'bg-white/15 text-white hover:bg-white/25'
              : 'bg-secondary text-navy hover:bg-navy hover:text-white')
          }
        >
          {cambiando ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
          {vista.accion === 'apagar' ? 'Apagar' : 'Prender'}
        </button>
      )}
    </div>
  );
}

/** El fondo del chip. Encendida = azul de marca, sólido: no se puede ignorar. */
function envoltura(clase: ClaseAutoRespuesta): string {
  switch (clase) {
    case 'encendida':
      return 'border-navy bg-navy shadow-[0_4px_14px_-4px_rgba(14,42,82,0.55)]';
    case 'encendida-sin-efecto':
      return 'border-warning bg-navy/90';
    case 'frenada':
      return 'border-destructive/40 bg-destructive/10';
    default:
      return 'border-border';
  }
}

function tono(clase: ClaseAutoRespuesta): string {
  switch (clase) {
    case 'encendida':
    case 'encendida-sin-efecto':
      return 'font-bold text-white';
    case 'frenada':
      return 'font-bold text-destructive';
    case 'sin-migracion':
    case 'desconocida':
      return 'text-muted-foreground';
    default:
      return 'text-muted-foreground';
  }
}

function Icono({ clase }: { clase: ClaseAutoRespuesta }) {
  if (clase === 'frenada') return <AlertTriangle size={13} className="shrink-0 text-destructive" />;
  if (clase === 'sin-migracion' || clase === 'desconocida')
    return <AlertTriangle size={13} className="shrink-0 text-muted-foreground" />;

  const encendida = clase === 'encendida' || clase === 'encendida-sin-efecto';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Bot size={13} className={encendida ? 'text-white' : 'text-muted-foreground'} />
      {/* El punto vivo solo cuando de verdad puede mandar: verde de «fresco»,
          nunca oro (el oro es tiempo que se acaba, no actividad). */}
      <span
        className={
          'size-2 rounded-full ' +
          (clase === 'encendida'
            ? 'bg-temp-fresco animate-pulse'
            : clase === 'encendida-sin-efecto'
              ? 'bg-warning'
              : 'bg-muted-foreground')
        }
      />
    </span>
  );
}
