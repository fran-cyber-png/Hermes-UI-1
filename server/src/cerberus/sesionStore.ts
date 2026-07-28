import { and, eq, lt } from 'drizzle-orm';
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

/**
 * 14 días, como el token de Hermes. OJO: si Cerberus vence la suya antes (su
 * `SESSION_COOKIE_AGE` no se verificó contra ese repo), la fila queda presente
 * y muerta — eso lo descubren `cargarFormulario`/`crearVenta`, que al ver el
 * redirect a /ingresar/ la BORRAN para que `/yo` diga la verdad.
 */
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

/**
 * El mensaje de drizzle lleva `params:` con la fila entera — o sea la cookie
 * VIVA de Cerberus. Eso no puede tocar un log: journalctl viaja al summary de
 * Actions cuando un deploy falla, que es exactamente cuándo este store degrada
 * (regla dura #1). Se loguea el código del driver si está (`42P01` = falta la
 * migración · `ECONNREFUSED` = base caída) y si no, solo la PRIMERA línea del
 * mensaje: el SQL con `$n`, sin valores.
 */
export function detalleSeguro(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const causa = (e as { cause?: { code?: string } }).cause;
  if (causa?.code) return causa.code;
  return e.message.split('\n', 1)[0];
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
      detalleSeguro(e),
    );

  /**
   * La retención de VERDAD, al nacer el store — que en producción es el PRIMER
   * request de sesión tras el arranque (`elStore` es perezoso), no el proceso
   * levantándose. Sin esto el TTL sería solo «ignorar al leer»: la fila de una
   * vendedora que dejó de usar Hermes viviría para siempre, y el ADR 0027
   * afirma que no.
   */
  void (async () => {
    try {
      await base
        .delete(sesionesCerberus)
        .where(lt(sesionesCerberus.guardadaEn, new Date(ahora() - VIGENCIA_SESION_MS)));
    } catch (e) {
      avisar('retener', e);
    }
  })();

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

  /**
   * Borra SOLO si sigue vencida (la guarda de `guardada_en`): con dos procesos
   * sobre la misma base, un borrado incondicional se llevaría la fila FRESCA
   * que el otro acaba de escribir. El borrado de `borrar()` (logout, sesión
   * muerta) sí es incondicional a propósito.
   */
  async function borrarVencida(vendedoraId: string): Promise<void> {
    try {
      await base
        .delete(sesionesCerberus)
        .where(
          and(
            eq(sesionesCerberus.vendedoraId, vendedoraId),
            lt(sesionesCerberus.guardadaEn, new Date(ahora() - VIGENCIA_SESION_MS)),
          ),
        );
    } catch (e) {
      avisar('purgar', e);
    }
  }

  async function obtener(vendedoraId: string): Promise<SesionCerberus | null> {
    const enCache = cache.get(vendedoraId);
    if (enCache && sesionVigente(enCache.guardadaEn, ahora())) return enCache.sesion;
    // Caché vencido: NO es «no hay sesión» — otro proceso pudo escribir una
    // fila fresca (re-login). Se suelta la entrada y se relee la base.
    if (enCache) cache.delete(vendedoraId);
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
        await borrarVencida(vendedoraId);
        return null;
      }
      // ⚠️ La lectura pudo ser LENTA: si mientras el SELECT viajaba hubo un
      // re-login (`guardar` puso una cookie más nueva en el caché), esta fila
      // es la VIEJA y cachearla a ciegas la dejaría pegada 14 días. Solo gana
      // la lectura si es más nueva que lo que el caché tenga ahora.
      const actual = cache.get(vendedoraId);
      if (!actual || actual.guardadaEn < guardadaEn) {
        cache.set(vendedoraId, { sesion: fila.sesion, guardadaEn });
      }
      return cache.get(vendedoraId)!.sesion;
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
let storeProd: Promise<SesionStoreCerberus> | undefined;
function elStore(): Promise<SesionStoreCerberus> {
  // Se memoiza la PROMESA, no el valor: dos requests concurrentes en el primer
  // instante del proceso no pueden fabricar dos stores con dos cachés.
  return (storeProd ??= import('../db/client.js').then(({ db }) => crearSesionStore(db)));
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
