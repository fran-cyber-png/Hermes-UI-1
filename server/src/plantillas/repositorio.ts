import type { LineaDeNegocio } from "../negocio/lineaDeNegocio.js";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  /** `escuela` | `consultoria`. Lo declara la plantilla; nadie lo infiere. */
  negocio: LineaDeNegocio;
  origen: string;
  respaldo: number;
  usos: number;
  pasos: PasoPlantilla[];
}

export interface EntradaPlantilla {
  nombre: string;
  familiaCurso?: string | null;
  /** Default `escuela`: el negocio de siempre, para no cambiarle el sentido a nada. */
  negocio?: LineaDeNegocio;
  pasos: PasoPlantilla[];
}

type FilaPaso = typeof plantillaPasos.$inferSelect;

function aPaso(f: FilaPaso): PasoPlantilla {
  return {
    orden: f.orden,
    texto: f.texto,
    media: f.mediaArchivo
      ? {
          archivo: f.mediaArchivo,
          mime: f.mediaMime ?? "application/octet-stream",
          clase: f.mediaClase ?? "documento",
          nombre: f.mediaNombre,
        }
      : null,
    mediaPendiente: !f.mediaArchivo && f.mediaClase !== null,
  };
}

/**
 * Los pasos de un lote de plantillas, en una sola consulta (nada de N+1).
 *
 * Con el SELECT TIPADO de drizzle y no con `execute(sql…)` crudo, y no es un
 * detalle de estilo: `plantilla_id` es un `bigint`, y en crudo postgres.js lo
 * devuelve como **string**. Agrupar por esa clave contra ids numéricos daba un
 * mapa que nunca matcheaba y plantillas con CERO pasos — verde en los tests
 * puros, roto en los tests con base. Drizzle hace la conversión porque conoce
 * el `mode: 'number'` de la columna.
 */
async function pasosDe(base: typeof db, ids: number[]): Promise<Map<number, PasoPlantilla[]>> {
  const mapa = new Map<number, PasoPlantilla[]>();
  if (ids.length === 0) return mapa;

  const filas = await base
    .select()
    .from(plantillaPasos)
    .where(inArray(plantillaPasos.plantillaId, ids))
    .orderBy(asc(plantillaPasos.plantillaId), asc(plantillaPasos.orden));

  for (const f of filas) {
    const lote = mapa.get(f.plantillaId);
    if (lote) lote.push(aPaso(f));
    else mapa.set(f.plantillaId, [aPaso(f)]);
  }
  return mapa;
}

/**
 * QUÉ VE UNA VENDEDORA: lo suyo, **más las propuestas del minado**.
 *
 * Las aprobadas son personales: las escribió ella y son las que puede mandar.
 * Las **propuestas minadas no son de nadie** — salen del histórico del equipo, y
 * el script las guarda bajo UN `vendedoraId` porque la tabla exige uno. Con la
 * visibilidad atada a esa columna pasó lo que tenía que pasar: el minado guardó
 * dos propuestas con 418 y 296 conversaciones de respaldo, y la app le decía
 * «Todavía no hay secuencias» a todo el mundo menos a esa vendedora. Invisibles,
 * y sin ninguna forma de revisarlas desde la app.
 *
 * Verlas es seguro por construcción: una propuesta **no se puede mandar**
 * (`routes/plantillas.ts`, guarda 1). Al aprobarla, alguien se hace cargo y pasa
 * a ser suya.
 */
function visiblePara(vendedoraId: string) {
  return and(
    or(
      eq(plantillas.vendedoraId, vendedoraId),
      and(eq(plantillas.origen, "minado"), eq(plantillas.estado, "propuesta")),
    ),
    isNull(plantillas.archivadoAt),
  );
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
    .where(visiblePara(vendedoraId))
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
      negocio: f.negocio as LineaDeNegocio,
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

/** Una plantilla que esta vendedora puede ver. `null` si no existe o no la alcanza (→ 404). */
export async function obtenerPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
): Promise<Plantilla | null> {
  const [f] = await base
    .select()
    .from(plantillas)
    .where(and(eq(plantillas.id, id), visiblePara(vendedoraId)));
  if (!f) return null;

  const pasos = await pasosDe(base, [id]);
  return {
    id: f.id,
    nombre: f.nombre,
    familiaCurso: f.familiaCurso,
    estado: f.estado as EstadoPlantilla,
    negocio: f.negocio as LineaDeNegocio,
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
      negocio: entrada.negocio ?? "escuela",
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
 *
 * Aprobar **se hace cargo**: la plantilla pasa a ser de quien la aprobó. Una
 * propuesta la ve todo el equipo (`visiblePara`); una aprobada tiene dueño, que
 * es quien responde por lo que sale.
 *
 * `familiaCurso` viene resuelto por quien revisó (la inferida del minado
 * confirmada, otra, o `null` explícito = «sirve para cualquier curso»). Qué se
 * puede aprobar y qué no lo decide `aprobacion.ts`, puro; acá solo se escribe.
 */
export async function aprobarPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
  familiaCurso: string | null,
): Promise<Plantilla | null> {
  const actual = await obtenerPlantilla(base, vendedoraId, id);
  if (!actual) return null;
  await base
    .update(plantillas)
    .set({ estado: "aprobada", vendedoraId, familiaCurso, actualizadoAt: new Date() })
    .where(eq(plantillas.id, id));
  return obtenerPlantilla(base, vendedoraId, id);
}

/**
 * Archiva (soft-delete). Los pasos quedan: la plantilla se puede desarchivar a mano.
 *
 * Alcanza también a las propuestas del equipo: **descartar es parte de revisar**.
 * Si solo se pudieran archivar las propias, una propuesta que no sirve quedaría
 * para siempre arriba de la lista de todo el mundo.
 */
export async function archivarPlantilla(
  base: typeof db,
  vendedoraId: string,
  id: number,
): Promise<boolean> {
  const filas = await base
    .update(plantillas)
    .set({ archivadoAt: new Date() })
    .where(and(eq(plantillas.id, id), visiblePara(vendedoraId)))
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
        // La familia que el minado infirió del propio texto. Sin ella la
        // plantilla nacía sin curso y —aunque alguien la aprobara— no matcheaba
        // con ninguna conversación: aprobada e inútil. Es una PROPUESTA, no un
        // hecho: quien revisa la confirma o la cambia antes de aprobar.
        familiaCurso: p.familia ?? null,
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
