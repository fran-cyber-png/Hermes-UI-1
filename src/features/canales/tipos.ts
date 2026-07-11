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

export const TIPO_META: Record<
  TipoVisual,
  { label: string; icon: LucideIcon; chip: string; borde: string; punto: string }
> = {
  info: {
    label: 'Pide info',
    icon: Sparkles,
    // El dorado es la señal funcional de Goberna: aquí marca la oportunidad.
    chip: 'bg-gold/20 text-gold-ink',
    borde: 'border-l-gold',
    punto: 'bg-gold',
  },
  comentario: {
    label: 'Comentario',
    icon: MessageCircle,
    chip: 'bg-muted text-muted-foreground',
    borde: 'border-l-border',
    punto: 'bg-muted-foreground/40',
  },
  chat: {
    label: 'Chat',
    icon: MessageSquare,
    chip: 'bg-accent text-accent-foreground',
    borde: 'border-l-primary',
    punto: 'bg-primary',
  },
};
