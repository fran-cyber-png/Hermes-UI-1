import { sql, type SQL } from "drizzle-orm";

/**
 * ¿ESTA PERSONA PIDIÓ ALGO? — y la trampa que hizo que durante meses la respuesta
 * fuera casi siempre que sí.
 *
 * ── EL DEFECTO, MEDIDO ────────────────────────────────────────────────────────
 *
 * El predicado anterior (`PIDE_INFO_REGEX_SQL`, en `urgenciaSql.ts`) buscaba 14
 * palabras sueltas en el último entrante. Medido en producción el 11-ago-2026
 * sobre la ventana de 30 días (3.995 conversaciones), enganchaba **685** — y de
 * esas:
 *
 *   · **604 (88 %) las disparaba UNA sola palabra: `informaci`.**
 *   · **563 de las 685 (82 %) son el texto que PRELLENA META** cuando alguien
 *     toca el botón de un anuncio click-to-WhatsApp. Los dos más repetidos:
 *       «Hola Quiero más información del Diploma de Inteligencia y
 *        Contrainteligencia»            → 424
 *       «Hola. Quiero más información sobre el servicio de Consultoría.» → 99
 *
 * Nadie preguntó nada: **hicieron clic en un botón**. Y ese es exactamente el
 * daño, porque la vendedora lee el preview de la fila, ve una frase que empieza
 * con «Quiero más información del Diploma…» y **contesta como si respondiera una
 * pregunta**, cuando lo que tiene delante es una conversación que todavía no
 * empezó y hay que abrir.
 *
 * Además se tragaba lo contrario de un pedido: «Muchas gracias por la
 * información. Talvez en otra ocasión» entraba igual, y `interes` matchea «no me
 * interesa», y `cómo` matchea «cómo estás».
 *
 * ── LA FORMA: DOS NIVELES, Y LOS VETOS SOLO PISAN AL DÉBIL ────────────────────
 *
 * El primer intento fue sacar `informaci` del regex. **Estaba mal, y lo mostró el
 * control**: se perdían pedidos escritos a mano y reales — «Necesito
 * información», «Un poco más de información x favor», «Información sobre el
 * curso». Lo que hay que vetar no es la palabra: es **el texto de Meta**.
 *
 * El segundo intento vetaba la cortesía sobre todo el predicado, y también estaba
 * mal: descartaba **«Pásame la cotización urgentemente quiero comprar ahora
 * mismo»**, que es el mejor lead que hubo en la mesa en 30 días. De ahí salen los
 * dos niveles:
 *
 *   · **PRECIO** (fuerte) — habla de plata: precio, cuotas, yape, link de pago,
 *     cotización, inscribirme. **Ningún veto de cortesía lo tumba.** Si alguien
 *     dice «gracias por la información, ¿cuánto cuesta?», eso es una venta
 *     empezando, no una despedida.
 *   · **DATOS** (débil) — pide información, temario, certificado, requisitos,
 *     horario. Éste **sí** se veta con el texto del anuncio, con las fórmulas de
 *     cierre y con las autorespuestas de OTROS negocios (al escribirle a un
 *     número que es una empresa vuelve «Gracias por comunicarte con X ¿Cómo
 *     podemos ayudarte?», que no es un lead pidiendo nada).
 *
 * Resultado medido con el mismo corpus: **65** con señal de precio y **50** que
 * solo piden datos — **115** en total contra las 685 de antes, y con los dos
 * controles corridos (lo que se descarta es todo basura; lo que se agrega —
 * «Cuantas cuotas?», «el nombre de yape es a nombre de una empresa?», «Más tarde
 * hago el pago», «me podrías enviar el link de pago de nuevo»— es todo bueno y el
 * predicado viejo no lo veía).
 *
 * ── POR QUÉ `esTextoDeAnuncio` ES UNA SEÑAL Y NO SOLO UN VETO ─────────────────
 *
 * Son **563 conversaciones, el 14 % de la mesa**. Saber que el mensaje lo escribió
 * el anuncio y no la persona cambia lo que hay que hacer: no se responde, se abre.
 * Por eso sale como columna propia y se dibuja en la fila, en vez de morir adentro
 * de un `AND NOT`.
 *
 * ── MISMO PATRÓN QUE `cola/precio.ts` (ADR 0009) ─────────────────────────────
 *
 * La definición vive UNA vez —el fuente del regex— y de ahí salen la función pura
 * y el fragmento SQL, con test de paridad. Y, como allá, **a propósito sin `\b`**:
 * en Postgres `\b` es un backspace, no un borde de palabra. No es una precaución
 * teórica — `server/src/canales/consultas.ts` tenía una copia de este predicado
 * con `info\b` y **nunca matcheó nada**, verificado contra la base viva:
 * `'necesito info hoy' ~* 'info\b'` da `false`.
 */

