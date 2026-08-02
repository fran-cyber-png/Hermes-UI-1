import { gestorWhatsappSiActivo } from "../whatsapp/wiring.js";

/**
 * ¿ESTA LÍNEA ESTÁ CONECTADA AHORA MISMO?
 *
 * Una función de tres líneas con archivo propio, y hay motivo: esta lectura ya
 * se escribió mal una vez. En `armarHechos` (orquestador) decía
 * `String(l.transporte.estado()) === "conectado"` — `estado()` devuelve un
 * OBJETO (`{estado, telefono}`), así que comparaba `"[object Object]"` y era
 * **siempre falso**: en cuanto el valor se empezó a usar de verdad, el bot
 * descartó TODOS los entrantes con motivo `desconectado`. La ruta `/lineas` leía
 * bien el mismo objeto: eran dos lecturas y solo una estaba bien.
 *
 * Ahora hay una, y la usan los dos que la necesitan: el pipeline que contesta y
 * el reenganche que inicia.
 *
 * Vive fuera de `frenos.ts` a propósito: aquel es puro (se testea sin base ni
 * red) y esto importa el wiring del transporte. Meterlo ahí obligaría a los
 * tests puros de los frenos a levantar medio server.
 */
export function lineaConectada(numeroPropio: string): boolean {
  const gestor = gestorWhatsappSiActivo();
  if (!gestor) return false;
  return gestor
    .todos()
    .some((l) => l.numero === numeroPropio && l.transporte.estado().estado === "conectado");
}
