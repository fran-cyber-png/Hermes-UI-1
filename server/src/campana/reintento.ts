/**
 * UN TROPIEZO DE RED NO ES UN RECHAZO DE META.
 *
 * ══ EL DEFECTO QUE ESTE MÓDULO EXISTE PARA MATAR ════════════════════════════
 *
 * La campaña del Foro se frenó en el mensaje 446 de 999 con esto:
 *
 *     [446/999] ❌ 51952395437 — fetch failed
 *     🛑 FRENO: un error que no es el tope por usuario. No sigo.
 *
 * Meta estaba **sano** —`quality_rating: GREEN`, `status: CONNECTED`, medido al
 * minuto siguiente—. Lo que falló fue el viaje de VPS1 a `graph.facebook.com`:
 * un `fetch failed` de Node, o sea la capa de transporte, no una decisión del
 * otro lado. La corrida quedó a mitad de camino por un hipo de TCP.
 *
 * El freno total estaba bien pensado y mal calibrado. Su regla era «todo lo que
 * no sea 131049 frena», y el razonamiento escrito es correcto: *si Meta empieza
 * a rechazar por otra cosa, seguir mandando es cavar*. Pero eso vale para una
 * **decisión** de Meta (política, calidad, plantilla pausada). Un socket que se
 * cortó no es una decisión de nadie, y tratarlo como tal convierte cada bache
 * de red en una campaña trunca — con el agravante de que a los 15 s por mensaje
 * una corrida dura horas, así que la probabilidad de cruzarse uno tiende a 1.
 *
 * ══ NO ES UNA IDEA NUEVA: ES `esReintentable` DE IVI ════════════════════════
 *
 * `ivi/cliente.ts` ya resolvió exactamente esta pregunta y su tabla dice lo
 * mismo: `timeout` y `red` **siempre** se reintentan; config y contrato roto
 * **nunca**, porque dan el mismo error un minuto después. Acá se aplica el
 * mismo criterio a la otra puerta de salida.
 *
 * ══ LAS TRES CLASES, Y POR QUÉ NO SON DOS ══════════════════════════════════
 *
 *   · `tope_por_usuario` — el 131049. Ya existía y no cambia: es adaptativo,
 *     sin número publicado, y **no se puede predecir a quién le toca**. Se
 *     cuenta aparte y se sigue; no es una falla.
 *   · `transitorio` — la red. Se reintenta A ESA MISMA PERSONA, y si insiste
 *     ahí sí frena: un corte que dura tres intentos ya no es un hipo.
 *   · `definitivo` — todo lo demás. Frena entero, como antes.
 *
 * ⚠️ **El default es `definitivo`, no `transitorio`.** Un error que no
 * reconocemos se parece más a algo que hay que mirar que a algo que se arregla
 * solo, y el costo de equivocarse es asimétrico: frenar de más cuesta reanudar
 * a mano, seguir de más puede costar el número.
 */

export const CLASES_DE_FALLO = ["tope_por_usuario", "transitorio", "definitivo"] as const;
export type ClaseDeFallo = (typeof CLASES_DE_FALLO)[number];

/**
 * Las marcas de un fallo de TRANSPORTE, no de contenido.
 *
 * Son subcadenas y no expresiones exactas a propósito: el motivo llega envuelto
 * por varias capas (`EnvioControlado`, el transporte, el `fetch` de Node) y
 * cada una le pega su prefijo. Lo estable es la marca de adentro.
 */
const MARCAS_TRANSITORIAS = [
  "fetch failed", // el TypeError de undici cuando el socket no llega a abrirse
  "socket hang up",
  "econnreset",
  "econnrefused",
  "etimedout",
  "econnaborted",
  "enetunreach",
  "ehostunreach",
  "eai_again", // DNS que no resolvió en el momento
  "network",
  "timeout",
  "aborted",
] as const;

/**
 * Los 5xx de Graph son de Meta y son transitorios: su propio manual dice que se
 * reintenten. No se confunden con un rechazo porque un rechazo viene con
 * `code` en el cuerpo y estado 400.
 */
const MARCAS_5XX = ["500", "502", "503", "504"] as const;

/** El tope adaptativo de marketing por usuario. Ya se trataba aparte. */
const TOPE_POR_USUARIO = "131049";

export function clasificarFallo(motivo: string): ClaseDeFallo {
  const m = (motivo ?? "").toLowerCase();
  if (m.includes(TOPE_POR_USUARIO)) return "tope_por_usuario";
  if (MARCAS_TRANSITORIAS.some((marca) => m.includes(marca))) return "transitorio";

  /**
   * ⚠️ El 5xx se pregunta con el sustantivo al lado, no suelto.
   *
   * Buscar `"500"` a secas haría transitorio a cualquier motivo que mencione un
   * número de teléfono con esos dígitos —y todos los motivos de este script
   * llevan uno—. Es el defecto clásico de clasificar por subcadena, y acá
   * convertiría un rechazo de política en «reintentá»: exactamente el error que
   * el freno total existe para no cometer.
   */
  if (/\b(http|status|código|codigo|error)\D{0,3}(500|502|503|504)\b/.test(m)) return "transitorio";
  if (MARCAS_5XX.some((c) => m.includes(`graph ${c}`))) return "transitorio";

  return "definitivo";
}

/**
 * Cuánto esperar antes del intento `n` (1 = el primer reintento).
 *
 * Backoff exponencial corto y con techo: si la red volvió, volvió en segundos;
 * si no volvió en un minuto, el problema no es un hipo y frenar es lo correcto.
 * Sin jitter a propósito — acá hay UN emisor, no una flota, así que no hay
 * manada que sincronizar.
 */
export function esperaDeReintento(n: number): number {
  const segundos = Math.min(30, 5 * 2 ** (n - 1));
  return segundos * 1000;
}

/** Cuántas veces se reintenta a la misma persona antes de frenar la corrida. */
export const REINTENTOS_MAXIMOS = 3;
