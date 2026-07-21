import { MessageCircle } from 'lucide-react';
import { useSesionWa } from './conversacionWa';

/**
 * El semáforo de WhatsApp en el header. La vendedora ve de un vistazo si el
 * número está conectado, sin abrir ninguna conversación — porque si WhatsApp está
 * caído o baneado, todo lo que haga por ese canal va a fallar, y tiene que
 * saberlo antes de intentarlo.
 */
export function EstadoWhatsapp() {
  const { data: sesion } = useSesionWa();
  if (!sesion) return null;

  const meta = (() => {
    switch (sesion.estado) {
      case 'conectado':
        return { punto: 'bg-temp-fresco', texto: sesion.telefono, tone: 'text-muted-foreground' };
      case 'conectando':
        return { punto: 'bg-gold animate-pulse', texto: 'conectando…', tone: 'text-muted-foreground' };
      case 'baneado':
        return { punto: 'bg-destructive', texto: 'suspendido', tone: 'text-destructive font-bold' };
      case 'sin-vincular':
        return { punto: 'bg-muted-foreground', texto: 'sin vincular', tone: 'text-muted-foreground' };
      default:
        return { punto: 'bg-warning', texto: 'desconectado', tone: 'text-gold-ink' };
    }
  })();

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5" title={`WhatsApp: ${sesion.estado}`}>
      <MessageCircle size={13} className="text-muted-foreground" />
      <span className={'relative flex size-2 items-center justify-center'}>
        <span className={'size-2 rounded-full ' + meta.punto} />
      </span>
      <span className={'font-mono text-xs ' + meta.tone}>{meta.texto}</span>
    </div>
  );
}
