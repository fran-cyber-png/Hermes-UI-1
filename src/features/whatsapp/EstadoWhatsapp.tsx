import { MessageCircle } from 'lucide-react';
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
 */
export function EstadoWhatsapp() {
  const { data: sesion, isPending, isError } = useSesionWa();

  if (isPending) return <div className="h-7 w-32 animate-pulse rounded-lg bg-muted" />;

  if (isError || !sesion) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5" title="WhatsApp: sin señal del server">
        <MessageCircle size={13} className="text-muted-foreground" />
        <span className="size-2 rounded-full bg-muted-foreground" />
        <span className="font-mono text-[11px] text-muted-foreground">sin señal del server</span>
      </div>
    );
  }

  const meta = (() => {
    switch (sesion.estado) {
      case 'conectado':
        return { punto: 'bg-temp-fresco', texto: formatoTelefono(sesion.telefono), tone: 'text-muted-foreground' };
      case 'conectando':
        return { punto: 'bg-primary animate-pulse', texto: 'conectando…', tone: 'text-muted-foreground' };
      case 'baneado':
        return { punto: 'bg-destructive', texto: 'suspendido', tone: 'font-bold text-destructive' };
      case 'sin-vincular':
        return { punto: 'bg-muted-foreground', texto: 'sin vincular', tone: 'text-muted-foreground' };
      default:
        return { punto: 'bg-warning', texto: 'desconectado', tone: 'font-semibold text-foreground' };
    }
  })();

  return (
    <div
      className={
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ' +
        (sesion.estado === 'baneado' ? 'border-destructive/40 bg-destructive/10' : 'border-border')
      }
      title={`WhatsApp: ${meta.texto}`}
    >
      <MessageCircle size={13} className="text-muted-foreground" />
      <span className={'size-2 rounded-full ' + meta.punto} />
      <span className={'font-mono text-[11px] ' + meta.tone}>{meta.texto}</span>
    </div>
  );
}
