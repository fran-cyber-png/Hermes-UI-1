/**
 * EL BORRADOR DEL COMPOSER, por conversación (issue #3, red mínima §3.1.12).
 *
 * Antes vivía en un `useState('')` DENTRO de `HiloWhatsapp` — al cambiar de
 * `telefono` el componente no se desmonta (React lo reusa), así que el texto
 * a medio escribir en el chat de A quedaba pegado y aparecía en el composer
 * de B. Este Map vive a nivel de MÓDULO, afuera del ciclo de vida de React:
 * sobrevive al cambio de conversación porque no depende de él.
 *
 * Solo el TEXTO se persiste acá. El adjunto (`File` elegido pero sin enviar)
 * es intencionalmente efímero — no se guarda por conversación (decisión del
 * orquestador): un `File` no se puede clonar barato ni serializar, y el caso
 * de "elegir adjunto, cambiar de chat, volver" es raro comparado con el de
 * texto a medio escribir. Si se vuelve un problema real, es una extensión
 * aparte, no una que valga la pena anticipar acá.
 *
 * Puro y sin DOM a propósito: así se testea con vitest en `environment: node`
 * (ver `vitest.config.ts`), sin montar el componente.
 */
const borradores = new Map<string, string>();

/** El borrador guardado para ese teléfono, o cadena vacía si no hay ninguno. */
export function leerBorrador(telefono: string): string {
  return borradores.get(telefono) ?? '';
}

/** Guarda el borrador. Texto vacío borra la entrada (no acumula basura). */
export function guardarBorrador(telefono: string, texto: string): void {
  if (texto === '') {
    borradores.delete(telefono);
    return;
  }
  borradores.set(telefono, texto);
}

/** Limpia el borrador de un teléfono — se usa tras un envío exitoso. */
export function limpiarBorrador(telefono: string): void {
  borradores.delete(telefono);
}
