import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import type { DatosUpsert } from "./dominio.js";

/**
 * EL REGISTRO DE NÚMEROS PROPIOS — la copia local del mapa que dueña Cerberus.
 *
 * Es un SEAM: cada función recibe `db` (el de producción o el aislado del test),
 * nunca importa el singleton. Así los tests con base (`*.test.db.ts`) le pasan su
 * propia Postgres efímera. El patrón de la casa (issues #37/#38).
 */

/** El `db` inyectable: lo satisfacen el singleton y la base de prueba por igual. */
type Base = PostgresJsDatabase<typeof schema>;

export interface NumeroRow {
  numero: string;
  etiqueta: string;
  proposito: string;
  referencia: string | null;
  activo: boolean;
  vinculadoAt: Date | null;
  vendedoras: string[];
}

function aFila(
  n: typeof schema.numerosWa.$inferSelect,
  vendedoras: string[],
): NumeroRow {
  return {
    numero: n.numero,
    etiqueta: n.etiqueta,
    proposito: n.proposito,
    referencia: n.referencia,
    activo: n.activo,
    vinculadoAt: n.vinculadoAt,
    vendedoras,
  };
}

/** Todos los números, con sus vendedoras asignadas, más viejo primero. */
export async function listarNumeros(db: Base): Promise<NumeroRow[]> {
  const nums = await db.select().from(schema.numerosWa).orderBy(schema.numerosWa.creadoAt);
  const asigs = await db.select().from(schema.numeroVendedora);
  const porNumero = new Map<string, string[]>();
  for (const a of asigs) {
    const lista = porNumero.get(a.numero) ?? [];
    lista.push(a.vendedoraId);
    porNumero.set(a.numero, lista);
  }
  return nums.map((n) => aFila(n, (porNumero.get(n.numero) ?? []).sort()));
}

/**
 * LAS LÍNEAS DE UNA VENDEDORA — el mapa leído desde el otro lado.
 *
 * Existe para el recorte «Las mías» de la cola (`cola/lineas.ts`). Vive acá,
 * junto a `listarNumeros`/`upsertNumero`, porque el mapa número↔vendedora tiene
 * un solo dueño: si la cola armara su propio `SELECT ... FROM numero_vendedora`,
 * el día que Cerberus agregue una columna de vigencia habría dos lugares que
 * decidir qué cuenta como «suya» (la lección de #37).
 *
 * Devolver `[]` no es un error: significa «el mapa no le asigna ninguna», y
 * quién decide qué hacer con eso —fail-open, ver `cola/lineas.ts`— es la regla
 * pura, no esta consulta.
 */
export async function lineasDeVendedora(db: Base, vendedoraId: string): Promise<string[]> {
  const filas = await db
    .select({ numero: schema.numeroVendedora.numero })
    .from(schema.numeroVendedora)
    .where(eq(schema.numeroVendedora.vendedoraId, vendedoraId));
  return filas.map((f) => f.numero);
}

export async function obtenerNumero(db: Base, numero: string): Promise<NumeroRow | null> {
  const [n] = await db
    .select()
    .from(schema.numerosWa)
    .where(eq(schema.numerosWa.numero, numero))
    .limit(1);
  if (!n) return null;
  const asigs = await db
    .select()
    .from(schema.numeroVendedora)
    .where(eq(schema.numeroVendedora.numero, numero));
  return aFila(n, asigs.map((a) => a.vendedoraId).sort());
}

/**
 * Upsert declarativo: crea o actualiza el número y REEMPLAZA su set completo de
 * vendedoras (agregar/quitar en una sola llamada). Idempotente por la clave
 * `numero`, así el push de Cerberus tolera reintentos.
 */
export async function upsertNumero(
  db: Base,
  numero: string,
  datos: DatosUpsert,
): Promise<NumeroRow> {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.numerosWa)
      .values({
        numero,
        etiqueta: datos.etiqueta,
        proposito: datos.proposito,
        referencia: datos.referencia,
        activo: datos.activo,
        actualizadoAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: schema.numerosWa.numero,
        set: {
          etiqueta: datos.etiqueta,
          proposito: datos.proposito,
          referencia: datos.referencia,
          activo: datos.activo,
          actualizadoAt: sql`now()`,
        },
      });

    await tx.delete(schema.numeroVendedora).where(eq(schema.numeroVendedora.numero, numero));
    const unicas = [...new Set(datos.vendedoras)];
    if (unicas.length) {
      await tx.insert(schema.numeroVendedora).values(unicas.map((vendedoraId) => ({ numero, vendedoraId })));
    }
  });

  const fila = await obtenerNumero(db, numero);
  // Recién insertado en la misma transacción: no puede no estar.
  return fila as NumeroRow;
}

/** Baja lógica: activo=false. Devuelve si el número existía. No borra la sesión. */
export async function desactivarNumero(db: Base, numero: string): Promise<boolean> {
  const filas = await db
    .update(schema.numerosWa)
    .set({ activo: false, actualizadoAt: sql`now()` })
    .where(eq(schema.numerosWa.numero, numero))
    .returning({ numero: schema.numerosWa.numero });
  return filas.length > 0;
}

/** Marca la sesión como vinculada (se llama cuando el pareo llega a 'conectado'). */
export async function marcarVinculado(db: Base, numero: string): Promise<void> {
  await db
    .update(schema.numerosWa)
    .set({ vinculadoAt: sql`now()`, actualizadoAt: sql`now()` })
    .where(eq(schema.numerosWa.numero, numero));
}
