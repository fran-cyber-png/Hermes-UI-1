import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { db as DbSingleton } from '../db/client.js';
import { gestiones, notas } from '../db/schema.js';

/**
 * LA LÓGICA DE NOTAS — extraída del router para poder testearla contra una base
 * de verdad (harness #33), como `cola/consultarCola.ts`: recibe `db` INYECTADO —
 * el router le pasa el singleton, el test su base de prueba.
 *
 * V1 es POR AUTORA: una nota no se comparte con otra vendedora, ni siquiera las
 * ancladas a una conversación (a diferencia de `etiquetas`, que sí son del
 * equipo). Por eso `listarNotas` y `buscarNotas` filtran SIEMPRE por
 * `vendedoraId` — promover a «del equipo» es otro frente (issue #47, fuera de
 * alcance).
 */

export const LIMITE_TEXTO = 2000;

export type NotaFila = typeof notas.$inferSelect;

export type ResultadoValidacion = { ok: true; texto: string } | { ok: false; motivo: string };

/**
 * trim + no vacío + ≤ 2.000. Los emojis SÍ pasan: una nota nunca viaja a
 * Cerberus, así que la regla latin1 dura #4 del CLAUDE.md no aplica acá.
 */
export function validarTexto(valor: unknown): ResultadoValidacion {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) return { ok: false, motivo: 'el texto de la nota no puede estar vacío' };
  if (texto.length > LIMITE_TEXTO) {
    return { ok: false, motivo: `la nota no puede superar los ${LIMITE_TEXTO} caracteres (tiene ${texto.length})` };
  }
  return { ok: true, texto };
}

export interface CambiosEdicion {
  texto?: string;
  fijada?: boolean;
  editadoAt: Date;
}

export type ResultadoEdicion = { ok: true; cambios: CambiosEdicion } | { ok: false; motivo: string };

/**
 * LA REGLA `editado_at`: nace `null` (el insert de `crearNota` no la toca — la
 * columna no tiene default más que null); CUALQUIER PATCH la setea a `ahora`,
 * inyectado como en `cola/urgencia.ts` para no depender del reloj real. Separada
 * de la escritura en base para poder testearse sin IO.
 */
export function prepararEdicion(cambios: { texto?: unknown; fijada?: unknown }, ahora: Date): ResultadoEdicion {
  const resultado: CambiosEdicion = { editadoAt: ahora };
  if (cambios.texto !== undefined) {
    const v = validarTexto(cambios.texto);
    if (!v.ok) return v;
    resultado.texto = v.texto;
  }
  if (cambios.fijada !== undefined) {
    resultado.fijada = Boolean(cambios.fijada);
  }
  if (resultado.texto === undefined && resultado.fijada === undefined) {
    return { ok: false, motivo: 'no hay nada que editar (mandá texto y/o fijada)' };
  }
  return { ok: true, cambios: resultado };
}

/**
 * Una nota tal como la ve la UI: de la tabla `notas` (editable) o HISTÓRICA —
 * el textarea append-only que `RegistrarGestion` tenía antes de #47, vive en
 * `gestiones.notas` (ver ADR 0012). Esas NO se migran (perderían su fecha real,
 * o se duplicarían por cada gestión de la misma conversación): se SURFACEAN acá
 * de solo lectura, para que retirar el textarea no las vuelva invisibles.
 */
export interface NotaListada {
  id: number;
  clave: string;
  vendedoraId: string;
  texto: string;
  fijada: boolean;
  creadoAt: Date;
  editadoAt: Date | null;
  archivadoAt: Date | null;
  origen: 'nota' | 'gestion';
}

/**
 * Las notas de acuerdos que quedaron guardadas en `gestiones.notas` ANTES de
 * #47. Solo lectura: no tienen `id` en la tabla `notas`, así que no hay PATCH
 * posible sobre ellas (el router nunca las expone en /:id).
 */
async function listarNotasHistoricas(
  base: typeof DbSingleton,
  opciones: { clave: string; vendedoraId: string },
): Promise<NotaListada[]> {
  const filas = await base
    .select({ id: gestiones.id, vendedoraId: gestiones.vendedoraId, texto: gestiones.notas, creadoAt: gestiones.creadoAt })
    .from(gestiones)
    .where(and(eq(gestiones.clave, opciones.clave), eq(gestiones.vendedoraId, opciones.vendedoraId), isNotNull(gestiones.notas)));

  return filas
    .filter((f): f is typeof f & { texto: string } => Boolean(f.texto && f.texto.trim()))
    .map((f) => ({
      id: f.id,
      clave: opciones.clave,
      vendedoraId: f.vendedoraId,
      texto: f.texto,
      fijada: false,
      creadoAt: f.creadoAt,
      editadoAt: null,
      archivadoAt: null,
      origen: 'gestion' as const,
    }));
}

