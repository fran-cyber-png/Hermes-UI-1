import { desc, eq } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { corridas, corridaRespuestas } from "../db/corridas.js";
import { lecciones } from "../db/lecciones.js";

/**
 * LA BASE DE LA PANTALLA DE ENTRENAMIENTO — Corridas (#257) y Lecciones (#259).
 *
 * Acá vive TODO el SQL que antes estaba escrito adentro de `routes/entrenamiento.ts`.
 * El router quedó con lo suyo: validar el cuerpo con Zod, elegir el código de
 * estado y serializar. Esa separación no es estética — es lo que permite testear
 * estas consultas con una base efímera.
 *
 * Cada función recibe `base` INYECTADA (el mismo estilo de `consultarSenales` /
 * `consultarAgujeros` / `consultarCola`): la ruta le pasa el singleton, el test
 * le pasa SU base de prueba, y nadie tiene que tocar el proceso para medir.
 * Ver ADR 0008.
 */

/** Una Corrida tal como está en la tabla. */
export type FilaCorrida = typeof corridas.$inferSelect;
/** Lo que el bot contestó en UNA conversación de una Corrida. */
export type FilaCorridaRespuesta = typeof corridaRespuestas.$inferSelect;
/** Una Lección tal como está en la tabla. */
export type FilaLeccion = typeof lecciones.$inferSelect;

/** Las Corridas, de la más nueva a la más vieja. */
export async function listarCorridas(base: typeof Base): Promise<FilaCorrida[]> {
  return await base.select().from(corridas).orderBy(desc(corridas.creadaEn)).limit(30);
}

/** Una Corrida por id. `undefined` = no existe (y el router contesta 404). */
export async function leerCorrida(
  base: typeof Base,
  id: number,
): Promise<FilaCorrida | undefined> {
  const [corrida] = await base.select().from(corridas).where(eq(corridas.id, id));
  return corrida;
}

/**
 * Las respuestas de una Corrida, en el orden en que se corrieron (`id`).
 *
 * Trae las filas CRUDAS: las violaciones de reglas se derivan arriba, sobre
 * estas mismas filas, y por eso no hay ni un `CASE` acá abajo (#258).
 */
export async function respuestasDeCorrida(
  base: typeof Base,
  id: number,
): Promise<FilaCorridaRespuesta[]> {
  return await base
    .select()
    .from(corridaRespuestas)
    .where(eq(corridaRespuestas.corridaId, id))
    .orderBy(corridaRespuestas.id);
}

/** Lo que hace falta para escribir una Lección. */
export interface LeccionNueva {
  texto: string;
  /** Por qué se escribió. Ausente se guarda como `null`. */
  motivo?: string | null;
  /** `null`/ausente = vale para todas las líneas. */
  numeroPropio?: string | null;
  /** Quién la escribió. */
  creadaPor: string;
}

/**
 * Escribe una Lección. **Nace en BORRADOR**: el bot vivo no la ve.
 *
 * El `estado` no es un parámetro a propósito — que se pueda crear publicada
 * desde acá sería la puerta a publicar sin querer, y publicar es un acto aparte
 * (`publicarLeccion`), explícito y firmado.
 */
export async function crearLeccion(
  base: typeof Base,
  nueva: LeccionNueva,
): Promise<FilaLeccion> {
  const [fila] = await base
    .insert(lecciones)
    .values({
      texto: nueva.texto,
      motivo: nueva.motivo ?? null,
      numeroPropio: nueva.numeroPropio ?? null,
      estado: "borrador",
      creadaPor: nueva.creadaPor,
    })
    .returning();
  return fila;
}

/** Todas las Lecciones, de la más nueva a la más vieja. */
export async function listarLecciones(base: typeof Base): Promise<FilaLeccion[]> {
  return await base.select().from(lecciones).orderBy(desc(lecciones.id));
}

/**
 * Publicar: el acto de hacerse cargo. Queda firmado con quién y cuándo.
 *
 * `undefined` = esa lección no existe (y el router contesta 404).
 */
export async function publicarLeccion(
  base: typeof Base,
  id: number,
  publicadaPor: string,
): Promise<FilaLeccion | undefined> {
  const [fila] = await base
    .update(lecciones)
    .set({
      estado: "publicada",
      publicadaPor,
      publicadaEn: new Date(),
    })
    .where(eq(lecciones.id, id))
    .returning();
  return fila;
}

/** Retirar: deja de aplicarse, pero NO se borra — el historial explica el bot de ayer. */
export async function retirarLeccion(
  base: typeof Base,
  id: number,
): Promise<FilaLeccion | undefined> {
  const [fila] = await base
    .update(lecciones)
    .set({ estado: "retirada" })
    .where(eq(lecciones.id, id))
    .returning();
  return fila;
}
