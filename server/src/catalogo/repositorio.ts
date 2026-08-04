import { asc } from "drizzle-orm";
import type { db } from "../db/client.js";
import { hechos, plantillaPasos, plantillas } from "../db/schema.js";
import { piezaDeUnMensaje, piezaDeUnaSecuencia, type PasoCrudo } from "./armar.js";
import { piezasDeCodigo } from "./codigo.js";
import { type EstadoPieza, type Pieza } from "./pieza.js";

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
 * ══ ACÁ NO SE ARMA NINGUNA PIEZA ════════════════════════════════════════════
 *
 * Este archivo **traduce filas a argumentos**; quien construye la `Pieza` —y
 * quien calcula la versión— es `armar.ts`, que a su vez usa la receta compartida
 * con el lazo (`piezas/version.ts`). Si acá se hasheara algo, ya serían dos
 * recetas: el modo de fallo que el ADR describe y que este repo ya cometió una
 * vez con la urgencia de la cola (#37).
 *
 * Lo que entra en la versión es solo lo que SALE hacia la persona: el texto y
 * **el archivo** adjunto. El nombre de la plantilla y el rótulo del hecho quedan
 * afuera a propósito — renombrar una etiqueta interna no es un texto nuevo, y si
 * contara, el lazo partiría el historial de una pieza porque alguien le arregló
 * una tilde al nombre que ve la vendedora.
 */

/**
 * Una propuesta MINADA no es de nadie: la escribió el histórico del equipo y la
 * app se la muestra a todas (ADR 0019). Aprobarla es hacerse cargo, y ahí sí
 * pasa a ser personal.
 */
function esDelEquipo(origen: string, estado: string, alcance: string): boolean {
  // Desde el 4-ago-2026 hay DOS formas de ser del equipo, y las dos tienen que
  // llegarle a Ivi igual: la vieja —una propuesta minada, que no es de nadie— y
  // la nueva y explícita: `alcance='equipo'`, que una persona eligió. Si esta
  // segunda no se reflejara acá, Ivi seguiría creyendo que una plantilla que las
  // cinco pueden mandar es de una sola, y al filtrar por vendedora se la
  // escondería a las otras cuatro — el mismo bug que ADR 0019 arregló en la app,
  // reencarnado del lado del catálogo.
  return alcance === "equipo" || (origen === "minado" && estado === "propuesta");
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

  const pasosPorPlantilla = new Map<number, PasoCrudo[]>();
  for (const f of filasPasos) {
    // `mediaArchivo` viaja hasta `armar.ts` porque **es lo que entra en la
    // versión**: el flyer es contenido, y en Goberna el precio y las fechas
    // viven adentro del flyer. `mediaClase` es solo la cadena "imagen" y no
    // distingue el de julio del de agosto.
    const paso: PasoCrudo = {
      orden: f.orden,
      texto: f.texto,
      mediaClase: f.mediaClase,
      mediaArchivo: f.mediaArchivo,
    };
    const lote = pasosPorPlantilla.get(f.plantillaId);
    if (lote) lote.push(paso);
    else pasosPorPlantilla.set(f.plantillaId, [paso]);
  }

  const piezasPlantilla: Pieza[] = filasPlantillas.map((f) =>
    piezaDeUnaSecuencia({
      id: String(f.id),
      rotulo: f.nombre,
      pasos: pasosPorPlantilla.get(f.id) ?? [],
      estado: estadoDePlantilla(f.estado, f.archivadoAt),
      // «Las plantillas son personales» es cierto A MEDIAS, y la mitad que falta
      // cambia qué significa pedir el catálogo de una vendedora: una **propuesta
      // minada es del EQUIPO**, no de la vendedora bajo cuyo id corrió el script
      // (`visiblePara` en `plantillas/repositorio.ts` — la tabla exige un
      // `vendedora_id`, así que el minado guarda uno cualquiera). Marcarla como
      // personal la escondería de `?vendedora=` para todas menos una, que es
      // exactamente el bug que ADR 0019 arregló en la app.
      alcance: esDelEquipo(f.origen, f.estado, f.alcance) ? "negocio" : "vendedora",
      propietario: f.vendedoraId,
      familia: f.familiaCurso ? { vocabulario: "sku-cerberus", valor: f.familiaCurso } : null,
    }),
  );

  const piezasHecho: Pieza[] = filasHechos.map((f) =>
    piezaDeUnMensaje({
      clase: "hecho",
      id: f.clave,
      rotulo: f.rotulo,
      contenido: { texto: f.texto },
      estado: f.activo ? "vigente" : "retirada",
      // Tal cual vienen de la base, sin filtrar por el enum de este build: ver
      // `pieza.ts`. Vacío significa «aplica a todos», así que descartar un
      // momento desconocido ENSANCHARÍA la pieza en vez de acotarla.
      momentos: Array.isArray(f.momentos) ? f.momentos.filter((m) => typeof m === "string") : [],
      motivoNoEnviable: f.activo ? null : "no_vigente",
    }),
  );

  return [...piezasPlantilla, ...piezasHecho, ...piezasDeCodigo()];
}
