/**
 * Las iniciales para el avatar de un contacto. "Andre Q." → "AQ"; "@marisol" →
 * "MA"; sin nombre → "·" (nunca un avatar vacío).
 *
 * Fuente única: antes esta función vivía copiada en FilaConversacion,
 * PanelContexto, VistaDashboard y ResponderPanel. La usa `Avatar` como fallback
 * cuando no hay foto de perfil.
 */
export function iniciales(nombre: string | null | undefined): string {
  if (!nombre) return '·';
  const limpio = nombre.replace(/^@/, '').trim();
  if (!limpio) return '·';
  const partes = limpio.split(/\s+/).filter(Boolean);
  const dos = partes.length >= 2 ? partes[0][0] + partes[1][0] : limpio.slice(0, 2);
  return dos.toUpperCase();
}