/**
 * Los cuatro fuentes se EXPORTAN para que el test de paridad pueda componerlos
 * del lado de Postgres exactamente como los compone acá — pasándolos como
 * parámetro, sin `sql.raw` y sin volver a escribirlos.
 */

/**
 * NIVEL 1 — PLATA. Ninguna fórmula de cortesía tumba esto: si alguien nombra el
 * precio o cómo pagar, es una venta empezando aunque la frase venga envuelta en
 * un «muchas gracias».
 */
export const PRECIO =
  "precio|costo|cuesta|cu[áa]nto|inversi[óo]n|cotiza|comprar|adquirir|cuota|financia|pagar|pago|yape|plin|transferenc|dep[óo]sito|link de pago|inscri|matricul|apuntarme|separar";

/**
 * NIVEL 2 — UN SUSTANTIVO CONCRETO. Le gana al veto del anuncio, y por una razón
 * medible: **el texto que prellena Meta no contiene ninguna de estas palabras**
 * (verificado sobre las 563 conversaciones que lo traen). Entonces, si alguien
 * escribió «temario» o «certificado», lo escribió esa persona — no el botón.
 * Sigue cediendo ante un cierre y ante una autorespuesta ajena.
 */
export const CONCRETO =
  "temario|malla|s[íi]labo|plan de estudio|certificad|acredit|convalid|factura|boleta|comprobante|requisit|dirigido|horario|duraci[óo]n|(cu[áa]ndo|cuando) (empieza|inicia|comienza)|fecha de inicio";

/**
 * «INFO» A SECAS, con borde de palabra — y el borde escrito a mano a propósito.
 *
 * 🔴 No se puede usar `\b`: en Postgres es un backspace (ver la cabecera). Y
 * tampoco `\y`, que Postgres entiende y JavaScript no — un fuente compartido no
 * puede tener un escape que signifique cosas distintas en cada motor, que es
 * exactamente cómo nació el bug de `canales/consultas.ts`. La clase negada anda
 * igual en los dos y no depende de ningún escape.
 *
 * Sin borde, `info` matchearía «informal» y «infografía»; con él, «info?»,
 * «más info» y «info por favor» entran, y «información» la agarra `informaci`.
 *
 * ⚠️ Lo encontró un test que ya existía, no el censo: en 30 días de producción
 * **ninguna** conversación terminó con «info» a secas, así que la medición no lo
 * hubiera pedido nunca. El predicado viejo sí lo tenía —roto en una copia, sano
 * en la otra— y sacarlo hubiera sido perder señal sin enterarse.
 */
const INFO_A_SECAS = "(^|[^a-záéíóúñ])info([^a-záéíóúñ]|$)";

/**
 * NIVEL 3 — UN PEDIDO GENÉRICO. «Información», «más datos», «me interesa». Es
 * exactamente lo que dice el texto del anuncio, así que acá **sí** manda el veto:
 * es la única forma de separar a quien lo escribió de quien tocó un botón.
 */
export const GENERICO =
  `informaci|${INFO_A_SECAS}|m[áa]s datos|detalle|(saber|conocer) (m[áa]s)|(quiero|quisiera|me gustar[íi]a) saber|me interesa|interesad`;

/**
 * EL TEXTO QUE PRELLENA META en un anuncio click-to-WhatsApp. Es solo la
 * APERTURA: no se intenta acotar el final.
 *
 * ⚠️ La primera versión terminaba en `[^?]*$` para dejar pasar a quien le agrega
 * una pregunta al mensaje del anuncio. **Estaba mal y lo encontró el test**: una
 * de las seis variantes reales termina ella misma en signo de pregunta —«Hola.
 * ¿Puedo obtener más información sobre esto?», 13 casos— y se escapaba del veto.
 * Quien agrega una pregunta de verdad no se pierde igual: entra por el nivel 1 o
 * por el 2, que no miran este veto.
 */
