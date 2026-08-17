import { AlertTriangle, Bot, Loader2, Undo2 } from 'lucide-react';
import { useBot } from './datos';
import { MODOS_BOT, NOMBRE_MODO, puertaDelFreno, type ClaseBot, type ModoBot, type VistaBot } from './estado';

/**
 * EL CHIP DEL BOT, en la cabecera — el kill-switch que no tenía dónde apretarse.
 *
 * ── Por qué existe ──
 * `/api/bot` está montado desde el primer día y `server/src/index.ts` lo comenta
 * como «apagar cuesta un click, no un deploy». Era falso del lado de la
 * vendedora: **el front no llamaba a esa ruta desde ningún lado**, así que
 * apagar costaba armar un `PUT` a mano con un Bearer, a las 2 AM. Es el mismo
 * agujero de `bot_calificaciones`, que «no tenía un solo lector»: el 1-ago el bot
 * escaló tres conversaciones de leads a punto de comprar y del otro lado no
 * había nadie.
 *
 * ── Por qué acá y no en una pantalla de ajustes ──
 * Copia deliberada del molde de la auto-respuesta, y va pegado a él: los dos
 * chips contestan la misma pregunta —«¿qué máquina le está escribiendo a mis
 * leads ahora mismo?»— y esa pregunta se hace mirando la conversación, no
 * entrando a una pantalla que se abre una vez por mes. Un ajuste escondido no
 * sirve de kill-switch, y esto es, antes que nada, un kill-switch.
 *
 * ── TRES segmentos, y los tres se pueden elegir ──
 * A diferencia de la auto-respuesta (donde `automatica` se RETIRÓ, ADR 0018),
 * acá los tres modos son destinos vivos: `sombra` es el que deja al bot pensar
 * sin hablar, y existe justamente para poder bajar un escalón sin apagar todo.
 *
 * ── El oro no aparece acá ──
 * En Hermes el dorado significa tiempo que se acaba, y un modo no es eso: no
 * corre ningún plazo. La escala es: neutro apagado · delineado sombra (trabaja,
 * no habla) · **sólido navy automático**, el único en el que un lead recibe algo.
 * El rojo queda reservado para lo que grita —el freno y el modo que no se
 * entiende—, así que un `automatico` normal no vive en alarma permanente: si
 * gritara siempre, dejaría de gritar el día que importe.
 */
