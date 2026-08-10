import { randomBytes } from "node:crypto";

/**
 * EL LINK PÚBLICO DE UNA PÁGINA — el token y sus reglas, puras.
 *
 * ══ 🔴 ESTO ES LA PRIMERA PUERTA ANÓNIMA DE HERMES ══════════════════════════
 *
 * `auth/perimetro.ts` es **cerrado por defecto**, y es la cicatriz del issue #36:
 * antes cada router decidía por su cuenta si pedía token y **19 de 27 quedaron
 * abiertos a internet** —la cola, los hilos, los adjuntos de clientes reales—.
 * Las tres excepciones que hay hoy (`/api/auth`, `/api/admin`, `/api/catalogo`)
 * son **credenciales de servicio**: ninguna sirve contenido a alguien que no
 * presenta nada.
 *
 * Ésta sí. Y por eso las decisiones de abajo no son estilo:
 *
 * 1. **Vive FUERA de `/api`** (`/n/<token>`), montada antes del perímetro y en su
 *    propio router. Un prefijo exento adentro de `/api` sería una excepción que el
 *    próximo router hereda sin que nadie se entere — exactamente la forma que
 *    tuvo el #36.
 * 2. **El token es aleatorio de 128 bits, NUNCA el id de la nota.** Con el id,
 *    `/n/1`, `/n/2`, `/n/3` es el listado completo de la libreta de todo el mundo,
 *    y no hay forma de arreglarlo después sin romper los links repartidos.
 * 3. **Se corta y el corte es inmediato**: se borra la fila, no se marca un flag.
 *    Un `activo=false` invita a cachear el «sí» de antes.
 * 4. **Solo lectura, y solo ESA página**: no viaja la autora, ni el espacio, ni
 *    los miembros, ni el vecindario. Ver `LinkPublico`.
 */

/**
 * 16 bytes = 128 bits, en hex.
 *
 * ⚠️ **`randomBytes` y no `Math.random()`**: el segundo es predecible a partir de
 * unas pocas salidas, así que un link filtrado permitiría derivar los demás. Es la
 * diferencia entre «no se puede adivinar» y «no se puede adivinar fácil».
 *
 * Hex y no base64url a propósito: el token viaja en URLs que la vendedora pega en
 * WhatsApp, y `-` / `_` sobreviven mal a los autoformateadores de link.
 */
export function nuevoToken(): string {
  return randomBytes(16).toString("hex");
}

/** El largo exacto que produce `nuevoToken`. Un token de otro largo no se busca. */
export const LARGO_TOKEN = 32;

/**
 * ¿Esto tiene forma de token? Se pregunta ANTES de ir a la base.
 *
 * No es una optimización: sin esto, cualquier cadena de la URL entra como
 * parámetro a una consulta que se ejecuta una vez por request, y `/n/<lo que sea>`
 * se vuelve un generador de trabajo gratis contra la base **desde fuera del
 * perímetro** — que es justo lo que no se puede tener en una ruta anónima.
 */
export function pareceToken(valor: string): boolean {
  return valor.length === LARGO_TOKEN && /^[0-9a-f]+$/.test(valor);
}

/**
 * LO QUE EL LINK MUESTRA — y todo lo que deja afuera es deliberado.
 *
 * No lleva **autora** (quién trabaja en Goberna y en qué), ni **espacio** (cómo se
 * organiza el equipo), ni `creadoAt`/`editadoAt` (cuándo se movió qué), ni el id
 * de la nota. Nada de eso hace falta para leer una página, y todo eso es
 * información sobre la empresa que hoy no sale de Hermes.
 *
 * `titulo` se deriva del texto, como en la lista: es la primera línea.
 */
export interface LinkPublico {
  titulo: string;
  texto: string;
  /** El documento rico, o `null` en una nota vieja: se pinta desde `texto`. */
  doc: unknown;
  /**
   * ⚠️ Los tres de abajo son para que el SERVER decida qué hacer, y **no se
   * serializan hacia afuera en el alcance público**: `notaId` es lo único que la
   * app necesita para abrir la página de verdad, y decírselo a un desconocido no
   * aporta nada y numera el contenido.
   */
  notaId: number;
  alcance: import("./linkModelo.js").Alcance;
  permiso: import("./linkModelo.js").Permiso;
}

/**
 * Las cabeceras que toda respuesta pública lleva.
 *
 * ⚠️ **`noindex` no es opcional.** El primer link que alguien pegue en un grupo de
 * WhatsApp con vista previa, o en cualquier página, termina en el índice de
 * Google — y ahí el «solo quien tiene el link» deja de ser cierto para siempre,
 * incluso después de cortarlo.
 *
 * `Referrer-Policy: no-referrer` para que, si la página llegara a tener un enlace
 * saliente, el destino no reciba el token en el `Referer`.
 */
export const CABECERAS_PUBLICAS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  // Sin caché intermedio: cortar el link tiene que servir un 404 en el request
  // siguiente, no cuando venza un TTL que no controlamos.
  "Cache-Control": "no-store, max-age=0",
};
