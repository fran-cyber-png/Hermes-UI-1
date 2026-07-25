import { formatoTelefono } from '../../lib/formato';

/**
 * DE DÓNDE SALIÓ CADA DATO — la etiqueta de origen de la ficha unificada (#58).
 *
 * Unificar sin decir de dónde salió cada cosa es cómo se fabrica un Frankenstein que nadie
 * puede auditar después. Cuando la ficha de Rosa muestra un interés que ella nunca pidió por
 * este chat, la vendedora tiene que poder ver, sin hacer clic, que vino «de +51 987 654 321».
 *
 * En WhatsApp el identificador ES el teléfono, y un teléfono se lee formateado. En Instagram
 * lo legible es el usuario; el id numérico de Meta no le dice nada a nadie y por eso, cuando
 * no hay nombre, se dice el canal y no el número.
 */
export function etiquetaDeOrigen(
  canal: string,
  personaId: string,
  nombre: string | null,
): string {
  if (canal === 'whatsapp') return formatoTelefono(personaId);
  if (canal === 'instagram') return nombre ? `@${nombre}` : 'Instagram';
  if (canal === 'facebook') return nombre ?? 'Messenger';
  return nombre ?? personaId;
}
