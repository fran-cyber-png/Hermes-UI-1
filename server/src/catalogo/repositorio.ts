import { asc } from "drizzle-orm";
import type { db } from "../db/client.js";
import { hechos, plantillaPasos, plantillas } from "../db/schema.js";
import { piezasDeCodigo } from "./codigo.js";
import { marcadoresDe, type EstadoPieza, type PasoDePieza, type Pieza } from "./pieza.js";
import { versionDeContenido } from "./version.js";

/**
 * EL CATÁLOGO ENTERO, PARA UNA MÁQUINA — y por qué acá NO se degrada.
 *
 * ══ LA REGLA, QUE ES UNA CICATRIZ AJENA ═════════════════════════════════════
 *
 * > Si el catálogo no se puede servir, **error — nunca una lista vacía.**
 *
 * Es el ADR 0002 de Ivi: un `{"ok": true}` con ceros les costó semanas, porque
 * una respuesta exitosa con contenido vacío es indistinguible de «no hay nada»
 * y se cachea como catálogo válido. Ivi se defiende (un catálogo vacío no se
 * cachea), pero la defensa correcta es que el productor no mienta.
 *
 * ══ POR QUÉ ESTO NO USA `hechos/repositorio.ts` ═════════════════════════════
 *
 * `leerCatalogo()` atrapa el error y sirve el catálogo medido por defecto, con
 * `editable: false`. Para la vendedora eso es exactamente lo correcto: ve las
 * frases igual y la UI le dice que no puede editarlas. Para una máquina que
 * indexa, no: se llevaría un catálogo incompleto sin nadie que lea el aviso, y
 * lo cachearía. Acá los errores **suben**, y la ruta los convierte en 5xx.
 *
 * Lo mismo vale para lo parcial: si `plantillas` falla y `hechos` responde, esto
 * NO devuelve medio catálogo. Un catálogo al que le falta la mitad es
 * indistinguible de un catálogo donde esa mitad no existe — la misma mentira,
 * con menos filas.
 *
 * ══ QUÉ ENTRA EN LA VERSIÓN ═════════════════════════════════════════════════
 *
 * Solo lo que SALE hacia la persona: el texto y las referencias de media. El
 * nombre de la plantilla y el rótulo del hecho quedan afuera a propósito —
 * renombrar una etiqueta interna no es un texto nuevo, y si contara, el lazo
 * partiría el historial de una pieza porque alguien le arregló una tilde al
 * nombre que ve la vendedora.
 */

/**
 * Una propuesta MINADA no es de nadie: la escribió el histórico del equipo y la
 * app se la muestra a todas (ADR 0019). Aprobarla es hacerse cargo, y ahí sí
 * pasa a ser personal.
 */
function esDelEquipo(origen: string, estado: string): boolean {
  return origen === "minado" && estado === "propuesta";
}

/** El estado de una plantilla, traducido al vocabulario del catálogo. */
function estadoDePlantilla(estado: string, archivadoAt: Date | null): EstadoPieza {
  if (archivadoAt) return "retirada";
  return estado === "aprobada" ? "vigente" : "borrador";
}

export async function leerPiezas(base: typeof db): Promise<Pieza[]> {
  const [filasPlantillas, filasPasos, filasHechos] = await Promise.all([
    base.select().from(plantillas).orderBy(asc(plantillas.id)),
    base
      .select()
      .from(plantillaPasos)
      .orderBy(asc(plantillaPasos.plantillaId), asc(plantillaPasos.orden)),
    base.select().from(hechos).orderBy(asc(hechos.orden), asc(hechos.clave)),
  ]);

  const pasosPorPlantilla = new Map<number, PasoDePieza[]>();
  for (const f of filasPasos) {
    const paso: PasoDePieza = {
      orden: f.orden,
      texto: f.texto,
      mediaClase: f.mediaClase,
      // El paso pide una imagen que todavía nadie cargó: es el estado natural de
      // una propuesta minada (el histórico sabe QUE ahí iba el flyer, no cuál).
      mediaPendiente: !f.mediaArchivo && f.mediaClase !== null,
    };
    const lote = pasosPorPlantilla.get(f.plantillaId);
    if (lote) lote.push(paso);
    else pasosPorPlantilla.set(f.plantillaId, [paso]);
  }

  const piezasPlantilla: Pieza[] = filasPlantillas.map((f) => {
    const pasos = pasosPorPlantilla.get(f.id) ?? [];
    const texto = pasos
      .map((p) => p.texto ?? "")
      .filter((t) => t.length > 0)
      .join("\n\n");
    const { placeholders, sintaxis } = marcadoresDe(texto);
    const estado = estadoDePlantilla(f.estado, f.archivadoAt);
    const mediaPendiente = pasos.some((p) => p.mediaPendiente);
    return {
      clase: "plantilla",
      id: String(f.id),
      version: versionDeContenido(
        pasos.flatMap((p) => [String(p.orden), p.texto, p.mediaClase]),
      ),
      estado,
      // «Las plantillas son personales» es cierto A MEDIAS, y la mitad que falta
      // cambia qué significa pedir el catálogo de una vendedora: una **propuesta
      // minada es del EQUIPO**, no de la vendedora bajo cuyo id corrió el script
      // (`visiblePara` en `plantillas/repositorio.ts` — la tabla exige un
      // `vendedora_id`, así que el minado guarda uno cualquiera). Marcarla como
      // personal la escondería de `?vendedora=` para todas menos una, que es
      // exactamente el bug que ADR 0019 arregló en la app.
      alcance: esDelEquipo(f.origen, f.estado) ? "negocio" : "vendedora",
      propietario: f.vendedoraId,
      rotulo: f.nombre,
      texto,
      momentos: [],
      familia: f.familiaCurso ? { vocabulario: "sku-cerberus", valor: f.familiaCurso } : null,
      pasos,
      placeholders,
      sintaxisPlaceholder: sintaxis,
      enviable: estado === "vigente" && !mediaPendiente,
      motivoNoEnviable:
        estado !== "vigente" ? "no_vigente" : mediaPendiente ? "media_pendiente" : null,
    };
  });

  const piezasHecho: Pieza[] = filasHechos.map((f) => {
    const { placeholders, sintaxis } = marcadoresDe(f.texto);
    return {
      clase: "hecho",
      id: f.clave,
      version: versionDeContenido([f.texto]),
      estado: f.activo ? "vigente" : "retirada",
      alcance: "negocio",
      propietario: null,
      rotulo: f.rotulo,
      texto: f.texto,
      // Tal cual vienen de la base, sin filtrar por el enum de este build: ver
      // `pieza.ts`. Vacío significa «aplica a todos», así que descartar un
      // momento desconocido ENSANCHARÍA la pieza en vez de acotarla.
      momentos: Array.isArray(f.momentos) ? f.momentos.filter((m) => typeof m === "string") : [],
      familia: null,
      pasos: null,
      placeholders,
      sintaxisPlaceholder: sintaxis,
      enviable: f.activo,
      motivoNoEnviable: f.activo ? null : "no_vigente",
    };
  });

  return [...piezasPlantilla, ...piezasHecho, ...piezasDeCodigo()];
}
