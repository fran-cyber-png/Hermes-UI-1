import { MessageCircle, MessageSquare, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Interaccion } from './types';

/**
 * Los tres tipos que hay que distinguir de un vistazo:
 *
 *   INFO       — comentó pidiendo información. Es un lead. Es lo único que urge.
 *   COMENTARIO — comentó otra cosa ("👏", una opinión). Conversación, no venta.
 *   CHAT       — te escribió por privado. Ya está en una conversación.
 *
 * La diferencia no es cosmética: define qué haces. Al INFO le respondés hoy;
 * al COMENTARIO, cuando puedas; al CHAT ya lo tienes adentro.
 */
export type TipoVisual = 'info' | 'comentario' | 'chat';

export function tipoDe(i: Interaccion): TipoVisual {
  if (i.tipo === 'mensaje') return 'chat';
  return i.pide_info ? 'info' : 'comentario';
}

/**
 * El chip que nombra el tipo. Solo eso: `borde` y `punto` vivieron acá sin que
 * nadie los leyera nunca, y cargaban el oro que ya no corresponde.
 *
 * «Pide info» NO va en dorado. El oro significa una sola cosa en Hermes —
 * tiempo que se acaba (la ventana de Meta, lo vencido, la línea del ahora) — y
 * una oportunidad no es un reloj. Va en el azul de atención de la casa, el
 * mismo literal que ya usa `FilaConversacion`: una señal, un color.
 */
export const TIPO_META: Record<TipoVisual, { label: string; icon: LucideIcon; chip: string }> = {
  info: {
    label: 'Pide info',
    icon: Sparkles,
    chip: 'bg-primary/10 text-primary',
  },
  comentario: {
    label: 'Comentario',
    icon: MessageCircle,
    chip: 'bg-muted text-muted-foreground',
  },
  chat: {
    label: 'Chat',
    icon: MessageSquare,
    chip: 'bg-accent text-accent-foreground',
  },
};
