import { esCotizacion } from "../senales/cotizacion.js";
import type { Plantilla } from "../plantillas/repositorio.js";
import type { Intencion } from "./estado.js";

/**
 * ¿QUÉ HACE ESTA PLANTILLA? — clasificar una secuencia por su intención.
 *
 * No hay una columna `intencion` en la tabla, y es a propósito: las plantillas
 * que van a existir el día uno salen del **minado del histórico** (PR 2), y
 * pedirle a alguien que además las etiquete a mano es pedirle un trabajo para
 * que la máquina no piense. Se clasifican por lo que DICEN.
 *
 * El detector de precio no se reescribe acá: se reusa `senales/cotizacion.ts`
 * (PR 1), el mismo que decide si un mensaje real fue una cotización. Una
 * plantilla que el detector marcaría como cotización ES la plantilla de precio.
 */

const RE = {
  temario: /temario|módulos|modulos|malla|plan de estudios|contenido del (curso|diploma)/i,
  presentarse: /te saluda|asesora comercial|mi nombre es|soy .{2,20} de goberna/i,
  seguimiento: /pudiste ver|sigues interesad|seguís interesad|alguna duda|qué te pareció|que te parecio|te reservo|confirmas/i,
  reactivar: /última|ultima|cierran las inscripciones|quedan pocas|vuelvo a escribirte|sigue disponible|última llamada/i,
} as const;

/**
 * Todas las intenciones que una plantilla cubre. Una secuencia larga cubre
 * varias (flyer + temario + precio): eso es correcto, y es lo que hace que
 * pueda sugerirse para más de un momento de la venta.
 */
export function intencionesDePlantilla(p: Plantilla): Set<Intencion> {
  const encontradas = new Set<Intencion>();
  const conMedia = p.pasos.some((x) => x.media || x.mediaPendiente);

  for (const paso of p.pasos) {
    const texto = paso.texto ?? "";
    // `{precio}` no es un monto todavía, pero declara la intención sin ambigüedad.
    if (/\{precio\}/.test(texto) || esCotizacion(texto).esCotizacion) encontradas.add("precio");
    if (RE.temario.test(texto)) encontradas.add("temario");
    if (RE.presentarse.test(texto)) encontradas.add("presentarse");
    if (RE.seguimiento.test(texto)) encontradas.add("seguimiento");
    if (RE.reactivar.test(texto)) encontradas.add("reactivar");
  }

  // El flyer es el material: una secuencia con imagen lo lleva casi seguro.
  // También el nombre, para las que se escriben a mano.
  if (conMedia || /flyer|folleto|brochure|diploma/i.test(p.nombre)) encontradas.add("flyer");

  // Sin ninguna señal, una secuencia con imagen es material y una sin imagen es
  // conversación. No se inventa nada más específico.
  if (encontradas.size === 0) encontradas.add(conMedia ? "flyer" : "seguimiento");

  return encontradas;
}

/** ¿La plantilla se puede mandar hoy? Aprobada y sin imágenes faltantes. */
export function esEnviable(p: Plantilla): boolean {
  return p.estado === "aprobada" && p.pasos.length > 0 && p.pasos.every((x) => !x.mediaPendiente);
}
