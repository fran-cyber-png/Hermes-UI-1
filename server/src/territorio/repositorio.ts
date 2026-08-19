import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { claveDistrito, ordenarDistritos, type Distrito } from "./dominio.js";

/**
 * EL TERRITORIO CONTRA LA BASE (ADR 0063).
 *
 * SEAM, como todo el repo: cada función recibe `db` inyectado — la ruta le pasa
 * el singleton, el test su Postgres efímera (ADR 0008).
 *
 * ══ 🔴 DEGRADA SIN LA MIGRACIÓN, y acá eso es lo correcto ═══════════════════
 *
 * Sin las tablas, `catalogoDe` devuelve `[]` y `territorioDe` `null`: el bloque
 * del panel no se dibuja y la campaña sigue trabajando. Es lo contrario del
 * catálogo de piezas (ADR 0023), que ante una falla tira 503, y por el mismo
 * criterio: **acá el consumidor es una persona** y el dato es un agregado
 * opcional, allá es un índice que cachea y una lista vacía se le vuelve verdad.
 *
 * ⚠️ Lo que NO degrada es ESCRIBIR: `anotarTerritorio` deja subir el error. Un
 * «guardado» que no guardó es peor que un error, porque la operadora sigue
 * caminando y da el dato por tomado.
 */

type Base = PostgresJsDatabase<typeof schema>;

/** Sin la migración no hay catálogo, y eso no es un error: es una campaña sin distritos. */
function esTablaAusente(e: unknown): boolean {
  return String((e as { cause?: { code?: string } })?.cause?.code ?? "") === "42P01";
}

/** El catálogo ACTIVO de una línea, ya ordenado como se va a ofrecer. */
export async function catalogoDe(db: Base, linea: string): Promise<Distrito[]> {
  try {
    const filas = await db
      .select({
        id: schema.distrito.id,
        nombre: schema.distrito.nombre,
        zona: schema.distrito.zona,
        orden: schema.distrito.orden,
      })
      .from(schema.distrito)
      .where(and(eq(schema.distrito.linea, linea), eq(schema.distrito.activo, true)));
    return ordenarDistritos(filas);
  } catch (e) {
    if (esTablaAusente(e)) return [];
    throw e;
  }
}

/** Dónde vota esta conversación. `null` = todavía no se le preguntó. */
export async function territorioDe(
  db: Base,
  clave: string,
): Promise<{ distritoId: number; anotadoPor: string | null } | null> {
  try {
    const [fila] = await db
      .select({
        distritoId: schema.contactoTerritorio.distritoId,
        anotadoPor: schema.contactoTerritorio.anotadoPor,
      })
      .from(schema.contactoTerritorio)
      .where(eq(schema.contactoTerritorio.clave, clave))
      .limit(1);
    return fila ?? null;
  } catch (e) {
    if (esTablaAusente(e)) return null;
    throw e;
  }
}

/**
 * Anotar dónde vota. **Reemplaza**: una persona vota en un lugar, así que esto
 * es un ESTADO y no un historial — el mismo criterio que las reacciones.
 *
 * ⚠️ El llamador tiene que haber verificado que el distrito es de SU catálogo
 * (`distritoAjeno`). Acá no se vuelve a preguntar: la guarda vive en la ruta,
 * que es la que tiene el catálogo y la que puede contestar un 409 enumerando.
 */
export async function anotarTerritorio(
  db: Base,
  v: { clave: string; distritoId: number; anotadoPor: string },
): Promise<void> {
  await db
    .insert(schema.contactoTerritorio)
    .values({ clave: v.clave, distritoId: v.distritoId, anotadoPor: v.anotadoPor })
    .onConflictDoUpdate({
      target: schema.contactoTerritorio.clave,
      set: {
        distritoId: v.distritoId,
        anotadoPor: v.anotadoPor,
        anotadoAt: sql`now()`,
      },
    });
}

/** Sacar el territorio: la operadora se equivocó, o la persona se mudó. */
export async function borrarTerritorio(db: Base, clave: string): Promise<void> {
  await db.delete(schema.contactoTerritorio).where(eq(schema.contactoTerritorio.clave, clave));
}

/**
 * CUÁNTA GENTE HAY EN CADA DISTRITO — la pregunta que justifica el catálogo.
 *
 * ⚠️ **Devuelve TODOS los distritos activos, incluidos los que tienen cero.** Un
 * distrito en cero no es ruido: es justamente el que hay que salir a caminar, y
 * omitirlo lo esconde de la única pantalla donde se vería.
 */
export async function conteoPorDistrito(
  db: Base,
  linea: string,
): Promise<{ distritoId: number; n: number }[]> {
  try {
    const filas = await db
      .select({
        distritoId: schema.distrito.id,
        n: sql<number>`count(${schema.contactoTerritorio.clave})::int`,
      })
      .from(schema.distrito)
      .leftJoin(
        schema.contactoTerritorio,
        eq(schema.contactoTerritorio.distritoId, schema.distrito.id),
      )
      .where(and(eq(schema.distrito.linea, linea), eq(schema.distrito.activo, true)))
      .groupBy(schema.distrito.id);
    return filas;
  } catch (e) {
    if (esTablaAusente(e)) return [];
    throw e;
  }
}

/**
 * Alta de un distrito. Idempotente por `(linea, lower(btrim(nombre)))`, la MISMA
 * receta que `claveDistrito` — lo usa el CLI, no la app.
 */
export async function altaDeDistrito(
  db: Base,
  v: { linea: string; nombre: string; zona?: string | null; orden?: number },
): Promise<{ creado: boolean }> {
  const nombre = v.nombre.trim();
  const ya = await db
    .select({ id: schema.distrito.id })
    .from(schema.distrito)
    .where(
      and(
        eq(schema.distrito.linea, v.linea),
        sql`lower(btrim(${schema.distrito.nombre})) = ${claveDistrito(nombre)}`,
      ),
    )
    .limit(1);
  if (ya.length) return { creado: false };
  await db
    .insert(schema.distrito)
    .values({ linea: v.linea, nombre, zona: v.zona ?? null, orden: v.orden ?? 0 });
  return { creado: true };
}