export function InterruptorBot() {
  const { vista, cargando, cambiando, errorAlCambiar, cambiarModo, soltarFreno } = useBot();

  if (cargando) return <div className="h-9 w-56 animate-pulse rounded-xl bg-muted" />;
  // El server viejo (front por N4, server por N5) no tiene la ruta: ahí esta
  // feature no existe, así que el chip tampoco. Alarmar por algo que en ese
  // server no está sería ruido.
  if (vista.clase === 'ausente') return null;

  const puerta = puertaDelFreno(vista);

  return (
    <div
      /* ⚠️ El `max-w` NO es decoración, y lo encontró la CAPTURA, no un test: el
         renglón de abajo dice de dónde sale el modo («del entorno
         (BOT_MODO=automatico) · nadie lo tocó desde acá»), mucho más largo que el
         «12 esperando tu OK» del molde. Sin techo el chip medía **395 px**, y
         esta barra ya lleva Ivi + la frescura + la auto-respuesta + el semáforo
         de WhatsApp a 1280. Con techo, `truncate` recién hace algo — y no se
         pierde nada: el `title` de acá lleva el detalle entero. */
      className={
        'flex max-w-[15rem] items-center gap-2 rounded-xl border px-2 py-1 transition-colors duration-200 ease-house ' +
        envoltura(vista.clase)
      }
      title={vista.detalle}
    >
      <Icono clase={vista.clase} />

      <div className="flex min-w-0 flex-col gap-1">
        {/* El rótulo ruidoso: lo que el selector NO puede expresar. Molde del
            «RETIRADO» de la auto-respuesta — el control dice a dónde se puede
            ir, este rótulo dice qué está pasando ahora. */}
        {vista.aviso && (
          <span className="font-mono text-[10px] font-bold uppercase leading-none tracking-wide text-destructive">
            {vista.aviso}
          </span>
        )}

        {vista.puedeCambiar ? (
          <SelectorDeModo vista={vista} deshabilitado={cambiando} onElegir={cambiarModo} />
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">{vista.etiqueta}</span>
        )}

        <Renglon
          abre={puerta.abre && !errorAlCambiar}
          texto={errorAlCambiar ?? puerta.texto}
          error={Boolean(errorAlCambiar)}
          onSoltar={soltarFreno}
        />
      </div>

      {cambiando && <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}

/**
 * EL RENGLÓN DE ABAJO — texto cuando no hay nada que hacer, puerta cuando sí.
 *
 * Mismo lugar en los dos casos, como en la auto-respuesta: la vendedora aprende
 * una vez dónde mirar y lo que cambia es si responde al dedo. Sin freno dice **de
 * dónde sale el modo**, que es la pregunta de las 2 AM: «lo apagué yo» y «lo apaga
 * el entorno» se ven igual en el selector y se arreglan en lugares distintos.
 *
 * Un renglón que parece botón y no hace nada enseña que ahí no se toca, y al día
 * siguiente —cuando sí haya un freno que soltar— ya nadie lo toca.
 */
function Renglon({
  abre,
  texto,
  error,
  onSoltar,
}: {
  abre: boolean;
  texto: string;
  error: boolean;
  onSoltar: () => void;
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
      onClick={onSoltar}
      title="Soltar el freno: la línea vuelve al modo que dice el selector y puede empezar a mandar"
      className="group -mx-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-left font-mono text-[10px] font-bold leading-none text-destructive transition-colors duration-200 ease-house hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      <span className="truncate">{texto}</span>
      <Undo2 size={11} className="shrink-0" />
    </button>
  );
}

/**
 * LOS TRES DESTINOS, los tres a la vista. Es un `radiogroup` de verdad (no tres
 * botones sueltos) para que un lector de pantalla lo lea como lo que es.
 *
 * Con el modo puesto en `null` —el server informó uno que esta app no conoce— no
 * queda ningún segmento marcado, **y está bien**: el control dice a dónde se
 * puede ir, no dónde se está. Dónde se está lo dice el rótulo rojo de arriba.
 * Colapsarlo al segmento más parecido sería inventar el estado de una máquina
 * que le escribe a la gente.
 *
 * `title` por segmento con lo que hace cada modo — y sale del SERVER cuando el
 * server lo manda (`vista.queHace`), para que no haya dos textos que diverjan.
 */
function SelectorDeModo({
  vista,
  deshabilitado,
  onElegir,
}: {
  vista: VistaBot;
  deshabilitado: boolean;
  onElegir: (m: ModoBot) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Modo del bot${vista.numero ? ` de la línea ${vista.numero}` : ''}`}
      className="flex items-center rounded-lg bg-muted p-0.5"
    >
      {MODOS_BOT.map((m) => {
        const activo = m === vista.modo;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={activo}
            disabled={deshabilitado || activo}
            title={vista.queHace[m]}
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
 * El segmento puesto. La escala es deliberada y sube con lo que el lead recibe:
 * apagado neutro · sombra delineada (piensa, no habla) · automático SÓLIDO, que
 * es el único que manda. Sin oro: acá no corre ningún plazo.
 */
function colorActivo(m: ModoBot): string {
  if (m === 'automatico') return 'bg-navy text-white shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
  if (m === 'sombra') return 'bg-card text-navy ring-1 ring-navy shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
  return 'bg-card text-foreground shadow-[0_1px_2px_rgba(14,42,82,0.10)]';
}

/**
 * El fondo del chip entero. Solo grita cuando está frenado o cuando el estado no
 * se pudo leer — y **lo que no se pudo leer se ve distinto de lo apagado**: ese
 * es el punto entero (la cicatriz de `sinLineasPropias`, quien ve algo vacío no
 * lee «no hay», lee «se rompió»).
 */
function envoltura(clase: ClaseBot): string {
  switch (clase) {
    case 'frenado':
      return 'border-destructive/40 bg-destructive/10';
    case 'desconocida':
    case 'sin-linea':
    case 'sin-efecto':
      return 'border-warning bg-warning/5';
    case 'automatico':
      return 'border-navy/40 bg-navy/5';
    case 'sombra':
      return 'border-navy/25 bg-card';
    default:
      return 'border-border bg-card';
  }
}

function Icono({ clase }: { clase: ClaseBot }) {
  if (clase === 'frenado') return <AlertTriangle size={14} className="shrink-0 text-destructive" />;
  if (clase === 'desconocida' || clase === 'sin-linea' || clase === 'sin-efecto')
    return <AlertTriangle size={14} className="shrink-0 text-warning" />;

  return (
    <Bot
      size={14}
      className={'shrink-0 ' + (clase === 'automatico' || clase === 'sombra' ? 'text-navy' : 'text-muted-foreground')}
    />
  );
}
