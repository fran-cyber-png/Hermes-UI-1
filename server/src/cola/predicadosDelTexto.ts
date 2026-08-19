import { mencionaPrecio } from "./precio.js";
import { esTextoDeAnuncio, pidioDatos, preguntoPrecio } from "./pregunta.js";

/**
 * LOS PREDICADOS DE TEXTO SE CALCULAN AL ESCRIBIR, NO EN CADA LECTURA.
 *
 * ── EL DEFECTO, MEDIDO EL 19-AGO-2026 CONTRA PRODUCCIÓN ───────────────────────
 *
 * El `GroupAggregate` que arma el universo de la cola quemaba **1.339–1.541 ms**
 * de CPU propia por pedido: 19 regex sobre 16.254 filas para producir 5.645
 * grupos. Contrafáctico read-only con el MISMO SQL y la misma base, neutralizando
 * sólo las aplicaciones de regex:
 *
 *     con regex  → GroupAggregate propio 1.339 · 1.435 · 1.541 ms
 *     sin regex  → GroupAggregate propio     70 ·    74 ·    79 ms
 *
 * O sea: **el 95 % de ese nodo son los regex**, y son el 58 % del pedido entero.
 *
 * Y responden preguntas sobre **el texto de un mensaje, que no cambia nunca**:
 * ¿mencionó precio? ¿preguntó por plata? ¿fue sólo el clic del anuncio? Se
 * recalculaban **13.152 veces por día** para **220 mensajes que se escriben una
 * vez**. Es el mismo movimiento que #185 hizo con `numero_propio`: lo que se
 * deriva del contenido de una fila se materializa EN la fila.
 *
 * ── LA REGLA NO SE MUEVE, SÓLO CAMBIA CUÁNDO CORRE ────────────────────────────
 *
 * 🔴 `cola/precio.ts` y `cola/pregunta.ts` siguen siendo **la única definición**.
 * Este módulo no decide nada: junta las cuatro funciones puras que ya existían y
 * las corre en el momento de escribir. Un segundo criterio acá sería #37 sobre el
 * predicado que ordena la cola — el peor lugar posible para tener dos verdades.
 *
 * ── POR QUÉ CUATRO Y NO TRES ──────────────────────────────────────────────────
 *
 * `pregunto` (el de la fila) es `preguntoPrecio || pidioDatos`, así que podría
 * guardarse como una sola columna. Se guardan **los dos sumandos** porque la cola
 * los pregunta por separado: el chip «Preguntaron precio» es sólo el primero. Con
 * la unión materializada, ese chip tendría que volver al regex.
 */
export interface PredicadosDelTexto {
  /** `mencionaPrecio` — ¿este mensaje pasó un precio o la forma de pagarlo? */
  mencionaPrecio: boolean;
  /** `preguntoPrecio` — nivel 1 de `cola/pregunta.ts`: habló de plata. */
  preguntaPrecio: boolean;
  /** `pidioDatos` — niveles 2 y 3: pidió información, con sus vetos. */
  pideDatos: boolean;
  /** `esTextoDeAnuncio` — el texto que prellena Meta, y nada propio encima. */
  esTextoDeAnuncio: boolean;
}

/**
 * Los cuatro predicados de un texto, de una sola pasada.
 *
 * ⚠️ **Sin texto devuelve los cuatro en `false`, no `null`.** Las cuatro funciones
 * puras ya contestan `false` a un texto vacío o ausente (un audio no preguntó
 * nada), así que guardar `false` dice lo mismo que calcularlo. `NULL` en la
 * columna significa una sola cosa y es otra: **«esta fila es anterior al backfill»**
 * — el disparador del fallback al regex. Confundir los dos haría que una foto
 * pagara regex para siempre.
 */
export function predicadosDelTexto(texto: string | null | undefined): PredicadosDelTexto {
  return {
    mencionaPrecio: mencionaPrecio(texto),
    preguntaPrecio: preguntoPrecio(texto),
    pideDatos: pidioDatos(texto),
    esTextoDeAnuncio: esTextoDeAnuncio(texto),
  };
}
