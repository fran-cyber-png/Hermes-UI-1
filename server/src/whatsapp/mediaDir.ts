import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
// `fileURLToPath`, no `.pathname`: en Windows nativo `.pathname` de un `file://`
// da `/C:/Users/...` (la barra inicial no es parte de la ruta) — pasarlo tal
// cual a `mkdirSync` resolvía relativo al cwd y duplicaba la unidad (`C:\C:\...`).
export const RUTA_MEDIA = fileURLToPath(new URL('../../.wa-media/', import.meta.url));

mkdirSync(RUTA_MEDIA, { recursive: true });

/** Deja solo caracteres seguros para un nombre de archivo. */
export function nombreSeguro(nombre: string): string {
  return nombre.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}
