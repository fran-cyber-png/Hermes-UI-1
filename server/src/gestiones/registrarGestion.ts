import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { gestiones, recordatorios } from '../db/schema.js';

/**
 * REGISTRAR UNA GESTIÓN — el seam de la bitácora comercial y sus COMPUERTAS.
 *
 * Extraído de la ruta (`routes/gestiones.ts`) al patrón de `consultarCola`:
 * recibe `db` INYECTADO — la ruta le pasa el singleton, el test su base de
 * prueba (ADR 0008, `registrarGestion.test.db.ts`). Así las compuertas quedan
 * fijadas como COMPORTAMIENTO, no como texto en una ruta:
 *
 *   · a COTIZADO no se llega sin al menos un INTERÉS registrado — no se cotiza
 *     lo que no se sabe qué es;
 *   · a CIERRE no se llega sin VENTA REGISTRADA — el cierre no se declara, se
 *     gana. (La ruta de venta lo asienta sola al crear la venta.)
 *
 * Los modales del Pipeline (#60) SATISFACEN estas compuertas — no las evitan:
 * la validación vive acá, del lado del server, y no se relaja.
 */

export const ETAPAS = ['interesado', 'contactado', 'cotizado', 'cierre', 'perdido'] as const;
export const ACCIONES = ['wsp', 'llamada', 'correo', 'reunion'] as const;

export type EtapaGestion = (typeof ETAPAS)[number];

/** Los valores viejos siguen siendo válidos al leer: se normalizan, no se rompen. */
export function normalizarEtapa(e: string): string {
  if (e === 'nuevo') return 'interesado';
  if (e === 'venta') return 'cierre';
  return e;
}

const NOMBRE_ACCION: Record<string, string> = {
  wsp: 'Wsp de seguimiento',
  llamada: 'Llamada',
  correo: 'Correo',
  reunion: 'Reunión',
};

/** El teléfono de una conversación de WhatsApp, para la compuerta del cierre. */
function telefonoDeClave(clave: string, personaId?: string | null): string | null {
  const m = /^conv:whatsapp:(\d+):/.exec(clave);
  if (m) return m[1];
  if (personaId && /^\d{8,}$/.test(personaId)) return personaId;
  return null;
}

export interface EntradaGestion {
  vendedoraId: string;
  clave: string;
  canal: string;
  personaId: string | null;
  personaNombre: string | null;
  numeroPropio: string | null;
  /** Ya normalizada y validada contra ETAPAS (eso es HTTP; acá es dominio). */
  etapa: EtapaGestion;
  proximaAccion: string | null;
  proximaFecha: Date | null;
  notas: string | null;
}

export type ResultadoGestion =
  | { ok: true; gestion: typeof gestiones.$inferSelect }
  | { ok: false; message: string };

export async function registrarGestion(base: typeof db, g: EntradaGestion): Promise<ResultadoGestion> {
  // ── COMPUERTA 1: cotizado exige saber QUÉ curso quiere. ──
  if (g.etapa === 'cotizado') {
    const [n] = await base.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM intereses WHERE clave = ${g.clave}`,
    );
    if (!n?.n) {
      return {
        ok: false,
        message:
          'Para pasar a Cotizado hay que saber qué curso le interesa: registrá al menos un interés (puede tener varios).',
      };
    }
  }

  // ── COMPUERTA 2: el cierre no se declara — se gana registrando la venta. ──
  if (g.etapa === 'cierre') {
    const telefono = telefonoDeClave(g.clave, g.personaId);
    const [venta] = telefono
      ? await base.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM conversiones_wa WHERE telefono = ${telefono}`,
        )
      : [{ n: 0 }];
    if (!venta?.n) {
      return {
        ok: false,
        message:
          'A Cierre se llega registrando la venta (botón "Registrar venta" en la ficha). Al crearla, el lead pasa solo.',
      };
    }
  }

  const [gestion] = await base
    .insert(gestiones)
    .values({
      vendedoraId: g.vendedoraId,
      clave: g.clave,
      canal: g.canal,
      personaId: g.personaId,
      personaNombre: g.personaNombre,
      numeroPropio: g.numeroPropio,
      etapa: g.etapa,
      proximaAccion: g.proximaAccion,
      proximaFecha: g.proximaFecha,
      notas: g.notas,
    })
    .returning();

  // La próxima acción con fecha ES una promesa: va derecho a la Agenda.
  if (gestion.proximaAccion && gestion.proximaFecha) {
    await base.insert(recordatorios).values({
      vendedoraId: g.vendedoraId,
      clave: gestion.clave,
      canal: gestion.canal,
      personaId: gestion.personaId,
      personaNombre: gestion.personaNombre,
      numeroPropio: gestion.numeroPropio,
      nota: `${NOMBRE_ACCION[gestion.proximaAccion]}${gestion.notas ? ` · ${gestion.notas.slice(0, 80)}` : ''}`,
      cuando: gestion.proximaFecha,
    });
  }

  return { ok: true, gestion };
}
