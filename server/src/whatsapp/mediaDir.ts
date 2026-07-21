import { mkdirSync } from 'node:fs';

/**
 * EL DIRECTORIO DE MEDIA DE WHATSAPP — `server/.wa-media/`.
 *
 * Acá viven los adjuntos ya descifrados: lo que la gente manda (el transporte
 * los baja al recibir) y lo que las vendedoras mandan (el server los guarda
 * antes de subirlos). Gitignored, como `.wa-sessions/`: son conversaciones
 * privadas, no código.
 *
 * Los nombres de archivo son sanitizados por quien escribe acá; quien LEE
 * (la ruta que sirve media) revalida igual — nunca se arma un path con entrada
 * del cliente sin filtrar.
 */
export const RUTA_MEDIA = new URL('../../.wa-media/', import.meta.url).pathname;

mkdirSync(RUTA_MEDIA, { recursive: true });

/** Deja solo caracteres seguros para un nombre de archivo. */
export function nombreSeguro(nombre: string): string {
  return nombre.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}
