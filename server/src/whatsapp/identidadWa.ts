/**
 * La traducción entre el identificador de WhatsApp y el teléfono de Hermes.
 *
 * WhatsApp identifica a un contacto con `51987654321@s.whatsapp.net` (y a veces
 * con sufijo de dispositivo, `51987654321:41@...`, o con `@g.us` para grupos).
 * Hermes habla teléfonos pelados y normalizados. Esta conversión vive SOLO acá,
 * adentro del transporte: nada de esto sube a la cola ni a la ficha.
 */

const SERVIDOR_CONTACTO = 's.whatsapp.net';
const SERVIDOR_GRUPO = 'g.us';

/**
 * Normalización canónica: dígitos + prefijo de país 51. Es la MISMA que espera la
 * dedup de Cerberus; si divergen, el contacto de WhatsApp no cruza con el cliente
 * que ya existe en el CRM. Perú es el default (móviles de 9 dígitos que arrancan
 * en 9); un número que ya trae otro código de país se respeta.
 */
export function normalizarTelefono(crudo: string): string | null {
  const digitos = (crudo ?? '').replace(/\D/g, '');
  if (digitos.length < 8) return null;
  if (digitos.length === 9 && digitos.startsWith('9')) return `51${digitos}`;
  return digitos;
}

/**
 * La CLAVE DE MATCH entre teléfonos: los últimos 9 dígitos del número
 * normalizado. Perú guarda y muestra el número de móvil (9 dígitos) con o sin el
 * código de país `51`, según de dónde venga (WhatsApp lo trae con código, un
 * lead-form de Meta a veces sin él, Cerberus lo guarda local). Comparar los 9
 * finales cruza esas variantes sin depender del prefijo — es el mismo criterio
 * que usa la búsqueda en Cerberus (`cerberus/ficha.ts`).
 *
 * Devuelve `null` si el crudo no es un teléfono (no inventa una clave de basura).
 */
export function sufijoTelefono(crudo: string): string | null {
  const normalizado = normalizarTelefono(crudo);
  return normalizado ? normalizado.slice(-9) : null;
}

/** `51987654321:41@s.whatsapp.net` → `51987654321`. Null si es grupo o no deriva. */
export function telefonoDeContacto(jid: string): string | null {
  const [usuario, servidor] = (jid ?? '').split('@');
  if (servidor !== SERVIDOR_CONTACTO) return null; // grupos y @lid no son teléfonos
  return normalizarTelefono(usuario.split(':')[0]);
}

export function esJidDeGrupo(jid: string): boolean {
  return (jid ?? '').endsWith(`@${SERVIDOR_GRUPO}`);
}

/**
 * Teléfono → JID para mandar. Lanza si el teléfono es inválido: llegar acá con
 * basura significa que algo más arriba falló, y armar un JID malo hace que
 * WhatsApp acepte el mensaje y lo pierda en el vacío.
 */
export function jidDeTelefono(telefono: string): string {
  const normalizado = normalizarTelefono(telefono);
  if (!normalizado) throw new Error(`Teléfono inválido para armar un JID: "${telefono}"`);
  return `${normalizado}@${SERVIDOR_CONTACTO}`;
}
