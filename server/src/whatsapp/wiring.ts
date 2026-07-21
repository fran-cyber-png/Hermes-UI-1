import { TransporteFalso } from './transporteFalso.js';
import { TransporteWhatsmeow } from './transporteWhatsmeow.js';
import { IngestaWhatsapp } from './ingesta.js';
import { EnvioControlado } from './envioControlado.js';
import { repositorioDrizzle } from './repositorioDrizzle.js';
import { registroEnviosDrizzle } from './registroEnviosDrizzle.js';
import type { TransporteWhatsapp } from './transporte.js';

/**
 * EL ARMADO DE WHATSAPP AL ARRANCAR EL SERVER.
 *
 * Elige el transporte por env (`WHATSAPP_TRANSPORTE`: `falso` o `whatsmeow`), lo
 * engancha a la ingesta (persiste cada mensaje) y monta la única puerta de
 * salida (`EnvioControlado`). Es el ÚNICO lugar que decide qué transporte corre;
 * todo lo demás habla con la interfaz.
 *
 *   · falso     → para desarrollo y demo, sin vincular nada.
 *   · whatsmeow → el real. La sesión se vincula aparte (`npm run wa:vincular`,
 *                 decisión D13); acá solo se conecta a la sesión ya guardada.
 */
export interface WhatsappArmado {
  transporte: TransporteWhatsapp;
  envio: EnvioControlado;
  /** Solo si corre el falso — para la ruta de dev que inyecta mensajes. */
  falso: TransporteFalso | null;
}

let armado: WhatsappArmado | null = null;

export function arrancarWhatsapp(): WhatsappArmado {
  const cual = process.env.WHATSAPP_TRANSPORTE ?? 'falso';

  let transporte: TransporteWhatsapp;
  let falso: TransporteFalso | null = null;

  if (cual === 'whatsmeow') {
    const numero = process.env.WHATSAPP_NUMERO;
    if (!numero) throw new Error('WHATSAPP_TRANSPORTE=whatsmeow necesita WHATSAPP_NUMERO (el número propio ya vinculado con wa:vincular).');
    const dir = new URL('../../.wa-sessions/', import.meta.url).pathname;
    transporte = new TransporteWhatsmeow(numero, dir);
  } else {
    falso = new TransporteFalso({ telefono: process.env.WHATSAPP_NUMERO_FALSO ?? '51987654321' });
    transporte = falso;
  }

  const ingesta = new IngestaWhatsapp(transporte, repositorioDrizzle);
  ingesta.iniciar();
  void transporte.iniciar();

  const envio = new EnvioControlado(transporte, registroEnviosDrizzle);

  armado = { transporte, envio, falso };
  return armado;
}

/** El armado vivo, para las rutas. Lanza si se pide antes de arrancar. */
export function whatsapp(): WhatsappArmado {
  if (!armado) throw new Error('WhatsApp no está arrancado todavía.');
  return armado;
}
