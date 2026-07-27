import { catalogo as catalogoDeAcuses } from "../autorespuesta/plantillas.js";
import { FAMILIAS } from "../autorespuesta/campana.js";
import { piezaDeUnMensaje } from "./armar.js";
import type { Pieza } from "./pieza.js";

/**
 * LAS PIEZAS QUE VIVEN EN CÓDIGO — los acuses fuera de horario y los ganchos por
 * familia.
 *
 * Dos de los cuatro catálogos no tienen tabla: cambiarlos cuesta un deploy. Eso
 * no es un accidente que haya que esconderle a Ivi —son los textos que salen
 * SOLOS de madrugada, y que estén bajo revisión de código es deliberado— pero sí
 * significa que no hay fila donde incrementar un contador de versión. Por eso la
 * versión es un hash del contenido (`piezas/version.ts`): funciona igual para
 * los cuatro.
 *
 * **No tocan la base.** Esa es su otra propiedad útil: aunque Postgres esté
 * caído, estas piezas existen. De ahí sale la guarda de la ruta — un catálogo
 * COMPLETAMENTE vacío no es un catálogo pobre, es un bug.
 *
 * Este archivo **traduce**, no construye: `armar.ts` es el único que arma una
 * `Pieza`, y el único que calcula una versión.
 */

/** Un gancho es media frase, no un mensaje: se lee como continuación de «una asesora …». */
function piezaDeGancho(f: (typeof FAMILIAS)[number]): Pieza {
  return piezaDeUnMensaje({
    clase: "gancho",
    id: f.id,
    rotulo: f.etiqueta,
    contenido: { texto: f.gancho },
    familia: { vocabulario: "campana-goberna", valor: f.id },
    // Un gancho NO se manda solo: es el pedazo que la plantilla del acuse
    // inserta en `{{gancho}}`. Mandarlo suelto sería una frase colgada.
    motivoNoEnviable: "fragmento",
  });
}

export function piezasDeCodigo(): Pieza[] {
  const acuses: Pieza[] = catalogoDeAcuses().map((p) =>
    piezaDeUnMensaje({
      clase: "acuse",
      id: p.id,
      rotulo: p.titulo,
      contenido: { texto: p.cuerpo },
      // El acuse no elige por momento: elige con su propio predicado `aplica()`
      // sobre la campaña, el curso y el momento, y el primero que aplica gana.
      // Declararle una lista de momentos acá sería una segunda cabeza que mañana
      // dice algo distinto del `aplica()` que de verdad decide.
      momentos: [],
    }),
  );

  return [...acuses, ...FAMILIAS.map(piezaDeGancho)];
}
