import { catalogo as catalogoDeAcuses } from "../autorespuesta/plantillas.js";
import { FAMILIAS } from "../autorespuesta/campana.js";
import { marcadoresDe, type Pieza } from "./pieza.js";
import { versionDeContenido } from "./version.js";

/**
 * LAS PIEZAS QUE VIVEN EN CÓDIGO — los acuses fuera de horario y los ganchos por
 * familia.
 *
 * Dos de los cuatro catálogos no tienen tabla: cambiarlos cuesta un deploy. Eso
 * no es un accidente que haya que esconderle a Ivi —son los textos que salen
 * SOLOS de madrugada, y que estén bajo revisión de código es deliberado— pero sí
 * significa que no hay fila donde incrementar un contador de versión. Por eso la
 * versión es un hash del texto (`version.ts`): funciona igual para los cuatro.
 *
 * **No tocan la base.** Esa es su otra propiedad útil: aunque Postgres esté
 * caído, estas piezas existen. De ahí sale la guarda de la ruta — un catálogo
 * COMPLETAMENTE vacío no es un catálogo pobre, es un bug.
 */

/** Un gancho es media frase, no un mensaje: se lee como continuación de «una asesora …». */
function piezaDeGancho(f: (typeof FAMILIAS)[number]): Pieza {
  return {
    clase: "gancho",
    id: f.id,
    version: versionDeContenido([f.gancho]),
    estado: "vigente",
    alcance: "negocio",
    propietario: null,
    rotulo: f.etiqueta,
    texto: f.gancho,
    momentos: [],
    familia: { vocabulario: "campana-goberna", valor: f.id },
    pasos: null,
    placeholders: [],
    sintaxisPlaceholder: null,
    // Un gancho NO se manda solo: es el pedazo que la plantilla del acuse
    // inserta en `{{gancho}}`. Mandarlo suelto sería una frase colgada.
    enviable: false,
    motivoNoEnviable: "fragmento",
  };
}

export function piezasDeCodigo(): Pieza[] {
  const acuses: Pieza[] = catalogoDeAcuses().map((p) => {
    const { placeholders, sintaxis } = marcadoresDe(p.cuerpo);
    return {
      clase: "acuse",
      id: p.id,
      version: versionDeContenido([p.cuerpo]),
      estado: "vigente",
      alcance: "negocio",
      propietario: null,
      rotulo: p.titulo,
      texto: p.cuerpo,
      // El acuse no elige por momento: elige con su propio predicado `aplica()`
      // sobre la campaña, el curso y el momento, y el primero que aplica gana.
      // Declararle una lista de momentos acá sería una segunda cabeza que
      // mañana dice algo distinto del `aplica()` que de verdad decide.
      momentos: [],
      familia: null,
      pasos: null,
      placeholders,
      sintaxisPlaceholder: sintaxis,
      enviable: true,
      motivoNoEnviable: null,
    };
  });

  return [...acuses, ...FAMILIAS.map(piezaDeGancho)];
}
