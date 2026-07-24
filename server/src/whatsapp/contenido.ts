/**
 * ¿ES ESTO UN MENSAJE, O UN "NO-MENSAJE" DE PROTOCOLO?
 *
 * WhatsApp entrega, por el mismo canal que los mensajes reales, eventos de
 * protocolo que no son nada que la persona haya escrito: recibos de lectura,
 * revokes ("borrar para todos"), ajustes de mensajes efímeros, distribución
 * de claves de grupo, reacciones, votos de encuesta. Antes del fix (#70),
 * `transporteWhatsmeow` los ingería igual y la UI los mostraba como
 * «(no es texto)» — un contacto que nunca escribió nada aparecía con un
 * mensaje fantasma.
 *
 * Esta función es pura: mira las keys del proto crudo (`Object.keys(message)`,
 * el mismo vocabulario que ya loguea `[wa raw]`) y decide si hay contenido de
 * verdad. `messageContextInfo` se ignora siempre — acompaña a un mensaje real,
 * nunca es uno por sí solo. La media (imagen/video/audio/documento) cuenta
 * como contenido aunque después la descarga falle: eso es «velo en el
 * teléfono», no un no-mensaje — la distinción es a propósito, no un olvido.
 */

/** Tipos que NO son contenido del usuario, aunque vengan solos en el proto. */
const CLAVES_SIN_CONTENIDO = new Set([
  'protocolMessage',
  'senderKeyDistributionMessage',
  'reactionMessage',
  'pollUpdateMessage',
]);

/** Acompaña contenido real; nunca decide nada por sí sola. */
const CLAVE_IGNORADA = 'messageContextInfo';

export function tieneContenido(message: Record<string, unknown>): boolean {
  return Object.keys(message).some(
    (clave) => clave !== CLAVE_IGNORADA && !CLAVES_SIN_CONTENIDO.has(clave),
  );
}