export const TEXTO_DE_ANUNCIO =
  "^[\\s¡!¿]*hola[\\s.,!¡¿:;-]*(quiero|quisiera|me gustar[íi]a|puedo obtener|me interesa|deseo)\\s+(conseguir\\s+)?(m[áa]s)?\\s*informaci";

/** Las formas de decir que no, y las de agradecer y cerrar. */
export const CORTESIA_DE_CIERRE =
  "no me interesa|no me interesan|no interesa|no gracias|no, gracias|otra ocasi[óo]n|ya no|por ahora no|no deseo|no quiero|gracias por la informaci|lo medito|lo pienso";

/**
 * La autorespuesta de OTRO negocio. Aparece cuando la vendedora le escribe a un
 * número que es una cuenta de empresa: no es un lead pidiendo nada.
 */
export const AUTORESPUESTA_AJENA =
  "gracias por comunicarte con|gracias por contactarnos|mensaje autom[áa]tico|te comunicas con el departamento|c[óo]mo podemos ayudarte|c[óo]mo puedo ayudarte";

// ── Las mismas reglas, como funciones puras ──────────────────────────────────

const RE_PRECIO = new RegExp(PRECIO, "i");
const RE_CONCRETO = new RegExp(CONCRETO, "i");
const RE_GENERICO = new RegExp(GENERICO, "i");
const RE_ANUNCIO = new RegExp(TEXTO_DE_ANUNCIO, "i");
const RE_CIERRE = new RegExp(CORTESIA_DE_CIERRE, "i");
const RE_AJENO = new RegExp(AUTORESPUESTA_AJENA, "i");

/**
 * ¿ESTE MENSAJE LO ESCRIBIÓ EL ANUNCIO Y NADA MÁS? Abre con el texto de Meta **y
 * no trae ninguna palabra propia** — porque quien le agregó una pregunta ya no
 * «solo hizo clic», y marcarlo así sería tan falso como lo que se vino a
 * arreglar. Sin texto, no: un audio o una foto no son el texto de Meta, y decir
 * que sí borraría la única señal que esa fila tiene.
 */
export function esTextoDeAnuncio(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return RE_ANUNCIO.test(texto) && !RE_PRECIO.test(texto) && !RE_CONCRETO.test(texto);
}

/** ¿Habló de plata? El nivel 1: no lo tumba ninguna cortesía. */
export function preguntoPrecio(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return RE_PRECIO.test(texto);
}

/**
 * ¿Pidió datos? Los niveles 2 y 3, con la diferencia que los separa: **un
 * sustantivo concreto no mira el veto del anuncio, un pedido genérico sí**.
 */
export function pidioDatos(texto: string | null | undefined): boolean {
  if (!texto) return false;
  if (RE_CIERRE.test(texto) || RE_AJENO.test(texto)) return false;
  if (RE_CONCRETO.test(texto)) return true;
  return RE_GENERICO.test(texto) && !RE_ANUNCIO.test(texto);
}

/** ¿Pidió ALGO? La unión de los dos niveles — lo que la fila muestra. */
export function pregunto(texto: string | null | undefined): boolean {
  return preguntoPrecio(texto) || pidioDatos(texto);
}

// ── Los mismos predicados, dichos en SQL ─────────────────────────────────────

/**
 * El fuente como literal SQL entrecomillado. Constantes fijas (no entra input de
 * nadie), así que `sql.raw` es seguro — el mismo recurso que `cola/precio.ts`.
 */
const cita = (fuente: string): string => `'${fuente}'`;

/**
 * EL ÚLTIMO ENTRANTE CON TEXTO, dentro del `GROUP BY` de la cola.
 *
 * `FILTER (... AND texto IS NOT NULL)`: un audio, una foto o un sticker POSTERIOR
 * no borran lo que la persona pidió — la última palabra es el último mensaje que
 * TIENE palabras. Es la misma decisión que traía `pideInfoAgrupadoSql`, y el
 * motivo por el que se mira el ÚLTIMO y no `bool_or` sobre el historial sigue
 * siendo el de #49: **manda lo último que dijo**, o una persona que preguntó el
 * precio hace tres semanas se lleva el chip para siempre aunque ya haya dicho que
 * no.
 */
