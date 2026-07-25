import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { plantillaPasos, plantillas } from "../db/schema.js";
import type { SecuenciaPropuesta } from "./proponer.js";

/**
 * EL REPOSITORIO DE PLANTILLAS — el seam inyectable (estilo `consultarCategorias`).
 *
 * Recibe `db` INYECTADO: la ruta le pasa el singleton, el test su base de prueba
 * (ADR 0008). Todo el SQL de plantillas vive acá; la ruta solo valida HTTP.
 *
 * Los PASOS se reemplazan enteros en cada edición, nunca se parchean uno a uno:
 * una secuencia es una unidad («flyer, después temario, después duración»), y
 * editar el paso 2 sin ver el 3 es cómo se rompen las secuencias.
 */

export type EstadoPlantilla = "propuesta" | "aprobada";

export interface MediaPaso {
  /** Nombre del archivo dentro de `RUTA_MEDIA`. */
  archivo: string;
  mime: string;
  clase: string;
  nombre: string | null;
}

export interface PasoPlantilla {
  orden: number;
  texto: string | null;
  media: MediaPaso | null;
  /**
   * El paso PIDE una imagen que todavía no está cargada. Es el estado natural de
   * una propuesta minada: el histórico sabe QUE en ese lugar iba el flyer, no
   * CUÁL archivo era. Un paso así **no se puede enviar** — se ve en la lista con
   * su hueco y alguien sube la imagen.
   */
  mediaPendiente: boolean;
}

export interface Plantilla {
  id: number;
  nombre: string;
  familiaCurso: string | null;
  estado: EstadoPlantilla;
  origen: string;
  respaldo: number;
  usos: number;
  pasos: PasoPlantilla[];
}

export interface EntradaPlantilla {
  nombre: string;
  familiaCurso?: string | null;
  pasos: PasoPlantilla[];
}

interface FilaPaso {
  plantilla_id: number;
  orden: number;
  texto: string | null;
  media_archivo: string | null;
  media_mime: string | null;
  media_clase: string | null;
  media_nombre: string | null;
}

function aPaso(f: FilaPaso): PasoPlantilla {
  return {
    orden: f.orden,
    texto: f.texto,
    media: f.media_archivo
      ? {
          archivo: f.media_archivo,
          mime: f.media_mime ?? "application/octet-stream",
          clase: f.media_clase ?? "documento",
          nombre: f.media_nombre,
        }
      : null,
    mediaPendiente: !f.media_archivo && f.media_clase !== null,
  };
}

/** Los pasos de un lote de plantillas, en una sola consulta (nada de N+1). */
async function pasosDe(base: typeof db, ids: number[]): Promise<Map<number, PasoPlantilla[]>> {
  const mapa = new Map<number, PasoPlantilla[]>();
  if (ids.length === 0) return mapa;

  const lista = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const filas = (await base.execute(sql`
    SELECT plantilla_id, orden, texto, media_archivo, media_mime, media_clase, media_nombre
    FROM plantilla_pasos
    WHERE plantilla_id IN (${lista})
    ORDER BY plantilla_id, orden
  `)) as unknown as FilaPaso[];

  for (const f of filas) {
    const lote = mapa.get(f.plantilla_id);
    if (lote) lote.push(aPaso(f));
    else mapa.set(f.plantilla_id, [aPaso(f)]);
  }
  return mapa;
}

/**
 * Las plantillas vivas de la vendedora, con sus pasos. Orden: primero las
 * aprobadas (son las que se pueden mandar) por uso, después las propuestas por
 * respaldo — la propuesta que el histórico respalda más, arriba de las otras.
 */
export async function listarPlantillas(base: typeof db, vendedoraId: string): Promise<Plantilla[]> {
  const filas = await base
    .select()
    .from(plantillas)
    .where(and(eq(plantillas.vendedoraId, vendedoraId), isNull(plantillas.archivadoAt)))
    .orderBy(asc(plantillas.nombre));

  const pasos = await pasosDe(
    base,
    filas.map((f) => f.id),
  );

  return filas
    .map((f) => ({
      id: f.id,
      nombre: f.nombre,
      familiaCurso: f.familiaCurso,
      estado: f.estado as EstadoPlantilla,
      origen: f.origen,
      respaldo: f.respaldo,
      usos: f.usos,
      pasos: pasos.get(f.id) ?? [],
    }))
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === "aprobada" ? -1 : 1;
      if (a.estado === "aprobada") return b.usos - a.usos || a.nombre.localeCompare(b.nombre, "es");
      return b.respaldo - a.respaldo || a.nombre.localeCompare(b.nombre, "es");
    });
}

/** Una plantilla propia con sus pasos. `null` si no existe o no es suya (→ 404). */
export async function obtenerPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
): Promise<Plantilla | null> {
  const [f] = await base
    .select()
    .from(plantillas)
    .where(
      and(
        eq(plantillas.id, id),
        eq(plantillas.vendedoraId, vendedoraId),
        isNull(plantillas.archivadoAt),
      ),
    );
  if (!f) return null;

  const pasos = await pasosDe(base, [id]);
  return {
    id: f.id,
    nombre: f.nombre,
    familiaCurso: f.familiaCurso,
    estado: f.estado as EstadoPlantilla,
    origen: f.origen,
    respaldo: f.respaldo,
    usos: f.usos,
    pasos: pasos.get(id) ?? [],
  };
}

