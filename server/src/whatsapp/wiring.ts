import { TransporteFalso } from './transporteFalso.js';
import { IngestaWhatsapp } from './ingesta.js';
import { repositorioDrizzle } from './repositorioDrizzle.js';
import type { TransporteWhatsapp } from './transporte.js';

/**
 * El armado de WhatsApp al arrancar el server.
 *
 * Elige el transporte por env (`WHATSAPP_TRANSPORTE`), lo engancha a la ingesta
 * (que persiste cada mensaje en el event store) y lo inicia. Es el único lugar
 * que decide QUÉ transporte corre; todo lo demás habla con la interfaz.
 *
 * Hoy solo existe el falso: el transporte whatsmeow lo escribe el equipo y se
 * enchufa acá cambiando este switch, sin tocar la ingesta ni la proyección.
 */
export function arrancarWhatsapp(): {
  transporte: TransporteWhatsapp;
  /** El falso expuesto solo si es el que está corriendo — para la ruta de dev. */
  falso: TransporteFalso | null;
} {
  const cual = process.env.WHATSAPP_TRANSPORTE ?? 'falso';

  if (cual !== 'falso') {
    // Cuando exista `transporteWhatsmeow.ts` (lo escribe el equipo), se instancia
    // acá. Hasta entonces, pedir otro transporte es un error de configuración
    // explícito, no un arranque silencioso contra nada.
    throw new Error(
      `WHATSAPP_TRANSPORTE="${cual}" todavía no existe. Por ahora solo "falso". El transporte whatsmeow lo escribe el equipo (ver docs/plan-hermes-mvp.md S0).`,
    );
  }

  const falso = new TransporteFalso({
    telefono: process.env.WHATSAPP_NUMERO_FALSO ?? '51987654321',
  });

  const ingesta = new IngestaWhatsapp(falso, repositorioDrizzle);
  ingesta.iniciar();
  void falso.iniciar();

  return { transporte: falso, falso };
}
