import { desc } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { correos } from '../db/schema.js';

/**
 * EL SEAM DE CORREOS — dónde la auditoría del canal email toca la base.
 *
 * Recibe `db` INYECTADO (estilo `consultarSenales`/`registrarEvento`): la ruta le
 * pasa el singleton, el test su base de prueba. Ver ADR 0008.
 *
 * Lo que vive acá es SOLO la persistencia: quién mandó qué a quién y si salió.
 * El SMTP no entra —esa es la cáscara del router— y la política tampoco: un
 * correo sigue siendo UNA vendedora → UN destinatario, una acción humana (la
 * misma filosofía que `EnvioControlado`). Los fallidos también se guardan: un
 * intento que no salió es un dato, no un silencio.
 */

/** Una fila de `correos` tal como la sirve la API (las claves del schema). */
export type FilaCorreo = typeof correos.$inferSelect;

/**
 * Lo que se audita de un correo, antes de saber si salió. Es lo mismo para el
 * enviado y para el fallido: lo único que los separa es el `estado` (y el
 * `motivo`, que solo existe cuando algo se rompió).
 */
export interface CorreoAAuditar {
  vendedoraId: string;
  para: string;
  asunto: string;
  cuerpo: string;
  clave: string | null;
}

/**
 * Los últimos enviados (del equipo — coordinación, no secreto).
 *
 * Sin `WHERE vendedora_id`, a propósito: acá se mira para no escribirle dos
 * veces a la misma persona, y para eso hace falta ver lo que mandaron las otras.
 */
export async function ultimosCorreos(base: typeof db): Promise<FilaCorreo[]> {
  return await base.select().from(correos).orderBy(desc(correos.creadoAt)).limit(50);
}

/** El correo salió: queda la fila, y se devuelve para que la UI la pinte. */
export async function anotarCorreoEnviado(
  base: typeof db,
  correo: CorreoAAuditar,
): Promise<FilaCorreo> {
  const [fila] = await base
    .insert(correos)
    .values({ ...correo, estado: 'enviado' })
    .returning();
  return fila;
}

/**
 * El correo NO salió: queda la fila igual, con el motivo que dio el SMTP.
 *
 * No devuelve nada porque no hay nada que pintar: al que intentó se le contesta
 * con el error, y esta fila existe para la auditoría, no para la pantalla.
 */
export async function anotarCorreoFallido(
  base: typeof db,
  correo: CorreoAAuditar,
  motivo: string,
): Promise<void> {
  await base.insert(correos).values({ ...correo, estado: 'fallido', motivo });
}
