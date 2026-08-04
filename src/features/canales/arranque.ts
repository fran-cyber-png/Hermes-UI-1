import { LINEA_MIAS } from './cola';

/**
 * DÓNDE ABRE LA COLA LA PRIMERA VEZ — la decisión, pura.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════
 *
 * El 4-ago-2026 entran cinco vendedoras nuevas y las cinco comparten UNA línea.
 * Sin esto, la primera vez que abren Hermes ven **las cuatro líneas juntas** —las
 * 93 conversaciones de la suya más las de Luz, Walter y Sindy—, y lo primero que
 * hacen es aprender a filtrar. El default estaba pensado para cuando había una
 * sola línea y una sola vendedora; hoy es ruido.
 *
 * ══ ES UN DEFAULT, NO UNA PARED ══════════════════════════════════════════
 *
 * ⚠️ **Esto no restringe nada y no se puede presentar como que sí.** Hermes no
 * tiene modelo de permisos —`requiereVendedora` dice «es una vendedora», no
 * «cuál»— y el hilo, la ficha y el envío siguen sirviendo cualquier conversación
 * a cualquier token. Lo que se elige acá es **dónde ABRE**, y salir de ahí cuesta
 * un click. Un recorte presentado como frontera sería una frontera imaginaria:
 * peor que ninguna, porque se le cree (`cola/lineas.ts`, `cola/asignadaSql.ts`).
 *
 * ══ EL ORDEN, Y POR QUÉ ══════════════════════════════════════════════════
 *
 *   1. **Sus leads asignados** («Míos»), si tiene alguno. Es lo que el reparto
 *      vino a resolver: con cinco personas en una línea, la línea ya no separa a
 *      nadie — las cinco verían las mismas 93 conversaciones.
 *   2. **Su línea** («Las mías»), si el mapa le asigna alguna. Es el recorte que
 *      existía antes del reparto y sigue siendo mejor que nada.
 *   3. **Todas**, que es el comportamiento de siempre.
 *
 * El paso 2 no es un adorno: es lo que evita que abra VACÍO. Una vendedora que
 * arranca hoy tiene cero asignadas, y abrir en «Míos» le mostraría una cola en
 * blanco el día uno — que se lee como «se rompió algo», no como «todavía no te
 * tocó ninguna».
 *
 * ══ SE DECIDE UNA VEZ ════════════════════════════════════════════════════
 *
 * Y solo si **nunca eligió nada**. Después de eso manda ella, aunque su elección
 * sea peor: un default que se reimpone es un default que pisa a la persona. Por
 * eso la decisión se toma con lo que se sabe en ese momento y se registra; que
 * más adelante se quede sin asignadas no vuelve a disparar nada (ahí ve el chip
 * «Míos» en 0 con su ✕, que es la verdad y sale con un click).
 */

export interface QueSabemosAlAbrir {
  /** Ya eligió alguna vez (hay preferencia guardada): entonces no se decide nada. */
  yaEligio: boolean;
  /** Cuántas conversaciones le asignó el reparto, dentro de lo que se está mirando. */
  asignadas: number;
  /** `numero_vendedora` le asigna alguna línea viva (`useLineas().hayMias`). */
  tieneLineasPropias: boolean;
}

export interface ArranqueDeLaCola {
  /** Abrir con el filtro «Míos» puesto. */
  mios: boolean;
  /** Qué poner en el eje de línea (`''` = todas, `LINEA_MIAS` = las suyas). */
  linea: string;
}

/**
 * Qué conviene abrirle. **`null` = no tocar nada** — o porque ya eligió, o porque
 * no hay nada mejor que «Todas» y escribir esa elección le gastaría su única
 * oportunidad de que el default la ayude cuando sí tenga algo.
 */
export function arranqueDeLaCola(s: QueSabemosAlAbrir): ArranqueDeLaCola | null {
  if (s.yaEligio) return null;
  if (s.asignadas > 0) return { mios: true, linea: '' };
  if (s.tieneLineasPropias) return { mios: false, linea: LINEA_MIAS };
  return null;
}
