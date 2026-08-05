import { and, desc, eq, isNull } from "drizzle-orm";
import type { db } from "../db/client.js";
import { eventosContacto } from "../db/schema.js";
import { mismaVendedora } from "../reparto/destino.js";
import { registrarInteres } from "../gestiones/registrarInteres.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { CATALOGO_EVENTOS, esTipoConocido, type EventoLimpio } from "./catalogo.js";

/**
 * EL SEAM DE LOS EVENTOS DEL CONTACTO — `db` inyectado (ADR 0008).
 *
 * La ruta le pasa el singleton, el test su base de prueba. Acá viven las tres
 * reglas que no pueden estar en un `if` de la ruta: qué pasa con el interés
 * cuando alguien registra «preguntó por un curso», quién puede corregir un
 * evento, y que borrar es archivar.
 */

export interface FilaEvento {
  id: number;
  clave: string;
  tipo: string;
  curso: string | null;
  productoId: string | null;
  nota: string | null;
  vendedoraId: string;
  creadoAt: Date;
  editadoAt: Date | null;
}

export interface OpcionesRegistrar {
  clave: string;
  vendedoraId: string;
  evento: EventoLimpio;
  /**
   * El catálogo vivo de Cerberus, para asentar el interés. Inyectado como en
   * `registrarInteres`: el test no habla con Cerberus.
   */
  catalogo: () => Promise<ProductoCatalogo[]>;
}

export interface ResultadoRegistrar {
  evento: FilaEvento;
  /**
   * ¿Este evento además asentó el interés? `false` cuando el tipo no era
   * `pregunto_curso`. La UI lo usa para decir la verdad sobre lo que pasó.
   */
  interesAsentado: boolean;
  /** Por qué el interés quedó sin atar al producto, si es que quedó. */
  motivoInteres: "producto_inexistente" | "catalogo_caido" | null;
}

/**
 * REGISTRAR UN EVENTO.
 *
 * ── LA REGLA QUE IMPORTA: «preguntó por un curso» ASIENTA EL INTERÉS ─────────
 * `intereses` es la ÚNICA fuente de verdad de «qué curso quiere esta persona»:
 * la usa la compuerta de Cotizado (`registrarGestion.ts`), el chip de la cola,
 * la ficha y el Pipeline. Si este evento guardara su propio curso y nada más,
 * habría **dos lugares diciendo qué quiere el lead**, y podrían divergir — que
 * es exactamente el defecto de #37, el que este repo paga con tests de paridad
 * cada vez que aparece.
 *
 * Peor todavía en la práctica: la vendedora registraría «preguntó por Gestión
 * Pública» y al minuto siguiente Cotizado le rebotaría con «no se sabe qué
 * curso le interesa». Absurdo, y se lee como que el registro no sirvió.
 *
 * Así que el evento NARRA (cuándo, quién, cómo lo dijo) y `intereses` SIGUE
 * SIENDO el estado. Se asienta por el mismo seam que el botón «+ interés», con
 * su misma resolución contra el catálogo vivo: una sola receta, no dos.
 *
 * ── EL INTERÉS VA PRIMERO, Y EL EVENTO GUARDA EL NOMBRE QUE ÉL RESOLVIÓ ─────
 * `registrarInteres` no se queda con el texto que mandó el navegador: si vino
 * un `productoId`, resuelve el nombre contra el catálogo VIVO (porque el caché
 * de IndexedDB sobrevive al cierre de la app, ADR 0007, y un nombre viejo
 * cotiza otra cosa). Si el evento guardara el texto del navegador y el interés
 * el del catálogo, la misma acción quedaría escrita con DOS nombres distintos
 * —el timeline diría uno y el chip de la cola otro— por la misma clase de
 * divergencia que este archivo existe para evitar.
 *
 * Correrlo primero es seguro: `registrarInteres` **no tira si Cerberus está
 * caído**, se lo traga y degrada a texto libre devolviendo el motivo. Así que
 * no hay caso en que preguntar por el catálogo se lleve puesto el registro de
 * algo que la vendedora acaba de escuchar.
 */
export async function registrarEvento(
  base: typeof db,
  o: OpcionesRegistrar,
): Promise<ResultadoRegistrar> {
  // Lo decide el CATÁLOGO (`pideCurso`), no un `=== 'pregunto_curso'` acá: un
  // tipo nuevo que se complete con un curso asienta el interés sin tocar este
  // archivo. Un tipo DESCONOCIDO con un curso pegado no asienta nada — no
  // sabemos qué afirma, y asentar de más ensucia la compuerta de Cotizado.
  const asientaInteres =
    esTipoConocido(o.evento.tipo) && CATALOGO_EVENTOS[o.evento.tipo].pideCurso && !!o.evento.curso;

  let curso = o.evento.curso;
  let motivoInteres: ResultadoRegistrar["motivoInteres"] = null;

  if (asientaInteres) {
    const r = await registrarInteres(base, {
      clave: o.clave,
      curso: o.evento.curso!,
      productoId: o.evento.productoId,
      vendedoraId: o.vendedoraId,
      catalogo: o.catalogo,
    });
    // El nombre que vale es el que quedó asentado, no el que vino.
    curso = r.curso;
    motivoInteres = r.motivo;
  }

  const [fila] = await base
    .insert(eventosContacto)
    .values({
      clave: o.clave,
      tipo: o.evento.tipo,
      curso,
      productoId: o.evento.productoId,
      nota: o.evento.nota,
      vendedoraId: o.vendedoraId,
    })
    .returning();

  return { evento: aFila(fila), interesAsentado: asientaInteres, motivoInteres };
}

