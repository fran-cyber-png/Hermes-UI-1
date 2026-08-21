import { useSesionWa } from './conversacionWa';
import { formatoTelefono } from '../../lib/formato';

/**
 * El semáforo de WhatsApp en el header. La vendedora ve de un vistazo si el
 * número está conectado — si WhatsApp está caído o baneado, todo lo que haga por
 * ese canal va a fallar, y tiene que saberlo antes de intentarlo.
 *
 * Nunca desaparece: "no sé cómo está" también es un estado y se muestra. El
 * punto de "conectando" es azul (actividad del sistema); el oro no significa
 * eso. El ban tiñe el chip entero: es el estado que JAMÁS se esconde.
 *
 * ── El tamaño y la forma (20-ago-2026, pedido explícito) ──
 * Alto **48px** — el mismo que el anillo del bot (`InterruptorBot.tsx`,
 * `size-12`), para que los dos elementos de la derecha del header respiren
 * igual. Dos renglones, sin caja: el rótulo del estado arriba («EN LÍNEA»,
 * en mayúsculas — es el molde de los avisos rojos de esta misma barra, acá en
 * la tinta del estado) y el número abajo, cuando lo hay. Sin `border`/`bg`:
 * el mismo recorte que ya se le hizo al chip del bot.
 */
export function EstadoWhatsapp() {
  const { data: sesion, isPending, isError } = useSesionWa();

  if (isPending) return <div className="h-12 w-28 animate-pulse rounded-lg bg-muted" />;

  if (isError || !sesion) {
    return (
      <div className="flex h-12 flex-col items-end justify-center gap-0.5" title="WhatsApp: sin señal del server">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase leading-none tracking-wide text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground" />
          Sin señal
        </span>
      </div>
    );
  }

  const meta = (() => {
    switch (sesion.estado) {
      case 'conectado':
        return { punto: 'bg-temp-fresco', etiqueta: 'En línea', numero: formatoTelefono(sesion.telefono), tone: 'text-muted-foreground' };
      case 'conectando':
        return { punto: 'bg-primary animate-pulse', etiqueta: 'Conectando…', numero: null, tone: 'text-muted-foreground' };
      case 'baneado':
        return { punto: 'bg-destructive', etiqueta: 'Suspendido', numero: null, tone: 'font-bold text-destructive' };
      case 'sin-vincular':
        return { punto: 'bg-muted-foreground', etiqueta: 'Sin vincular', numero: null, tone: 'text-muted-foreground' };
      default:
        return { punto: 'bg-warning', etiqueta: 'Desconectado', numero: null, tone: 'font-semibold text-foreground' };
    }
  })();

  return (
    <div
      className="flex h-12 flex-col items-end justify-center gap-0.5"
      title={`WhatsApp: ${meta.etiqueta}${meta.numero ? ` · ${meta.numero}` : ''}`}
    >
      <span className={'flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase leading-none tracking-wide ' + meta.tone}>
        <span className={'size-2 rounded-full ' + meta.punto} />
        {meta.etiqueta}
      </span>
      {meta.numero && <span className="font-mono text-[11px] leading-none text-muted-foreground">{meta.numero}</span>}
    </div>
  );
}