const ULTIMO_ENTRANTE = sql`(array_agg(texto ORDER BY occurred_at DESC)
  FILTER (WHERE direccion = 'entrante' AND texto IS NOT NULL))[1]`;

/**
 * LAS TRES REGLAS EN SQL, SOBRE UNA EXPRESIÓN CUALQUIERA — y **una sola vez**.
 *
 * Toman la expresión ya armada (el último entrante del `GROUP BY`, o una columna
 * suelta) en vez de repetirse por call-site: es lo que hace que la versión
 * agrupada y la de un texto suelto no puedan divergir, que es exactamente cómo
 * nacieron los dos regex de `pide_info` que este módulo viene a enterrar.
 */
const precioDe = (t: SQL): SQL => sql`${t} ~* ${sql.raw(cita(PRECIO))}`;

const datosDe = (t: SQL): SQL => sql`(
  ${t} !~* ${sql.raw(cita(CORTESIA_DE_CIERRE))}
  AND ${t} !~* ${sql.raw(cita(AUTORESPUESTA_AJENA))}
  AND (
    ${t} ~* ${sql.raw(cita(CONCRETO))}
    OR (${t} ~* ${sql.raw(cita(GENERICO))} AND ${t} !~* ${sql.raw(cita(TEXTO_DE_ANUNCIO))})
  )
)`;

const anuncioDe = (t: SQL): SQL => sql`(
  ${t} ~* ${sql.raw(cita(TEXTO_DE_ANUNCIO))}
  AND ${t} !~* ${sql.raw(cita(PRECIO))}
  AND ${t} !~* ${sql.raw(cita(CONCRETO))}
)`;

/** `pregunto_precio` de una conversación agrupada — espejo de `preguntoPrecio`. */
export const preguntoPrecioAgrupadoSql: SQL = sql`COALESCE(${precioDe(ULTIMO_ENTRANTE)}, false)`;

/** `pregunto` de una conversación agrupada — espejo de `pregunto` (los tres niveles). */
export const preguntoAgrupadoSql: SQL = sql`COALESCE(
  ${precioDe(ULTIMO_ENTRANTE)} OR ${datosDe(ULTIMO_ENTRANTE)},
  false
)`;

/** `solo_clic` de una conversación agrupada — espejo de `esTextoDeAnuncio`. */
export const soloClicAgrupadoSql: SQL = sql`COALESCE(${anuncioDe(ULTIMO_ENTRANTE)}, false)`;

/**
 * EL MISMO PREDICADO SOBRE UN TEXTO SUELTO — para un comentario de FB/IG, que es
 * su propio último mensaje y no tiene `GROUP BY` donde vivir. Toma la columna
 * como parámetro (mismo patrón que `diaLimaSql`): los call-sites la referencian
 * distinto, `texto` a secas en la cola y `i.texto` calificado en el CTE del radar.
 */
export function preguntoSql(columna: string): SQL {
  const c = sql`${sql.raw(columna)}`;
  return sql`(${precioDe(c)} OR ${datosDe(c)})`;
}

/** `pregunto_precio` sobre un texto suelto. Mismo par que `preguntoSql`. */
export function preguntoPrecioSql(columna: string): SQL {
  return sql`(${precioDe(sql`${sql.raw(columna)}`)})`;
}

/** `solo_clic` sobre un texto suelto. Mismo par que `preguntoSql`. */
export function soloClicSql(columna: string): SQL {
  return anuncioDe(sql`${sql.raw(columna)}`);
}

/**
 * CUÁNTOS DÍAS DE DEUDA SIGUEN SIENDO TRABAJO — el corte de «Te escribieron».
 *
 * `NOT respondida` a secas daba **505** conversaciones en producción, de las
 * cuales **472 (93 %) tenían más de 7 días** y solo **5** estaban dentro de la
 * ventana de 24 h de Meta. Eso no es una lista de tareas: es un cementerio, y
 * abrirlo cada mañana enseña a ignorarlo. Con el corte son **33**.
 *
 * Lo viejo NO desaparece de la cola —la fila sigue estando y el orden la sigue
 * poniendo donde corresponde—: lo que desaparece es el chip que prometía que eso
 * era el trabajo del día.
 */
export const DIAS_DEUDA_VIVA = 7;
