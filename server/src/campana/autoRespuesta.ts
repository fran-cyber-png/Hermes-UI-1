/**
 * ¿ESTO LO ESCRIBIÓ UNA PERSONA, O EL WHATSAPP BUSINESS DE OTRA EMPRESA?
 *
 * ══ EL PROBLEMA, MEDIDO ═════════════════════════════════════════════════════
 *
 * La campaña `foro_estado_5_ago` salió a gente que **nunca había escrito**, y
 * una parte de esos números son **negocios**. Un negocio con WhatsApp Business
 * tiene un saludo automático, así que nos contesta solo — al instante y sin que
 * ningún humano lea nada.
 *
 * Medido sobre las 13 primeras respuestas reales del 5-ago-2026: **5 eran bots
 * de otras empresas**. La pantalla las contaba como «respondieron» y, peor,
 * como «sin atender» — o sea que mandaba a una vendedora a atender el
 * contestador de un taller mecánico.
 *
 * ══ QUÉ LAS DELATA, Y POR QUÉ ES TAN ESPECÍFICO ═════════════════════════════
 *
 * Todas tienen la misma forma: **nos agradecen por contactarlos A ELLOS**.
 *
 *     «Gracias por comunicarte con JM RUSH AUTOMOTRIZ, en qué te podemos ayudar?»
 *     «¡Hola! 👋 Gracias por contactar a Reynaldo Marketing Político…»
 *
 * Eso invierte los roles: nos tratan como el cliente. **Una persona que contesta
 * nuestra campaña nunca escribe esa frase**, porque no es ella la contactada.
 * Por eso el criterio es esa inversión y no «parece automático»: «gracias por
 * escribirme» lo dice una persona, y «te respondo en breve» también.
 *
 * ══ SESGADO AL FALSO NEGATIVO, A PROPÓSITO ══════════════════════════════════
 *
 * Mismo criterio que `autorespuesta/rechazo.ts`: **ante la duda, es una
 * persona.** Contar un bot como lead cuesta que alguien abra un chat y cierre;
 * esconder a una persona real cuesta un lead perdido que nadie va a buscar
 * porque la pantalla dijo que no existía. Los dos errores no valen lo mismo.
 *
 * ══ LO QUE NO HACE ══════════════════════════════════════════════════════════
 *
 * **No las borra.** Se cuentan aparte (`autoRespuestas`) y se dicen. Esconderlas
 * del todo sería la otra forma de mentir: alguien miraría «628 enviados, 5
 * respondieron» y no sabría que hay negocios en la lista — que es justamente el
 * dato que hay que usar para armar mejor la próxima.
 */

/** Se normaliza igual que en `rechazo.ts`: sin tildes, sin emojis, en minúsculas. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * LA INVERSIÓN DE ROLES: nos agradecen por contactarlos.
 *
 * Los verbos son los que aparecen en el corpus real. Se exige la preposición
 * (`con`/`a`) porque sin ella «gracias por comunicarte» a secas lo puede decir
 * una persona agradeciendo el mensaje — y ahí volvemos al falso positivo.
 */
const NOS_AGRADECEN_POR_CONTACTARLOS =
  /gracias por (comunicart[e]|contactar|escribir|comunicarse|contactarnos)\s*(con|a|al|nos)\b/;

/**
 * Frases de contestador que NO invierten roles pero son inequívocas. Lista
 * corta y literal: cada una salió de un mensaje real, no de imaginar cómo
 * hablaría un bot.
 */
const FRASES_DE_CONTESTADOR = [
  "este es un mensaje automatico",
  "mensaje automatico",
  "respuesta automatica",
  "nuestro horario de atencion es",
  "en breve un asesor se comunicara",
  "en breve nos comunicaremos contigo",
  "hemos recibido tu mensaje",
];

/**
 * ¿Es el contestador de otro negocio?
 *
 * `false` ante cualquier duda — incluido texto vacío, `null` y cualquier cosa
 * que no sea una cadena.
 */
export function esAutoRespuestaDeNegocio(texto: string | null | undefined): boolean {
  if (typeof texto !== "string") return false;
  const limpio = normalizar(texto);
  if (!limpio) return false;
  if (NOS_AGRADECEN_POR_CONTACTARLOS.test(limpio)) return true;
  return FRASES_DE_CONTESTADOR.some((f) => limpio.includes(f));
}
