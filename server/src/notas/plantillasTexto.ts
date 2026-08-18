import { and, desc, eq, isNull } from 'drizzle-orm';
import type { db as DbSingleton } from '../db/client.js';
import { plantillasTexto } from '../db/schema.js';
import { mismaVendedoraEnSql } from '../espacios/visibilidadSql.js';
import { mismaVendedora } from '../reparto/destino.js';

/**
 * LAS PLANTILLAS DE TEXTO DE LA LIBRETA — snippets que se guardan una vez y se
 * pegan después desde el `/` del editor. Personales: sin espacios, sin envío,
 * sin nada que las vincule al negocio (ver el docblock de la tabla en `schema.ts`).
 */

export const LIMITE_TITULO = 80;
/** Mismo tope que una nota (`notas/notas.ts`): una plantilla es una página, no un párrafo. */
export const LIMITE_TEXTO = 20_000;

export type PlantillaTextoFila = typeof plantillasTexto.$inferSelect;

export type ResultadoValidacion = { ok: true; titulo: string; texto: string } | { ok: false; motivo: string };

export function validarPlantilla(valor: { titulo?: unknown; texto?: unknown }): ResultadoValidacion {
  const titulo = typeof valor.titulo === 'string' ? valor.titulo.trim() : '';
  const texto = typeof valor.texto === 'string' ? valor.texto.trim() : '';
  if (!titulo) return { ok: false, motivo: 'la plantilla necesita un título' };
  if (titulo.length > LIMITE_TITULO) {
    return { ok: false, motivo: `el título no puede superar los ${LIMITE_TITULO} caracteres (tiene ${titulo.length})` };
  }
  if (!texto) return { ok: false, motivo: 'la plantilla no puede estar vacía' };
  if (texto.length > LIMITE_TEXTO) {
    return { ok: false, motivo: `la plantilla no puede superar los ${LIMITE_TEXTO} caracteres (tiene ${texto.length})` };
  }
  return { ok: true, titulo, texto };
}

/** Las vivas de esta vendedora, la más reciente primero. */
export async function listarPlantillas(base: typeof DbSingleton, vendedoraId: string): Promise<PlantillaTextoFila[]> {
  return base
    .select()
    .from(plantillasTexto)
    .where(and(mismaVendedoraEnSql(plantillasTexto.vendedoraId, vendedoraId), isNull(plantillasTexto.archivadoAt)))
    .orderBy(desc(plantillasTexto.actualizadoAt));
}

export async function crearPlantilla(
  base: typeof DbSingleton,
  datos: { vendedoraId: string; titulo: string; texto: string },
): Promise<PlantillaTextoFila> {
  const [fila] = await base.insert(plantillasTexto).values(datos).returning();
  return fila;
}

export type ResultadoMutacion =
  | { ok: true; plantilla: PlantillaTextoFila }
  | { ok: false; motivo: 'no-encontrada' | 'prohibido' };

/** ¿Puede tocar esta plantilla? Solo su dueña — no hay «equipo» acá. */
async function conGuarda(
  base: typeof DbSingleton,
  opciones: { id: number; vendedoraId: string },
): Promise<{ ok: true; existente: PlantillaTextoFila } | { ok: false; motivo: 'no-encontrada' | 'prohibido' }> {
  const [existente] = await base.select().from(plantillasTexto).where(eq(plantillasTexto.id, opciones.id));
  if (!existente || existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (!mismaVendedora(existente.vendedoraId, opciones.vendedoraId)) return { ok: false, motivo: 'prohibido' };
  return { ok: true, existente };
}

/** Reemplaza título y texto — no hay edición parcial: el modal siempre manda los dos. */
export async function editarPlantilla(
  base: typeof DbSingleton,
  opciones: { id: number; vendedoraId: string; titulo: string; texto: string; ahora: Date },
): Promise<ResultadoMutacion> {
  const guarda = await conGuarda(base, opciones);
  if (!guarda.ok) return guarda;

  const [fila] = await base
    .update(plantillasTexto)
    .set({ titulo: opciones.titulo, texto: opciones.texto, actualizadoAt: opciones.ahora })
    .where(eq(plantillasTexto.id, opciones.id))
    .returning();
  return { ok: true, plantilla: fila };
}

/** Setea `archivado_at`. No hay DELETE físico — mismo patrón que `notas`. */
export async function archivarPlantilla(
  base: typeof DbSingleton,
  opciones: { id: number; vendedoraId: string; ahora: Date },
): Promise<ResultadoMutacion> {
  const guarda = await conGuarda(base, opciones);
  if (!guarda.ok) return guarda;

  const [fila] = await base
    .update(plantillasTexto)
    .set({ archivadoAt: opciones.ahora })
    .where(eq(plantillasTexto.id, opciones.id))
    .returning();
  return { ok: true, plantilla: fila };
}
