import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import { listasCampana } from "../db/campana.js";
import type { Filtros } from "../padron/filtros.js";

/**
 * LAS LISTAS DE CAMPAÑA — guardar un recorte del padrón con nombre.
 *
 * ══ UNA LISTA ES UN FILTRO, Y ESO SE NOTA ACÁ ═══════════════════════════════
 *
 * No hay `ids` en ningún lado. Lo que se guarda es la condición
 * (`{pais:['MX'], conVenta:false}`), y **el tamaño se calcula cada vez que se
 * mira** — nunca se guarda.
 *
 * Un conteo guardado sería la foto vieja que este diseño existe para evitar:
 * icarus mete contactos todo el tiempo, así que «11.646 mexicanos» es verdad el
 * martes y mentira el jueves, sin que la fila cambie ni nadie se entere.
 *
 * ══ EL CONTEO SE PIDE A ICARUS, Y ESO CUESTA ════════════════════════════════
 *
 * Cada lista dibujada = una consulta a otra base. Con veinte listas en pantalla
 * son veinte consultas, y por eso la pantalla las pide **en una sola llamada**
 * y el server las resuelve en paralelo — no una por fila.
 *
 * ⚠️ Si icarus no responde, el conteo viaja como **`null` = «no se pudo
 * preguntar»**, nunca `0`. Un cero se lee como «esta lista está vacía» y llevaría
 * a borrar una lista buena.
 */

type Base = typeof Db;

export interface Lista {
  id: number;
  nombre: string;
  filtros: Filtros;
  nota: string | null;
  creadaPor: string;
  creadaEn: Date;
}

export interface ListaConTamano extends Lista {
  /** Cuántos contactos entran HOY. `null` = no se pudo preguntar a icarus. */
  cuantos: number | null;
}

/** Las listas vivas, en orden alfabético (que es como se buscan). */
export async function leerListas(base: Base): Promise<Lista[]> {
  const filas = await base
    .select()
    .from(listasCampana)
    .where(isNull(listasCampana.archivadaEn))
    .orderBy(asc(listasCampana.nombre));

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    filtros: (f.filtros ?? {}) as Filtros,
    nota: f.nota,
    creadaPor: f.creadaPor,
    creadaEn: f.creadaEn,
  }));
}

export async function leerLista(base: Base, id: number): Promise<Lista | null> {
  const [f] = await base.select().from(listasCampana).where(eq(listasCampana.id, id)).limit(1);
  if (!f) return null;
  return {
    id: f.id,
    nombre: f.nombre,
    filtros: (f.filtros ?? {}) as Filtros,
    nota: f.nota,
    creadaPor: f.creadaPor,
    creadaEn: f.creadaEn,
  };
}

export async function guardarLista(
  base: Base,
  datos: { nombre: string; filtros: Filtros; nota?: string | null; creadaPor: string },
): Promise<Lista> {
  const [f] = await base
    .insert(listasCampana)
    .values({
      nombre: datos.nombre.trim(),
      filtros: datos.filtros,
      nota: datos.nota?.trim() || null,
      creadaPor: datos.creadaPor,
    })
    .returning();
  return {
    id: f.id,
    nombre: f.nombre,
    filtros: (f.filtros ?? {}) as Filtros,
    nota: f.nota,
    creadaPor: f.creadaPor,
    creadaEn: f.creadaEn,
  };
}

/**
 * ARCHIVAR, NO BORRAR.
 *
 * Mismo criterio que sacar a alguien de la rueda del reparto: una lista que se
 * usó en una campaña sigue explicando a quién se le mandó. Un DELETE dejaría
 * corridas históricas apuntando a la nada, justo cuando alguien pregunta «¿a
 * quiénes les mandamos esto?».
 */
export async function archivarLista(base: Base, id: number): Promise<boolean> {
  const filas = await base
    .update(listasCampana)
    .set({ archivadaEn: new Date() })
    .where(and(eq(listasCampana.id, id), isNull(listasCampana.archivadaEn)))
    .returning({ id: listasCampana.id });
  return filas.length > 0;
}

/** ¿Ya existe una lista con ese nombre? Dos iguales son un accidente. */
export async function nombreLibre(base: Base, nombre: string): Promise<boolean> {
  const [f] = await base
    .select({ n: sql<number>`1` })
    .from(listasCampana)
    .where(eq(listasCampana.nombre, nombre.trim()))
    .limit(1);
  return !f;
}