/** Escribe los pasos de una plantilla, renumerados 1..N. Reemplaza los que había. */
async function escribirPasos(base: typeof db, plantillaId: number, pasos: PasoPlantilla[]) {
  await base.delete(plantillaPasos).where(eq(plantillaPasos.plantillaId, plantillaId));
  if (pasos.length === 0) return;
  await base.insert(plantillaPasos).values(
    pasos.map((p, i) => ({
      plantillaId,
      orden: i + 1,
      texto: p.texto,
      mediaArchivo: p.media?.archivo ?? null,
      mediaMime: p.media?.mime ?? null,
      // Sin archivo pero con clase = «acá va una imagen y falta cargarla».
      mediaClase: p.media?.clase ?? (p.mediaPendiente ? "imagen" : null),
      mediaNombre: p.media?.nombre ?? null,
    })),
  );
}

/**
 * Crea una plantilla. La que escribe una vendedora nace **aprobada** (ya la
 * revisó al escribirla); la que sale del minado nace `propuesta`.
 */
export async function crearPlantilla(
  base: typeof db,
  vendedoraId: string,
  entrada: EntradaPlantilla,
  estado: EstadoPlantilla = "aprobada",
): Promise<Plantilla> {
  const [fila] = await base
    .insert(plantillas)
    .values({
      vendedoraId,
      nombre: entrada.nombre,
      familiaCurso: entrada.familiaCurso ?? null,
      estado,
      origen: "manual",
    })
    .returning({ id: plantillas.id });

  await escribirPasos(base, fila.id, entrada.pasos);
  return (await obtenerPlantilla(base, vendedoraId, fila.id))!;
}

/** Edita SOLO la propia. `pasos` presente ⇒ reemplaza la secuencia entera. */
export async function editarPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
  patch: { nombre?: string; familiaCurso?: string | null; pasos?: PasoPlantilla[] },
): Promise<Plantilla | null> {
  const actual = await obtenerPlantilla(base, vendedoraId, id);
  if (!actual) return null;

  const cambios: Record<string, unknown> = { actualizadoAt: new Date() };
  if (patch.nombre !== undefined) cambios.nombre = patch.nombre;
  if (patch.familiaCurso !== undefined) cambios.familiaCurso = patch.familiaCurso;

  await base.update(plantillas).set(cambios).where(eq(plantillas.id, id));
  if (patch.pasos) await escribirPasos(base, id, patch.pasos);

  return obtenerPlantilla(base, vendedoraId, id);
}

/**
 * APROBAR: el acto humano que convierte una propuesta minada en algo enviable.
 * Sin este paso, lo que salió del histórico no se puede mandar — es la línea
 * entre «te sugiero» y «lo hice solo».
 */
export async function aprobarPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
): Promise<Plantilla | null> {
  const actual = await obtenerPlantilla(base, vendedoraId, id);
  if (!actual) return null;
  await base
    .update(plantillas)
    .set({ estado: "aprobada", actualizadoAt: new Date() })
    .where(eq(plantillas.id, id));
  return obtenerPlantilla(base, vendedoraId, id);
}

/** Archiva (soft-delete). Los pasos quedan: la plantilla se puede desarchivar a mano. */
export async function archivarPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
): Promise<boolean> {
  const filas = await base
    .update(plantillas)
    .set({ archivadoAt: new Date() })
    .where(
      and(
        eq(plantillas.id, id),
        eq(plantillas.vendedoraId, vendedoraId),
        isNull(plantillas.archivadoAt),
      ),
    )
    .returning({ id: plantillas.id });
  return filas.length > 0;
}

/** +1 uso. Se llama cuando la secuencia terminó de salir, no cuando se abrió. */
export async function sumarUso(base: typeof db, id: number): Promise<void> {
  await base
    .update(plantillas)
    .set({ usos: sql`${plantillas.usos} + 1` })
    .where(eq(plantillas.id, id));
}

/**
 * Guarda lo que el minado propone. **Idempotente**: borra las propuestas minadas
 * que todavía nadie aprobó y escribe las nuevas — re-correr el script no
 * duplica, y jamás pisa una plantilla que una persona ya aprobó o editó.
 */
export async function guardarPropuestas(
  base: typeof db,
  vendedoraId: string,
  propuestas: readonly SecuenciaPropuesta[],
): Promise<number> {
  await base
    .delete(plantillas)
    .where(
      and(
        eq(plantillas.vendedoraId, vendedoraId),
        eq(plantillas.origen, "minado"),
        eq(plantillas.estado, "propuesta"),
      ),
    );

  for (const p of propuestas) {
    const [fila] = await base
      .insert(plantillas)
      .values({
        vendedoraId,
        nombre: p.nombre,
        estado: "propuesta",
        origen: "minado",
        respaldo: p.respaldo,
      })
      .returning({ id: plantillas.id });

    await escribirPasos(
      base,
      fila.id,
      p.pasos.map((paso) => ({
        orden: paso.orden,
        texto: paso.texto,
        // El minado sabe QUE hubo imagen, no CUÁL: el archivo lo adjunta la
        // persona que revisa. Mejor un paso marcado «falta la imagen» que
        // reusar a ciegas un adjunto de una conversación ajena.
        media: null,
        mediaPendiente: paso.conMedia,
      })),
    );
  }

  return propuestas.length;
}
