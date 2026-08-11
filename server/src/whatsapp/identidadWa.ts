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
const SERVIDOR_LID = 'lid';

/**
 * EL PREFIJO DE UNA IDENTIDAD QUE NO ES UN TELÉFONO.
 *
 * ── Por qué existe (medido el 11-ago-2026, línea 51963139984) ──────────────
 *
 * WhatsApp identifica a quien escribe con un **LID** (`195997208682673@lid`),
 * un id anónimo, y **NO entrega su teléfono**: eso no es un hueco de nuestra
 * integración, es el propósito de la función. Se verificó capa por capa:
 *   · `whatsmeow_lid_map` solo trae los contactos que el teléfono YA conocía
 *     (11 filas en una línea nueva) — un lead que escribe por primera vez no
 *     está ahí, y que la línea le ESCRIBA tampoco lo agrega (medido).
 *   · `whatsmeow_contacts` guarda al desconocido con su `push_name` y
 *     **`redacted_phone: null`**.
 *   · `@whatsmeow-node@0.7.0` (la última publicada) no expone NINGÚN comando de
 *     LID en su IPC — se revisaron los ~95: no hay `GetPNForLID` ni equivalente.
 *
 * Antes de esto, un teléfono que no se podía derivar significaba **descartar el
 * mensaje**, y el log lo contaba: `aMensaje devolvió null`. O sea que **todo
 * lead nuevo no agendado se perdía en silencio**. Un chat con un desconocido es
 * exactamente el caso que un CRM existe para atender.
 *
 * ── Qué se puede y qué no con una identidad `lid:` ────────────────────────
 *
 * SÍ: recibir, agrupar la conversación, responder (whatsmeow manda a `@lid`
 * igual que a un teléfono) y todo el hilo.
 * NO: cruzar con Cerberus ni con el padrón de clientes, que se buscan **por
 * teléfono**. Eso degrada solo: la ficha dice «no se pudo saber», que es la
 * verdad, en vez de mentir. No se inventa un teléfono nunca.
 *
 * ── Por qué un PREFIJO y no una columna nueva ─────────────────────────────
 *
 * La identidad viaja por decenas de firmas (`telefono: string`), la clave de
 * conversación y `interactions.persona_id`. Un prefijo hace que lo que no es un
 * teléfono sea **imposible de confundir** con uno: `sufijoTelefono` y
 * `clienteSql` no matchean, y `jidDeTelefono` lo rutea a su servidor. Una
 * columna nueva obligaría a tocar cada consumidor y el que se olvidara trataría
 * el lid como número.
 *
 * 🔴 **EL SEPARADOR ES `-` Y NO `:`, Y NO ES ESTILO.** La clave de conversación
 * es `conv:<canal>:<persona>:<numeroPropio>` (`cola/estado.ts`) y se **parsea
 * por posición** con `split(':')` (`identidad/clave.ts:71`). Un `lid:` adentro
 * la convertiría en cinco segmentos: el puente clave↔persona leería el canal
 * equivocado y el enlace de identidades apuntaría a cualquier lado — sin un
 * error, porque `split` no falla, corre los campos.
 */
export const PREFIJO_LID = 'lid-';

/** `195997208682673:42@lid` → `lid:195997208682673`. Null si no es un JID de LID. */
export function identidadDeLid(jid: string): string | null {
  const [usuario, servidor] = (jid ?? '').split('@');
  if (servidor !== SERVIDOR_LID) return null;
  const pelado = (usuario ?? '').split(':')[0];
  return /^\d+$/.test(pelado) ? `${PREFIJO_LID}${pelado}` : null;
}

/**
 * ¿Esta identidad es un LID y no un teléfono? Se pregunta ANTES de normalizar:
 * `normalizarTelefono('lid:195997208682673')` tira las letras y devolvería
 * `195997208682673` como si fuera un número de 15 dígitos — y con eso se armaría
 * `195997208682673@s.whatsapp.net`, un JID que WhatsApp acepta y deja caer en el
 * vacío. El orden de estas dos preguntas es la garantía.
 */
export function esIdentidadDeLid(identidad: string): boolean {
  return (identidad ?? '').startsWith(PREFIJO_LID);
}

/**
 * LA IDENTIDAD QUE VIENE EN LA URL, saneada sin romperla.
 *
 * Las rutas del hilo y del cursor de lectura sanean su `:telefono` con
 * `replace(/\D/g, '')`, que es correcto para un teléfono y **destruye** una
 * identidad `lid-…`: la dejaría en dígitos pelados, o sea buscando una persona
 * que no existe y devolviendo un hilo vacío **con 200**. Un hueco silencioso,
 * que es el modo de fallar que este repo persigue.
 *
 * Se conserva el saneo para todo lo demás: lo que no es una identidad de LID
 * sigue quedando en dígitos, igual que siempre.
 */
export function identidadDeParametro(crudo: string): string {
  const valor = crudo ?? '';
  if (esIdentidadDeLid(valor)) {
    const pelado = valor.slice(PREFIJO_LID.length).replace(/\D/g, '');
    return pelado ? `${PREFIJO_LID}${pelado}` : '';
  }
  return valor.replace(/\D/g, '');
}

/**
 * Normalización canónica: dígitos + prefijo de país 51. Es la MISMA que espera la
 * dedup de Cerberus; si divergen, el contacto de WhatsApp no cruza con el cliente
 * que ya existe en el CRM. Perú es el default (móviles de 9 dígitos que arrancan
 * en 9); un número que ya trae otro código de país se respeta.
 */
export function normalizarTelefono(crudo: string): string | null {
  // 🔴 LA GUARDA VA ACÁ Y NO EN CADA CONSUMIDOR. Una identidad `lid:` no es un
  // teléfono, y sin esto `replace(/\D/g,'')` le saca las letras y la deja pasar
  // como un número de 15 dígitos. El daño no sería un error visible: sería
  // `sufijoTelefono` devolviendo los últimos 9 de un id anónimo y `clienteSql`
  // cruzándolo con el padrón — o sea, la ficha de OTRA persona pegada a este
  // chat. Un falso positivo acá pinta una venta que no existe (#133).
  if (esIdentidadDeLid(crudo)) return null;
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
export function jidDeTelefono(identidad: string): string {
  // La identidad `lid:` sale por su propio servidor. Va PRIMERO por lo mismo que
  // `normalizarTelefono` la rechaza: si cayera en la rama de abajo se armaría un
  // JID de contacto con el id anónimo adentro, WhatsApp lo aceptaría y el
  // mensaje se perdería sin un solo error. Responder a `<lid>@lid` es lo que
  // hace que un chat con un desconocido funcione en las dos direcciones.
  if (esIdentidadDeLid(identidad)) {
    return `${identidad.slice(PREFIJO_LID.length)}@${SERVIDOR_LID}`;
  }
  const normalizado = normalizarTelefono(identidad);
  if (!normalizado) throw new Error(`Teléfono inválido para armar un JID: "${identidad}"`);
  return `${normalizado}@${SERVIDOR_CONTACTO}`;
}
