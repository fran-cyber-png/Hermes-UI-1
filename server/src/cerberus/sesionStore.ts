import { eq } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { sesionesCerberus } from '../db/schema.js';
import type { SesionCerberus } from './auth.js';

/**
 * DÓNDE VIVE LA SESIÓN DE CERBERUS DE CADA VENDEDORA.
 *
 * Cuando la vendedora entra a Hermes, guardamos acá su cookie de Cerberus. Así,
 * cuando registra una venta, Hermes POSTea el formulario a Cerberus con ESA
 * cookie — la venta queda atribuida a ella, y ella nunca tuvo que abrir Cerberus.
 *
 * PERSISTIDA en la Postgres de Hermes desde el #106 (ADR 0027). La versión
 * anterior era un Map «en memoria a propósito», y el propósito tenía un costo
 * medido: cada deploy del server deslogueaba a las tres vendedoras a la vez
 * (el token de Hermes es HMAC sin estado y sobrevive; la cookie de Cerberus
 * moría con el proceso). El Map sigue existiendo, pero como CACHÉ: la base es
 * el respaldo que cruza el reinicio.
 *
 * ── Las tres reglas ──
 * 1. **La vigencia se decide al LEER** (`VIGENCIA_SESION_MS`, 14 días — los
 *    mismos del token de Hermes): una fila más vieja se trata como inexistente.
 *    Cerberus puede haberla vencido antes; eso lo descubre el POST y se le dice
 *    a la vendedora («volvé a entrar»), como siempre.
 * 2. **La base degrada, nunca tumba**: si la tabla no está migrada o la base no
 *    contesta, el store se comporta como el Map de antes (funciona hasta el
 *    próximo reinicio) y lo dice por el log. Un login no puede fallar porque la
 *    persistencia falló.
 * 3. **Seam inyectable**: `crearSesionStore(base)` para los tests con base
 *    (ADR 0008); el singleton de abajo es el que usa producción.
 */

/** 14 días, como el token de Hermes y el «mantener sesión» de Cerberus. */
export const VIGENCIA_SESION_MS = 14 * 24 * 60 * 60 * 1000;

/** ¿Una sesión guardada en `guardadaEnMs` sigue viva `ahoraMs`? Pura, con test. */
export function sesionVigente(guardadaEnMs: number, ahoraMs: number): boolean {
  return ahoraMs - guardadaEnMs < VIGENCIA_SESION_MS;
}

export interface SesionStoreCerberus {
  guardar(vendedoraId: string, sesion: SesionCerberus): Promise<void>;
  obtener(vendedoraId: string): Promise<SesionCerberus | null>;
  borrar(vendedoraId: string): Promise<void>;
}

export function crearSesionStore(
  base: typeof db,
  ahora: () => number = Date.now,
): SesionStoreCerberus {
  /** Caché del proceso: el camino caliente no paga un SELECT por request. */
  const cache = new Map<string, { sesion: SesionCerberus; guardadaEn: number }>();

  const avisar = (que: string, e: unknown) =>
    console.error(
      `[sesionStore] ${que} contra la base falló — sigo en memoria (la sesión no cruza el próximo reinicio):`,
      e instanceof Error ? e.message : e,
    );

  async function guardar(vendedoraId: string, sesion: SesionCerberus): Promise<void> {
    const guardadaEn = ahora();
    cache.set(vendedoraId, { sesion, guardadaEn });
    try {
      await base
        .insert(sesionesCerberus)
        .values({ vendedoraId, sesion, guardadaEn: new Date(guardadaEn) })
        .onConflictDoUpdate({
          target: sesionesCerberus.vendedoraId,
          set: { sesion, guardadaEn: new Date(guardadaEn) },
        });
    } catch (e) {
      avisar('guardar', e);
    }
  }

  async function borrar(vendedoraId: string): Promise<void> {
    cache.delete(vendedoraId);
    try {
      await base.delete(sesionesCerberus).where(eq(sesionesCerberus.vendedoraId, vendedoraId));
    } catch (e) {
      avisar('borrar', e);
    }
  }

  async function obtener(vendedoraId: string): Promise<SesionCerberus | null> {
    const enCache = cache.get(vendedoraId);
    if (enCache) {
      if (sesionVigente(enCache.guardadaEn, ahora())) return enCache.sesion;
      // Venció: la fila de la base es la misma de vieja; se limpia todo.
      await borrar(vendedoraId);
      return null;
    }
    try {
      const filas = await base
        .select()
        .from(sesionesCerberus)
        .where(eq(sesionesCerberus.vendedoraId, vendedoraId))
        .limit(1);
      const fila = filas[0];
      if (!fila) return null;
      const guardadaEn = fila.guardadaEn.getTime();
      if (!sesionVigente(guardadaEn, ahora())) {
        await base.delete(sesionesCerberus).where(eq(sesionesCerberus.vendedoraId, vendedoraId));
        return null;
      }
      cache.set(vendedoraId, { sesion: fila.sesion, guardadaEn });
      return fila.sesion;
    } catch (e) {
      avisar('leer', e);
      return null;
    }
  }

  return { guardar, obtener, borrar };
}

/**
 * El store de producción, UNO solo (auth y ventas tienen que compartir el
 * caché: si cada módulo armara el suyo, un re-login pisaría la base y el otro
 * caché seguiría sirviendo la cookie vieja). El `db/client.js` se importa
 * PEREZOSO a propósito: revienta sin `DATABASE_URL`, y este módulo lo importan
 * los tests, que le inyectan su propia base por `crearSesionStore`.
 */
let storeProd: SesionStoreCerberus | undefined;
async function elStore(): Promise<SesionStoreCerberus> {
  if (!storeProd) {
    const { db } = await import('../db/client.js');
    storeProd = crearSesionStore(db);
  }
  return storeProd;
}

export async function guardarSesionCerberus(vendedoraId: string, sesion: SesionCerberus): Promise<void> {
  return (await elStore()).guardar(vendedoraId, sesion);
}

export async function obtenerSesionCerberus(vendedoraId: string): Promise<SesionCerberus | null> {
  return (await elStore()).obtener(vendedoraId);
}

export async function borrarSesionCerberus(vendedoraId: string): Promise<void> {
  return (await elStore()).borrar(vendedoraId);
}
