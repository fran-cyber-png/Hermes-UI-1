import { AlertTriangle, Bot, ChevronRight, Loader2 } from 'lucide-react';
import { useAutoRespuesta } from './datos';
import {
  MODOS_ELEGIBLES,
  NOMBRE_MODO,
  QUE_HACE,
  puertaDeRevision,
  type ClaseAutoRespuesta,
  type ModoAutoRespuesta,
} from './estado';

/**
 * EL CHIP DE LA AUTO-RESPUESTA, en la cabecera (#125 · ADR 0015, 0016 y 0018).
 *
 * ── Por qué acá y no en un panel de ajustes ──
 * Está al lado del semáforo de WhatsApp porque es lo mismo: el estado del
 * CANAL. Ahí ya se mira para saber si el número está vivo; que la máquina esté
 * preparando cosas que esperan tu OK es parte de esa misma pregunta. Un ajuste
 * escondido en una pantalla que se abre una vez por mes no sirve de kill-switch,
 * y esto es, antes que nada, un kill-switch.
 *
 * ── DOS etiquetas, no tres (ADR 0018) ──
 * «Automática» se retiró: Hermes no manda solo, siempre hay una persona
 * aprobando. El selector ofrece los dos destinos que existen. Si un server
 * quedó en el modo viejo, el control se muestra **con ninguno puesto** y arriba
 * dice «RETIRADO»: donde estás ya no está en la lista, y los dos segmentos son
 * las dos salidas. Fingir que es un modo más sería esconder justo lo que hay
 * que arreglar.
 *
 * ── La puerta ──
 * El renglón del número **es** el botón de entrar a revisar. Antes había un
 * renglón muerto («12 esperando tu OK») y al lado un botón «Revisar»: dos
 * blancos para una intención. El que lee el número es el que quiere hacer algo
 * con él. Cuando no hay nada esperando el renglón no es botón — un botón que no
 * hace nada enseña que ahí no se toca, y al día siguiente, cuando sí haya doce,
 * ya nadie lo toca.
 *
 * ── El oro no aparece acá ──
 * En Hermes el dorado significa tiempo que se acaba, y un modo no es eso. (Sí
 * aparece en la revisión, sobre lo que está por caducar — ahí sí lo es.)
 */
export function InterruptorAutoRespuesta({ onRevisar }: { onRevisar: () => void }) {
  const { vista, cargando, cambiando, errorAlCambiar, cambiarModo } = useAutoRespuesta();

  if (cargando) return <div className="h-9 w-64 animate-pulse rounded-xl bg-muted" />;
  // El server viejo (front desplegado antes del restart) no tiene la ruta: en
  // ese server esta feature no existe, así que el chip tampoco.
  if (vista.clase === 'ausente') return null;

  const puerta = puertaDeRevision(vista);
  const retirado = vista.clase === 'automatica';

  return (
    <div
      className={
        'flex items-center gap-2 rounded-xl border px-2 py-1 transition-colors duration-200 ease-house ' +
        envoltura(vista.clase)
      }
      title={vista.detalle}
    >
      <Icono clase={vista.clase} />

      <div className="flex min-w-0 flex-col gap-1">
        {retirado && (
          <span className="font-mono text-[10px] font-bold uppercase leading-none tracking-wide text-destructive">
            modo retirado
          </span>
        )}

        {vista.puedeCambiar ? (
          <SelectorDeModo actual={vista.modo} deshabilitado={cambiando} onElegir={cambiarModo} />
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">{vista.etiqueta}</span>
        )}

        <Renglon
          abre={puerta.abre}
          texto={errorAlCambiar ?? puerta.texto}
          error={Boolean(errorAlCambiar)}
          onAbrir={onRevisar}
          cuantas={puerta.cuantas}
        />
      </div>

      {cambiando && <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}

/**
 * EL RENGLÓN DE ABAJO — texto cuando no hay nada, puerta cuando sí.
 *
 * Es el mismo lugar en los dos casos a propósito: la vendedora aprende una vez
 * dónde mirar. Lo que cambia es si responde al dedo, y eso se ve — la flecha y
 * el subrayado al pasar por encima aparecen solo cuando abre.
 */
function Renglon({
  abre,
  texto,
  error,
  cuantas,
  onAbrir,
}: {
  abre: boolean;
  texto: string;
  error: boolean;
  cuantas: number;
  onAbrir: () => void;
}) {
  if (!texto) return null;

  if (!abre) {
    return (
      <span
        className={
          'truncate font-mono text-[10px] leading-none ' +
          (error ? 'font-semibold text-destructive' : 'text-muted-foreground')
        }
      >
        {texto}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onAbrir}
      title={`Revisar las ${cuantas} en el chat, con la conversación a la vista · tecla A`}
      className="group -mx-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-left font-mono text-[10px] font-bold leading-none text-navy transition-colors duration-200 ease-house hover:bg-navy hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      <span className="truncate tabular-nums">{texto}</span>
      <ChevronRight
        size={11}
        className="shrink-0 transition-transform duration-200 ease-house group-hover:translate-x-0.5"
      />
    </button>
  );
}

/**
 * LOS DOS DESTINOS, los dos a la vista. Es un `radiogroup` de verdad (no dos
 * botones sueltos) para que un lector de pantalla lo lea como lo que es: una
 * elección entre dos, con una puesta.
 *
 * Cuando el modo actual es el retirado no hay ninguno puesto, y está bien: el
 * control dice a dónde se puede ir, no dónde se está. Dónde se está lo dice el
 * rótulo rojo de arriba.
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
      {MODOS_ELEGIBLES.map((m) => {
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
 * El segmento puesto. La escala sigue siendo deliberada: apagada neutra,
 * supervisada delineada (trabaja, no habla). Con el retirado afuera, ya no hay
 * ningún estado «sólido»: ninguno de los dos que quedan habla solo.
 */
function colorActivo(m: ModoAutoRespuesta): string {
  if (m === 'supervisada') return 'bg-card text-navy ring-1 ring-navy shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
  return 'bg-card text-foreground shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
}

/** El fondo del chip entero. Solo grita cuando está frenada o en el modo retirado. */
function envoltura(clase: ClaseAutoRespuesta): string {
  switch (clase) {
    case 'automatica':
      return 'border-destructive/50 bg-destructive/10';
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
  if (clase === 'frenada' || clase === 'automatica')
    return <AlertTriangle size={14} className="shrink-0 text-destructive" />;
  if (clase === 'sin-migracion' || clase === 'desconocida' || clase === 'sin-efecto')
    return <AlertTriangle size={14} className="shrink-0 text-warning" />;

  return (
    <Bot size={14} className={'shrink-0 ' + (clase === 'supervisada' ? 'text-navy' : 'text-muted-foreground')} />
  );
}
