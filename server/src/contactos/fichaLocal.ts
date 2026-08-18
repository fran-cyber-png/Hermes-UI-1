import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { contactoFicha } from '../db/schema.js';
import { normalizarE164 } from '../telefono/identidad.js';

/**
 * LA FICHA RÁPIDA — el seam de `contacto_ficha`, con `db` inyectado (ADR 0008).
 *
 * Lo que la vendedora AVERIGUA en el chat y hasta ahora no tenía dónde caer:
 * apellido real, empresa, correo dictado, prioridad. Cerberus sigue siendo el
 * dueño del CLIENTE (`cerberus/ficha.ts`); esto es la ficha del LEAD, y por eso
 * `panel/identidad.ts` la lee DESPUÉS de Cerberus, nunca encima.
 *
 * La ruta valida la entrada, llama acá y serializa: nada más.
 */

export type FilaFicha = typeof contactoFicha.$inferSelect;

/** Ya normalizado por la ruta: acá llegan tipos resueltos, no el cuerpo crudo. */
export interface DatosFicha {
  clave: string;
  telefono: string | null;
  nombre: string | null;
  apellido: string | null;
  empresa: string | null;
  email: string | null;
  prioridad: string | null;
  vendedoraId: string;
}

/** La ficha de esta conversación, o `null` si todavía nadie la registró. */
export async function consultarFicha(base: typeof db, clave: string): Promise<FilaFicha | null> {
  const [fila] = await base.select().from(contactoFicha).where(eq(contactoFicha.clave, clave)).limit(1);
  return fila ?? null;
}

/**
 * ¿ESTA PERSONA YA ESTÁ REGISTRADA EN OTRA CONVERSACIÓN?
 *
 * Se pregunta por teléfono (normalizado a E.164 con la misma función con la que
 * se guarda) y por correo (sin distinguir mayúsculas). Devuelve la ficha que ya
 * existe para que la pantalla ofrezca ABRIRLA o ACTUALIZARLA — nunca para
 * bloquear en seco: una persona puede escribir por WhatsApp y por Messenger, y
 * las dos conversaciones son ciertas.
 *
 * ⚠️ El match es EXACTO sobre el normalizado. La unificación fina cross-canal
 * (grafías, país ambiguo) ya tiene su módulo —`identidad/`, `telefono/`— y no se
 * duplica acá: esto atrapa el duplicado obvio, que es el que se comete.
 */
export async function fichaDuplicada(
  base: typeof db,
  o: { clave: string; telefono: string | null; email: string | null },
): Promise<FilaFicha | null> {
  const tel = o.telefono ? normalizarE164(o.telefono) : '';
  const mail = o.email?.trim().toLowerCase() ?? '';
  if (!tel && !mail) return null;

  const condiciones = [
    tel ? eq(contactoFicha.telefono, tel) : null,
    mail ? sql`lower(${contactoFicha.email}) = ${mail}` : null,
  ].filter((c) => c != null);

  const [fila] = await base
    .select()
    .from(contactoFicha)
    .where(and(ne(contactoFicha.clave, o.clave), or(...condiciones)))
    .limit(1);
  return fila ?? null;
}

/**
 * Registrar o actualizar. Es un upsert por `clave` a propósito: «registrar» y
 * «completar un dato que faltaba» son el mismo gesto para quien lo hace, y dos
 * rutas distintas obligarían a la pantalla a saber cuál de las dos es — que es
 * justo lo que la vendedora no tiene por qué recordar.
 *
 * `vendedora_id` NO se pisa al actualizar: dice quién la registró, no quién la
 * tocó último.
 */
export async function guardarFicha(base: typeof db, o: DatosFicha): Promise<FilaFicha> {
  const valores = {
    telefono: o.telefono ? normalizarE164(o.telefono) : null,
    nombre: o.nombre,
    apellido: o.apellido,
    empresa: o.empresa,
    email: o.email,
    prioridad: o.prioridad,
  };
  const [fila] = await base
    .insert(contactoFicha)
    .values({ clave: o.clave, vendedoraId: o.vendedoraId, ...valores })
    .onConflictDoUpdate({
      target: contactoFicha.clave,
      set: { ...valores, actualizadoAt: new Date() },
    })
    .returning();
  return fila;
}
