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
import { olvidarPieza } from './procedenciaComposer';

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

/**
 * Lo que necesita `ejecutarEnvioComposer` para mandar y decidir qué limpiar,
 * inyectado desde React: así se testea sin DOM y sin mockear TanStack Query.
 */
export interface DependenciasEnvioComposer {
  /** El teléfono de la conversación para la que se armó ESTE envío. */
  telefonoDelEnvio: string;
  texto: string;
  adjunto: File | null;
  enviarTexto: (texto: string) => Promise<unknown>;
  enviarConAdjunto: (adjunto: File, caption: string) => Promise<unknown>;
  /** La conversación que se ve AHORA — se lee recién al resolver, no antes. */
  telefonoVisibleAhora: () => string;
  limpiarTextoVisible: () => void;
  limpiarAdjuntoVisible: () => void;
}

/**
 * Todo el flujo de un envío desde el composer: manda (texto solo, o con
 * adjunto como caption), y al resolver limpia el borrador GUARDADO del
 * teléfono que se envió — siempre, ya se mandó — pero solo toca el composer
 * VISIBLE si la conversación que se ve ahora sigue siendo esa.
 *
 * La carrera que esto cierra (detectada en la review de PR #84): `onEnviar`
 * hacía `await mutateAsync(...); setTexto('')` con el `telefono` capturado
 * al ARRANCAR el envío. Si la vendedora cambiaba de conversación mientras el
 * envío volaba, ese `setTexto('')` tardío pisaba el composer de la
 * conversación NUEVA en vez de la que se mandó. Por eso `telefonoVisibleAhora`
 * es una función (no un valor): se evalúa al resolver, no al arrancar.
 */
export async function ejecutarEnvioComposer(deps: DependenciasEnvioComposer): Promise<void> {
  const {
    telefonoDelEnvio,
    texto,
    adjunto,
    enviarTexto,
    enviarConAdjunto,
    telefonoVisibleAhora,
    limpiarTextoVisible,
    limpiarAdjuntoVisible,
  } = deps;
  const t = texto.trim();

  if (adjunto) {
    // Con adjunto, el texto de la caja viaja como caption (como en WhatsApp).
    await enviarConAdjunto(adjunto, t);
    limpiarBorrador(telefonoDelEnvio);
    olvidarPieza(telefonoDelEnvio); // ese envío ya usó su pieza (#169)
    if (telefonoVisibleAhora() === telefonoDelEnvio) {
      limpiarAdjuntoVisible();
      limpiarTextoVisible();
    }
    return;
  }

  if (!t) return; // nada que mandar
  await enviarTexto(t);
  limpiarBorrador(telefonoDelEnvio);
  if (telefonoVisibleAhora() === telefonoDelEnvio) {
    limpiarTextoVisible();
  }
}
