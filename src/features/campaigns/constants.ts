import { Eye, Link2, MessageCircle, ShoppingCart, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Conocidos hoy sin necesitar el catálogo de productos (que vive en la DB
// compartida con app.goberna.pe, todavía no conectada). Puramente informativo
// por ahora — no se persiste en ningún lado.
export const PORTFOLIOS = ['Escuela', 'Consultoría', 'Editorial', 'LifeStyle'] as const;

export const MONTHS_ABREV_ES = [
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
];

// Copys aproximados a los que usa el propio Ads Manager de Meta para cada
// objetivo — puramente presentación, el value real sale del backend.
export const OBJECTIVE_INFO: Record<string, { icon: LucideIcon; blurb: string }> = {
  OUTCOME_AWARENESS: { icon: Eye, blurb: 'Mostrar tus anuncios a quienes más probablemente los recuerden.' },
  OUTCOME_TRAFFIC: { icon: Link2, blurb: 'Enviar personas a un destino: sitio web, app o WhatsApp.' },
  OUTCOME_ENGAGEMENT: { icon: MessageCircle, blurb: 'Conseguir mensajes, interacciones o reproducciones de video.' },
  OUTCOME_LEADS: { icon: Target, blurb: 'Recopilar clientes potenciales para tu negocio.' },
  OUTCOME_SALES: { icon: ShoppingCart, blurb: 'Encontrar personas con más probabilidad de comprar.' },
};

export const DATE_PRESETS: { value: import('./types').DatePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'last_7d', label: '7 días' },
  { value: 'last_30d', label: '30 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
];

// Meta manda el "resultado" como un indicator crudo tipo
// "actions:onsite_conversion.purchase" — Meta ya decide cuál es según el
// objetivo de cada campaña, aquí solo lo traducimos a un label legible.
const INDICATOR_LABELS: Record<string, string> = {
  purchase: 'Compras',
  omni_purchase: 'Compras',
  'onsite_conversion.purchase': 'Compras',
  lead: 'Leads',
  onsite_lead: 'Leads',
  'onsite_conversion.lead_grouped': 'Leads',
  link_click: 'Clics en el enlace',
  landing_page_view: 'Vistas de landing',
  post_engagement: 'Interacciones',
  page_engagement: 'Interacciones',
  reach: 'Alcance',
  impressions: 'Impresiones',
  messaging_conversation_started_7d: 'Conversaciones iniciadas',
  onsite_conversion_messaging_conversation_started_7d: 'Conversaciones iniciadas',
};

// Conversiones personalizadas (Meta Events Manager) llegan como
// "offsite_conversion.custom.<ID numérico>" — el ID no tiene nombre legible
// sin una llamada aparte a /customconversions, así que mostramos un label
// genérico en vez de un número crudo sin sentido para el usuario.
const CUSTOM_CONVERSION_RE = /\.custom\.\d+$/;

export function humanizeIndicator(indicator: string | null): string {
  if (!indicator) return '—';
  const key = indicator.replace(/^actions:/, '');
  if (INDICATOR_LABELS[key]) return INDICATOR_LABELS[key];
  if (CUSTOM_CONVERSION_RE.test(key)) return 'Conversión personalizada';
  const tail = key.includes('.') ? key.split('.').pop()! : key;
  if (/^\d+$/.test(tail)) return 'Resultado personalizado';
  return tail.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
