import { Bot, BotMessageSquare, BotOff } from 'lucide-react';
import { useBot } from './datos';
import { MODOS_BOT, NOMBRE_MODO, type ModoBot, type VistaBot } from './estado';

/** Un ícono por modo — apagado, pensando en silencio (sombra) y hablando solo (automático). */
const ICONO_MODO: Record<ModoBot, typeof Bot> = {
  apagado: BotOff,
  sombra: Bot,
  automatico: BotMessageSquare,
};

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
 * ── El oro SÍ aparece acá, y es una excepción a propósito ──
 * (20-ago-2026, pedido explícito) Antes esta regla decía que el dorado (`--gold`)
 * es solo «tiempo que se acaba» y un modo no corre ningún plazo, así que no lo
 * llevaba. Se pidió igual para el anillo: vacío apagado · medio dorado sombra ·
 * completo y sólido dorado automático, el único en el que un lead recibe algo.
 * Ya no hay forma de decir «frenado» ni «modo raro» en rojo (se fueron con el
 * recorte a solo-anillo) — si eso vuelve a hacer falta, el dorado del anillo NO
 * es el lugar: confundiría «está mandando» con «se está por acabar el tiempo».
 */
export function InterruptorBot() {
  const { vista, cargando, cambiando, cambiarModo } = useBot();

  if (cargando) return <div className="size-12 animate-pulse rounded-full bg-muted" />;
  // El server viejo (front por N4, server por N5) no tiene la ruta: ahí esta
  // feature no existe, así que el chip tampoco. Alarmar por algo que en ese
  // server no está sería ruido.
  if (vista.clase === 'ausente') return null;

  // 🔴 **Reducido a solo el anillo** (20-ago-2026, pedido explícito): sin
  // contenedor, sin ícono de robot, sin el texto de aviso/fuente/freno que
  // vivían alrededor. El anillo agrandó al alto que ocupaba el chip entero
  // (48px, medido en el DOM antes del recorte — era `size-6`/24px, ahora
  // `size-12`/48px, el doble). Lo que se pierde: el aviso rojo de FRENADO/MODO
  // RARO, el «de dónde sale el modo» y el botón de soltar el freno — si hace
  // falta, `title` sigue llevando `vista.detalle` completo.
  if (!vista.puedeCambiar) {
    return <span className="font-mono text-[11px] text-muted-foreground" title={vista.detalle}>{vista.etiqueta}</span>;
  }

  return <AnilloDeModo vista={vista} deshabilitado={cambiando} onElegir={cambiarModo} />;
}

/**
 * EL ANILLO DE MODO — un solo botón circular en vez de tres segmentos.
 *
 * Un clic avanza un escalón: apagado → sombra → automático → apagado, en un
 * ciclo. El TRAZO dorado dice cuánto: vacío en apagado, a mitad de vuelta en
 * sombra, dando la vuelta entera en automático — un anillo que se completa,
 * nunca un disco relleno (se probaron las dos y se descartó el relleno:
 * un trazo lee mejor «progreso», un disco sólido lee «ocupado»).
 *
 * ⚠️ **Deja de ser un `radiogroup`**: no se puede saltar directo a un modo, solo
 * avanzar. `aria-label` dice el modo actual y a cuál pasa el próximo clic, para
 * que un lector de pantalla no pierda la información que el `radiogroup` daba
 * gratis. Con el modo en `null` (el server informó uno que esta app no conoce)
 * el anillo arranca vacío, como apagado: el próximo clic manda a apagado de
 * verdad, nunca inventa un salto a la mitad.
 */
function AnilloDeModo({
  vista,
  deshabilitado,
  onElegir,
}: {
  vista: VistaBot;
  deshabilitado: boolean;
  onElegir: (m: ModoBot) => void;
}) {
  // El SVG mide 48px reales sobre un viewBox de 24 unidades (2px por unidad),
  // así que `strokeWidth={2}` = 4px de grosor real, a propósito.
  const RADIO = 8;
  const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
  const indiceActual = vista.modo ? MODOS_BOT.indexOf(vista.modo) : -1;
  const fraccion = Math.max(indiceActual, 0) / (MODOS_BOT.length - 1);
  const siguiente = MODOS_BOT[(indiceActual + 1 + MODOS_BOT.length) % MODOS_BOT.length];

  return (
    <button
      type="button"
      disabled={deshabilitado}
      onClick={() => onElegir(siguiente)}
      title={`${vista.modo ? NOMBRE_MODO[vista.modo] : 'Sin modo puesto'} — clic para pasar a ${NOMBRE_MODO[siguiente]}`}
      aria-label={`Modo del bot${vista.numero ? ` de la línea ${vista.numero}` : ''}: ${vista.modo ? NOMBRE_MODO[vista.modo] : 'sin modo puesto'}. Clic para pasar a ${NOMBRE_MODO[siguiente]}.`}
      className="group relative flex size-12 shrink-0 items-center justify-center rounded-full transition-transform duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default active:scale-90"
    >
      {/* `stroke-dashoffset` es un número simple — a diferencia de un
          `background` con gradiente, SÍ lo anima una `transition` común, sin
          necesitar `@property`. El `-rotate-90` arranca el trazo arriba (las
          12), como un reloj de arena vaciándose al revés. */}
      <svg viewBox="0 0 24 24" className="size-12 -rotate-90">
        <circle cx="12" cy="12" r={RADIO} fill="none" stroke="var(--border)" strokeWidth={2} />
        <circle
          cx="12"
          cy="12"
          r={RADIO}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={CIRCUNFERENCIA}
          strokeDashoffset={CIRCUNFERENCIA * (1 - fraccion)}
          className="transition-[stroke-dashoffset] duration-500 ease-house"
        />
      </svg>

      {/* El ícono dice QUÉ modo es sin tener que leer el trazo — el trazo dice
          CUÁNTO falta para el próximo. Las dos lecturas conviven: una es
          discreta (tres iconos, tres modos) y la otra continua (0→180→360°). */}
      {(() => {
        const IconoModo = vista.modo ? ICONO_MODO[vista.modo] : BotOff;
        return (
          <IconoModo
            size={18}
            className={
              'pointer-events-none absolute inset-0 m-auto ' +
              (vista.modo === 'automatico' ? 'text-gold-ink' : 'text-muted-foreground')
            }
          />
        );
      })()}

      {/* La burbuja del hover — el nombre y QUÉ HACE, con las mismas palabras
          del `title` nativo, pero legibles sin esperar el tooltip del sistema.
          `group-focus-visible` la trae también con teclado, no solo con mouse. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-full top-1/2 mr-2 w-max max-w-40 -translate-y-1/2 translate-x-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left opacity-0 shadow-panel transition-[opacity,transform] duration-200 ease-house group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
      >
        <span className="block text-[11px] font-bold leading-tight text-foreground">
          {vista.modo ? NOMBRE_MODO[vista.modo] : 'Sin modo puesto'}
        </span>
        <span className="block text-[10px] leading-tight text-muted-foreground">
          {vista.modo ? vista.queHace[vista.modo] : 'El server informó un modo que esta app no reconoce.'}
        </span>
      </span>
    </button>
  );
}