/**
 * Vivas de una conversación (o de la libreta 'general'), de ESTA vendedora —
 * fijada primero, luego más nueva primero. Mezcla las notas nuevas (editables)
 * con las históricas de `gestiones` (solo lectura) — ver `NotaListada`.
 */
export async function listarNotas(
  base: typeof DbSingleton,
  opciones: { clave: string; vendedoraId: string },
): Promise<NotaListada[]> {
  const [nuevas, historicas] = await Promise.all([
    base
      .select()
      .from(notas)
      .where(and(eq(notas.clave, opciones.clave), eq(notas.vendedoraId, opciones.vendedoraId), isNull(notas.archivadoAt))),
    listarNotasHistoricas(base, opciones),
  ]);

  const combinadas: NotaListada[] = [...nuevas.map((n) => ({ ...n, origen: 'nota' as const })), ...historicas];

  combinadas.sort((a, b) => {
    if (a.fijada !== b.fijada) return a.fijada ? -1 : 1;
    return b.creadoAt.getTime() - a.creadoAt.getTime();
  });

  return combinadas;
}

/**
 * Búsqueda GIN sobre la libreta ('general') de ESTA vendedora. La expresión
 * `to_tsvector('spanish', texto)` es la misma que indexa el GIN manual (ver
 * `docs/deploy-vps1.md`): sin el índice, Postgres igual contesta bien — degrada
 * a seq scan, no revienta.
 */
export async function buscarNotas(base: typeof DbSingleton, opciones: { vendedoraId: string; q: string }): Promise<NotaFila[]> {
  const termino = opciones.q.trim();
  if (!termino) return [];
  return base
    .select()
    .from(notas)
    .where(
      and(
        eq(notas.vendedoraId, opciones.vendedoraId),
        eq(notas.clave, 'general'),
        isNull(notas.archivadoAt),
        sql`to_tsvector('spanish', ${notas.texto}) @@ plainto_tsquery('spanish', ${termino})`,
      ),
    )
    .orderBy(desc(notas.fijada), desc(notas.creadoAt));
}

export async function crearNota(
  base: typeof DbSingleton,
  datos: { clave: string; vendedoraId: string; texto: string },
): Promise<NotaFila> {
  const [fila] = await base.insert(notas).values(datos).returning();
  return fila;
}

export type ResultadoMutacion = { ok: true; nota: NotaFila } | { ok: false; motivo: 'no-encontrada' | 'prohibido' };

/** Solo la autora edita — si no, 403 (`prohibido`). Una nota archivada ya no se toca. */
export async function editarNota(
  base: typeof DbSingleton,
  opciones: { id: number; vendedoraId: string; cambios: CambiosEdicion },
): Promise<ResultadoMutacion> {
  const [existente] = await base.select().from(notas).where(eq(notas.id, opciones.id));
  if (!existente || existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (existente.vendedoraId !== opciones.vendedoraId) return { ok: false, motivo: 'prohibido' };

  const [fila] = await base.update(notas).set(opciones.cambios).where(eq(notas.id, opciones.id)).returning();
  return { ok: true, nota: fila };
}

/** Setea `archivado_at`. No hay DELETE físico — la fila sigue en la base. */
export async function archivarNota(
  base: typeof DbSingleton,
  opciones: { id: number; vendedoraId: string; ahora: Date },
): Promise<ResultadoMutacion> {
  const [existente] = await base.select().from(notas).where(eq(notas.id, opciones.id));
  if (!existente || existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (existente.vendedoraId !== opciones.vendedoraId) return { ok: false, motivo: 'prohibido' };

  const [fila] = await base.update(notas).set({ archivadoAt: opciones.ahora }).where(eq(notas.id, opciones.id)).returning();
  return { ok: true, nota: fila };
}

/**
 * DESHACER un archivado (limpia `archivado_at`). Un solo clic sin confirmar ni
 * poder volver atrás era el problema (review de código del PR #47): esto es el
 * camino de vuelta — el botón «Deshacer» del toast que sigue al archivado.
 */
export async function desarchivarNota(
  base: typeof DbSingleton,
  opciones: { id: number; vendedoraId: string },
): Promise<ResultadoMutacion> {
  const [existente] = await base.select().from(notas).where(eq(notas.id, opciones.id));
  if (!existente || !existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (existente.vendedoraId !== opciones.vendedoraId) return { ok: false, motivo: 'prohibido' };

  const [fila] = await base.update(notas).set({ archivadoAt: null }).where(eq(notas.id, opciones.id)).returning();
  return { ok: true, nota: fila };
}
