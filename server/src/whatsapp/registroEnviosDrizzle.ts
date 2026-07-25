import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { enviosWa } from '../db/schema.js';
import type { OrdenEnvio, RegistroEnvios } from './envioControlado.js';

/**
 * La auditoría de envíos, contra Postgres (tabla `envios_wa`). El intento se
 * anota ANTES de tocar el transporte (estado `pendiente`); después se resuelve a
 * `enviado` o `fallido`. Así ningún envío —ni siquiera uno bloqueado— pasa sin
 * dejar rastro con el nombre de la vendedora.
 */
export const registroEnviosDrizzle: RegistroEnvios = {
  async registrarIntento(orden: OrdenEnvio): Promise<number> {
    const [fila] = await db
      .insert(enviosWa)
      .values({
        vendedoraId: orden.vendedoraId,
        numeroPropio: orden.numeroPropio,
        telefono: orden.telefono,
        texto: orden.texto,
        referencia: orden.referencia,
        estado: 'pendiente',
        // La marca de la excepción (#125): sin esto, un envío automático y uno
        // humano son indistinguibles en la auditoría.
        automatico: orden.automatico ?? false,
      })
      .returning({ id: enviosWa.id });
    return fila.id;
  },

  async marcarEnviado(id: number, idExterno: string, ocurridoEn: Date): Promise<void> {
    await db
      .update(enviosWa)
      .set({ estado: 'enviado', idExterno, resueltoAt: ocurridoEn })
      .where(eq(enviosWa.id, id));
  },

  async marcarFallido(id: number, motivo: string): Promise<void> {
    await db
      .update(enviosWa)
      .set({ estado: 'fallido', motivo, resueltoAt: new Date() })
      .where(eq(enviosWa.id, id));
  },
};
