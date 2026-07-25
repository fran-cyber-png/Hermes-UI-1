import { AlertTriangle, Bot, Inbox, Loader2 } from 'lucide-react';
import { useAutoRespuesta } from './datos';
import { MODOS, NOMBRE_MODO, QUE_HACE, resumenDeCola, type ClaseAutoRespuesta, type ModoAutoRespuesta } from './estado';

/**
 * EL INTERRUPTOR DE LA AUTO-RESPUESTA, en la cabecera (#125, ADR 0015 y 0016).
 *
 * ── Por qué acá y no en un panel de ajustes ──
 * Está al lado del semáforo de WhatsApp porque es lo mismo: el estado del
 * CANAL. Ahí ya se mira para saber si el número está vivo; que la máquina esté
 * contestando sola —o preparando cosas que esperan tu OK— es parte de esa misma
 * pregunta. Un ajuste escondido en una pantalla que se abre una vez por mes no
 * sirve de kill-switch, y esto es, antes que nada, un kill-switch.
 *
 * ── Por qué tres segmentos y no un botón que cicla ──
 * Con tres estados, un botón que avanza al siguiente haría que apagar desde
 * «supervisada» costara dos clicks. El contrato de ADR 0015 es que apagar cuesta
 * UNO, siempre: por eso los tres modos están los tres a la vista y cada uno es
 * su propio destino. De paso, el control dice qué opciones existen sin tener que
 * probarlas — nadie descubre el modo supervisado apretando dos veces.
 *
 * ── La asimetría visual ──
 * **Apagada** es discreta: es el estado normal. **Supervisada** es azul
 * delineada — está trabajando, pero no habla sin vos. **Automática** es azul
 * SÓLIDA con punto vivo: le está escribiendo a clientes reales sin que nadie
 * mire, y nadie puede pasar una jornada sin notarlo. **Frenada** es roja con el
 * motivo. Sin confirmación modal a propósito: frenar tiene que ser más barato
 * que dudar.
 *
 * El oro no aparece acá: en Hermes el dorado significa tiempo que se acaba, y
 * un modo no es eso. (Sí aparece adentro de la bandeja, sobre lo que está por
 * caducar — ahí sí lo es.)
 */
export function InterruptorAutoRespuesta({ onAbrirBandeja }: { onAbrirBandeja: () => void }) {
  const { vista, cargando, cambiando, errorAlCambiar, cambiarModo } = useAutoRespuesta();

  if (cargando) return <div className="h-9 w-64 animate-pulse rounded-xl bg-muted" />;
  // El server viejo (front desplegado antes del restart) no tiene la ruta: en
  // ese server esta feature no existe, así que el chip tampoco.
  if (vista.clase === 'ausente') return null;

  const resumen = resumenDeCola(vista);
  const revisables = vista.esperandoAprobacion > 0;

  return (
    <div
      className={'flex items-center gap-2 rounded-xl border px-2 py-1 transition-colors duration-200 ease-house ' + envoltura(vista.clase)}
      title={vista.detalle}
    >
      <Icono clase={vista.clase} />

      <div className="flex min-w-0 flex-col gap-1">
        {vista.puedeCambiar ? (
          <SelectorDeModo actual={vista.modo} deshabilitado={cambiando} onElegir={cambiarModo} />
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">{vista.etiqueta}</span>
        )}

        {(resumen || errorAlCambiar) && (
          <span
            className={
              'truncate font-mono text-[10px] leading-none ' +
              (errorAlCambiar ? 'font-semibold text-destructive' : 'text-muted-foreground')
            }
          >
            {errorAlCambiar ?? resumen}
          </span>
        )}
      </div>

      {/* La puerta a la bandeja. Aparece SOLO cuando hay algo que revisar: un
          botón que no hace nada es ruido, y acá el ruido tapa el kill-switch. */}
      {revisables && (
        <button
          type="button"
          onClick={onAbrirBandeja}
          title={`Revisar y aprobar (${vista.esperandoAprobacion}) · tecla A`}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-navy px-2 py-1 text-[11px] font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <Inbox size={12} />
          Revisar
          <span className="ml-0.5 rounded-full bg-white/20 px-1.5 font-mono tabular-nums">
            {vista.esperandoAprobacion}
          </span>
        </button>
      )}

      {cambiando && <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}

/**
 * LOS TRES MODOS, los tres a la vista. Es un `radiogroup` de verdad (no tres
 * botones sueltos) para que un lector de pantalla lo lea como lo que es: una
 * elección entre tres, con una puesta.
 */
function SelectorDeModo({
  actual,
  deshabilitado,
  onElegir,
}: {
  actual: ModoAutoRespuesta;
  deshabilitado: boolean;
  onElegir: (m: ModoAutoRespuesta) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Modo de la auto-respuesta" className="flex items-center rounded-lg bg-muted p-0.5">
      {MODOS.map((m) => {
        const activo = m === actual;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={activo}
            disabled={deshabilitado || activo}
            title={QUE_HACE[m]}
            onClick={() => onElegir(m)}
            className={
              'rounded-[6px] px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-[background-color,color,box-shadow] duration-200 ease-house ' +
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-default ' +
              (activo
                ? colorActivo(m)
                : 'text-muted-foreground hover:bg-card hover:text-navy disabled:opacity-60')
            }
          >
            {NOMBRE_MODO[m]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * El segmento puesto. La escala es deliberada: apagada neutra, supervisada
 * delineada (trabaja, no habla), automática sólida (habla sola). El peso visual
 * crece con la consecuencia.
 */
function colorActivo(m: ModoAutoRespuesta): string {
  if (m === 'apagada') return 'bg-card text-foreground shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
  if (m === 'supervisada') return 'bg-card text-navy ring-1 ring-navy shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
  return 'bg-navy text-white shadow-[0_2px_8px_-2px_rgba(14,42,82,0.55)]';
}

/** El fondo del chip entero. Solo grita cuando manda sola o cuando está frenada. */
function envoltura(clase: ClaseAutoRespuesta): string {
  switch (clase) {
    case 'automatica':
      return 'border-navy/40 bg-navy/5';
    case 'supervisada':
      return 'border-navy/25 bg-card';
    case 'sin-efecto':
      return 'border-warning bg-warning/5';
    case 'frenada':
      return 'border-destructive/40 bg-destructive/10';
    default:
      return 'border-border bg-card';
  }
}

function Icono({ clase }: { clase: ClaseAutoRespuesta }) {
  if (clase === 'frenada') return <AlertTriangle size={14} className="shrink-0 text-destructive" />;
  if (clase === 'sin-migracion' || clase === 'desconocida' || clase === 'sin-efecto')
    return <AlertTriangle size={14} className="shrink-0 text-warning" />;

  return (
    <span className="flex shrink-0 items-center gap-1">
      <Bot size={14} className={clase === 'automatica' ? 'text-navy' : 'text-muted-foreground'} />
      {/* El punto vivo SOLO cuando manda sola: verde de «fresco», nunca oro (el
          oro es tiempo que se acaba, no actividad). En supervisada no hay punto
          vivo porque no hay nada saliendo sin permiso. */}
      {clase === 'automatica' && <span className="size-2 animate-pulse rounded-full bg-temp-fresco" />}
    </span>
  );
}