function aFila(f: typeof eventosContacto.$inferSelect): FilaEvento {
  return {
    id: f.id,
    clave: f.clave,
    tipo: f.tipo,
    curso: f.curso,
    productoId: f.productoId,
    nota: f.nota,
    vendedoraId: f.vendedoraId,
    creadoAt: f.creadoAt,
    editadoAt: f.editadoAt,
  };
}

/**
 * Los eventos VIVOS de una conversación, del más nuevo al más viejo.
 *
 * Se sirven todos, de todas las vendedoras: la conversación es del equipo y el
 * timeline es la historia de la persona, no la de quien mira. Quién lo escribió
 * viaja en cada fila — la atribución es el punto, no un metadato.
 */
export async function consultarEventos(base: typeof db, clave: string): Promise<FilaEvento[]> {
  const filas = await base
    .select()
    .from(eventosContacto)
    .where(and(eq(eventosContacto.clave, clave), isNull(eventosContacto.archivadoAt)))
    .orderBy(desc(eventosContacto.creadoAt));
  return filas.map(aFila);
}

export type ResultadoEdicion =
  | { ok: true; evento: FilaEvento }
  | { ok: false; codigo: "no_existe" | "no_es_tuyo"; message: string };

/**
 * ¿Puede esta vendedora tocar este evento?
 *
 * 🔴 **Compara NORMALIZANDO los dos lados** (`mismaVendedora`). El mismo humano
 * tiene dos grafías vivas en producción —Cerberus empuja `Luz`, ella entra
 * como `luz`— y con comparación exacta el síntoma no sería un error: sería que
 * Luz no puede corregir sus propios eventos, sin un solo mensaje que lo diga.
 * Es el mismo agujero que ya se tapó en `cola/asignadaSql.ts` y `canales/dueno.ts`.
 */
function puedeTocar(fila: { vendedoraId: string }, vendedoraId: string): boolean {
  return mismaVendedora(fila.vendedoraId, vendedoraId);
}

async function leerVivo(base: typeof db, id: number) {
  const [fila] = await base
    .select()
    .from(eventosContacto)
    .where(and(eq(eventosContacto.id, id), isNull(eventosContacto.archivadoAt)))
    .limit(1);
  return fila ?? null;
}

/**
 * Corregir un evento. Solo su autora, y solo lo que es matiz: el comentario y
 * el curso. **El `tipo` no se edita** — cambiarlo convertiría una objeción en
 * una llamada sobre la misma fila y el mismo timestamp, que es reescribir la
 * historia, no corregir un dedazo. Para eso se archiva y se registra de nuevo.
 */
export async function editarEvento(
  base: typeof db,
  o: { id: number; vendedoraId: string; nota: string | null; curso: string | null },
): Promise<ResultadoEdicion> {
  const fila = await leerVivo(base, o.id);
  if (!fila) return { ok: false, codigo: "no_existe", message: "ese evento ya no está" };
  if (!puedeTocar(fila, o.vendedoraId)) {
    return {
      ok: false,
      codigo: "no_es_tuyo",
      message: `esto lo registró ${fila.vendedoraId}; solo quien lo escribió puede corregirlo`,
    };
  }

  const [actualizada] = await base
    .update(eventosContacto)
    .set({
      nota: o.nota,
      // El curso solo se pisa si el evento ya tenía uno: agregarle un curso a
      // una objeción por PATCH la convertiría en otra cosa (ver el porqué del
      // `tipo` inmutable, arriba).
      curso: fila.curso ? o.curso : fila.curso,
      editadoAt: new Date(),
    })
    .where(eq(eventosContacto.id, o.id))
    .returning();

  return { ok: true, evento: aFila(actualizada) };
}

/**
 * Borrar = archivar. No hay DELETE físico: lo que alguien afirmó y después
 * retiró es un dato (misma decisión que `notas.archivado_at` y que
 * «deshacer revoca, no borra» en `identidad/`).
 *
 * ⚠️ NO se des-asienta el interés. Archivar «preguntó por Gestión Pública» no
 * borra que la persona quiere ese curso: puede haberlo dicho por otro lado, y
 * quitarlo en silencio cerraría la compuerta de Cotizado sin que nadie entienda
 * por qué. El interés se saca desde donde se ve, con su propia X.
 */
export async function archivarEvento(
  base: typeof db,
  o: { id: number; vendedoraId: string },
): Promise<ResultadoEdicion> {
  const fila = await leerVivo(base, o.id);
  if (!fila) return { ok: false, codigo: "no_existe", message: "ese evento ya no está" };
  if (!puedeTocar(fila, o.vendedoraId)) {
    return {
      ok: false,
      codigo: "no_es_tuyo",
      message: `esto lo registró ${fila.vendedoraId}; solo quien lo escribió puede borrarlo`,
    };
  }

  const [actualizada] = await base
    .update(eventosContacto)
    .set({ archivadoAt: new Date() })
    .where(eq(eventosContacto.id, o.id))
    .returning();

  return { ok: true, evento: aFila(actualizada) };
}
