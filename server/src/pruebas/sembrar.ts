import { randomUUID } from "node:crypto";
import { events, interactions, recordatorios } from "../db/schema.js";
import type { DbDePrueba } from "./base.js";

/**
 * SIEMBRA para los tests con base. Cada helper inserta lo MÍNIMO para que una
 * consulta tenga algo que devolver, con defaults sensatos que el test
 * sobreescribe solo cuando le importa. Nada de fixtures gigantes: el test dice
 * qué hecho está probando y el resto es ruido.
 *
 * Empieza chico (mensaje + recordatorio, lo que necesita el primer test de la
 * cola/radar). Crece cuando un test nuevo lo pida — no antes.
 */

export interface MensajeSembrado {
  canal?: string;
  personaId?: string;
  personaNombre?: string | null;
  texto?: string | null;
  direccion?: "entrante" | "saliente";
  /** El número propio del que sale el hilo — la cola agrupa por él. */
  numeroPropio?: string;
  occurredAt?: Date;
}

/**
 * Siembra un mensaje: el evento crudo (fuente de verdad) + la interacción
 * proyectada. El `numeroPropio` va en el payload del evento, que es de donde la
 * cola y el radar lo sacan (`payload->>'numeroPropio'`). Devuelve el id de la
 * interacción.
 */
export async function sembrarMensaje(db: DbDePrueba, m: MensajeSembrado = {}): Promise<number> {
  const occurredAt = m.occurredAt ?? new Date();
  const numeroPropio = m.numeroPropio ?? "51999999999";
  const ext = randomUUID();

  const [ev] = await db
    .insert(events)
    .values({
      source: "whatsapp",
      externalId: `evt:${ext}`,
      occurredAt,
      payload: { numeroPropio },
    })
    .returning({ id: events.id });

  const [it] = await db
    .insert(interactions)
    .values({
      eventId: ev.id,
      externalId: `wa:${ext}`,
      canal: m.canal ?? "whatsapp",
      tipo: "mensaje",
      direccion: m.direccion ?? "entrante",
      personaId: m.personaId ?? "51900000000",
      personaNombre: m.personaNombre ?? "Lead de prueba",
      texto: m.texto ?? null,
      occurredAt,
    })
    .returning({ id: interactions.id });

  return it.id;
}

export interface RecordatorioSembrado {
  vendedoraId?: string;
  clave: string;
  canal?: string;
  personaId?: string;
  personaNombre?: string | null;
  numeroPropio?: string | null;
  nota?: string;
  /** La fecha del seguimiento. Una fecha pasada = un Vencido. */
  cuando: Date;
  estado?: "pendiente" | "hecho";
}

/**
 * Siembra un seguimiento agendado (la promesa que la vendedora se pone a sí
 * misma). Con `cuando` en el pasado y `estado: 'pendiente'` es un Vencido — lo
 * que el radar tiene que subir al nivel 1 (issue #38).
 */
export async function sembrarRecordatorio(db: DbDePrueba, r: RecordatorioSembrado): Promise<number> {
  const [rec] = await db
    .insert(recordatorios)
    .values({
      vendedoraId: r.vendedoraId ?? "vendedora-prueba",
      clave: r.clave,
      canal: r.canal ?? "whatsapp",
      personaId: r.personaId ?? "51900000000",
      personaNombre: r.personaNombre ?? "Lead de prueba",
      numeroPropio: r.numeroPropio ?? "51999999999",
      nota: r.nota ?? "llamar",
      cuando: r.cuando,
      estado: r.estado ?? "pendiente",
    })
    .returning({ id: recordatorios.id });

  return rec.id;
}
