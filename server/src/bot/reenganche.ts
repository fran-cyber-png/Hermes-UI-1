/**
 * EL REENGANCHE — lo único que el bot INICIA, y la palanca de más volumen que
 * no existía.
 *
 * ══ EL NÚMERO ═══════════════════════════════════════════════════════════════
 *
 * **38 de los 66 leads del 1-ago recibieron el material y no volvieron a
 * escribir nunca.** Ninguno dijo que no: se distrajeron. Es la mayoría de la
 * cartera de un día y hoy nadie los vuelve a tocar. La especificación entera es
 * `docs/como-se-vende-en-goberna.md` §5 bis; acá está el código de esas reglas,
 * puro, para poder interrogarlo sin base ni red.
 *
 * ══ POR QUÉ EL TEXTO ES FIJO Y NO LO ESCRIBE EL MODELO ══════════════════════
 *
 * El permiso de texto libre del bot (ADR 0028, que revierte ADR 0015 solo para
 * él) es para **conversar sobre lo que la persona dijo**. Acá la persona no dijo
 * nada: no hay mensaje nuevo que responder, no hay información nueva, y lo único
 * que el modelo podría hacer es decorar o —peor— inventarse una razón para
 * escribir («te escribo porque quedan pocos cupos»), que es urgencia inventada y
 * está prohibida (§6).
 *
 * Y la frase concreta importa. La del doc es:
 *
 *     «¿Qué tal, te pareció interesante el diploma? ¿Te resuelvo alguna duda?»
 *
 * **Pide una opinión, no una decisión.** «¿Estás interesado?» invita a un sí o
 * un no —y el no es gratis—; «¿qué te pareció?» invita a hablar. Un modelo
 * parafraseando esto termina en «¿sigues interesado?» nueve de cada diez veces,
 * que es justo la versión que el doc descarta. Es texto de catálogo, como los
 * acuses de `autorespuesta/plantillas.ts`: vive en código y cambiarlo cuesta un
 * deploy, a propósito, porque sale solo.
 *
 * ══ ARRANCA APAGADO, Y SE APAGA SIN DEPLOY ══════════════════════════════════
 *
 * Dos llaves, como la auto-respuesta (ADR 0015/0018):
 *
 *   1. **`BOT_FOLLOWUPS_DIA`, que ahora vale 0 por defecto** = apagado. Un
 *      deploy con este código adentro no le escribe a nadie: hay que poner el
 *      número a mano, y el camino para decidirlo es `npm run
 *      reenganche:simulacro`, que imprime el plan sin mandar nada.
 *   2. **El modo de la línea** (`bot_estado.modo`, `PUT /api/bot/modo`), que es
 *      el kill-switch que ya existe y no cuesta deploy. El reenganche sale
 *      **solo en `automatico` y sin freno**, y el modo se re-lee justo antes de
 *      mandar.
 *
 * ⚠️ **Lo que hoy NO se puede** y se escribe para que nadie lo descubra a las 2
 * de la mañana: apagar SOLO el reenganche sin deploy. La segunda llave apaga el
 * bot entero. La llave dedicada sería una columna nueva en `bot_estado`, y
 * agregarla tiene un modo de falla feo —`leerEstadoLinea` selecciona la fila
 * completa, así que con la migración sin aplicar la consulta falla y **el
 * kill-switch del modo deja de funcionar en silencio**, que es exactamente el
 * peor error posible en un interruptor. Va como decisión aparte, no de
 * contrabando.
 */

import { horaLocal, minutosLocales } from "../autorespuesta/franja.js";
import { esDespedida, huboRechazo, normalizarTexto } from "../autorespuesta/rechazo.js";
// El MISMO freno que usa el pipeline conversacional. Una implementación, no dos.
import { vendedoraActivaDesde } from "./frenos.js";

/** El único texto que el reenganche puede mandar. Ver la cabecera. */
export const TEXTO_REENGANCHE =
  "¿Qué tal, te pareció interesante el diploma? ¿Te resuelvo alguna duda?";

/**
 * Con qué motivo queda escrita la fila en `bot_respuestas`. Es también la llave
 * del «una sola vez»: no hay tabla de claims nueva, el claim ES esa fila.
 */
export const MOTIVO_REENGANCHE = "reenganche";

/** La zona con la que se lee todo reloj de esta feature (Perú no tiene DST). */
export const ZONA = "America/Lima";

/**
 * ANTES DE 2 HORAS TODAVÍA LO ESTÁ LEYENDO. Escribirle a los veinte minutos de
 * mandarle el temario no es reenganchar: es apurar a alguien que está mirando el
 * flyer.
 */
export const ESPERA_MINIMA_H = 2;

/**
 * Y DESPUÉS DE 20 NO SE PUEDE. **El techo no es una preferencia de tono: es la
 * ventana de servicio de WhatsApp.**
 *
 * Meta deja escribirle a alguien solo dentro de las **24 h desde SU último
 * mensaje**; pasado eso hace falta una plantilla aprobada, que no tenemos. Las
 * 20 h dejan margen para que la corrida lo tome y lo mande antes de que la
 * puerta se cierre.
 *
 * ⚠️ Y por eso no alcanza con este número solo: 20 h se cuentan desde **nuestro**
 * último mensaje, y la ventana se cuenta desde **el de él**. Son dos relojes
 * distintos, y cuando tardamos en contestar se separan — si el lead escribió a
 * las 10:00 y le contestamos a las 15:00, nuestro +20 h cae DESPUÉS de su +24 h.
 * Por eso `ventanaDeServicioAbierta` se pregunta aparte. El caso ya pasó:
 * `51932557675` dijo «próximo lunes» un sábado a las 16:28 y el lunes su ventana
 * estaba cerrada.
 */
export const ESPERA_MAXIMA_H = 20;

/** La ventana de servicio de Meta, y el margen con el que no se la roza. */
export const VENTANA_SERVICIO_H = 24;
export const MARGEN_VENTANA_H = 1;

/**
 * Cuánto hacia atrás mira la CONSULTA de candidatos. Es a propósito más ancha
 * que la regla —un superconjunto—: el SQL solo trae hechos crudos y el veredicto
 * lo da `decidirReenganche`. Si la consulta filtrara con el mismo umbral, habría
 * dos implementaciones del mismo número y un día dirían cosas distintas (#37).
 */
export const VENTANA_DE_CONSULTA_H = ESPERA_MAXIMA_H + 4;

const H = 3600_000;

/** Lo que hay que saber de una conversación para decidir. Todo crudo: sin veredictos. */
export interface HechosDelReenganche {
  clave: string;
  telefono: string;
  /** NUESTRO último mensaje, del bot o de una vendedora. `null` = nunca le hablamos. */
  ultimoSalienteEn: Date | null;
  /**
   * El último saliente de una PERSONA (`vendedora_id <> 'bot'`). `null` = nunca.
   *
   * Es el freno `vendedora_activa`, y va aparte de `ultimoSalienteEn` porque ese
   * los mezcla a propósito. Sin esta distinción el reenganche le escribe encima
   * a la vendedora: `laPelotaEsNuestra` da `true` igual si el último mensaje lo
   * escribió ella, y **no existe ninguna ruta con la que una persona diga «esta
   * la tomo yo»** — `bot_pausas` solo lo escriben `escalar` y `pausar` del propio
   * bot.
   *
   * Y el daño no termina ahí: en cuanto el bot escribe, `vendedoraActivaDesde`
   * deja de considerarla activa y el bot se queda con la conversación que ella
   * estaba trabajando.
   */
  ultimoSalienteHumanoEn: Date | null;
  /** El último mensaje DEL LEAD. Es el que abre la ventana de servicio. */
  ultimoEntranteEn: Date | null;
  /** ¿Le llegó el material? Una pieza del catálogo o un adjunto nuestro. */
  recibioElMaterial: boolean;
  /** Los últimos mensajes del lead, del más reciente al más viejo. */
  textosDelLead: readonly (string | null)[];
  /** ¿Hay fila en `bot_pausas`? Rechazo, despedida o escalada: no se toca. */
  tienePausa: boolean;
  /** ¿Ya le mandamos uno? Una sola vez, para siempre. */
  yaHuboReenganche: boolean;
}

export type MotivoNoReenganche =
  | "fuera_de_horario"
  | "ya_hubo_reenganche"
  | "pausada"
  | "nunca_le_hablamos"
  | "sin_material"
  | "la_pelota_es_suya"
  | "vendedora_activa"
  | "demasiado_pronto"
  | "demasiado_tarde"
  | "ventana_cerrada"
  | "dijo_que_no"
  | "se_despidio"
  | "puso_una_fecha";

export type VeredictoReenganche =
  | { manda: true }
  | { manda: false; motivo: MotivoNoReenganche };

/**
 * La ventana horaria, **con los nombres de `ConfigBot`** para poder pasarle la
 * config entera sin traducir. Traducir un par de números entre dos formas es
 * exactamente donde se cuela un `desde` en el lugar del `hasta`.
 */
export interface VentanaHoraria {
  followupHoraDesde: number;
  followupHoraHasta: number;
}

/**
 * ¿ES HORA? — se pregunta aparte porque es lo único que NO depende de la
 * conversación: a las 3 de la mañana no hay candidato posible, y preguntarlo
 * antes ahorra la consulta entera.
 *
 * `[desde, hasta)`, hora local de Lima: con 9–20, a las 20:00 ya no sale.
 */
export function esHoraDeReenganche(ahora: Date, v: VentanaHoraria): boolean {
  const hora = horaLocal(ahora, ZONA);
  return hora >= v.followupHoraDesde && hora < v.followupHoraHasta;
}

/** La medianoche local anterior a `ahora` — el corte del tope diario. */
export function inicioDelDiaLocal(ahora: Date): Date {
  return new Date(ahora.getTime() - minutosLocales(ahora, ZONA) * 60_000);
}

/**
 * ¿LA VENTANA DE SERVICIO SIGUE ABIERTA? — con margen, y fail-closed.
 *
 * Sin `ultimoEntranteEn` no se puede saber, y «no se sabe» acá es NO: mandar
 * fuera de la ventana no es una descortesía, es un mensaje que Meta rechaza (la
 * línea del bot es Cloud API). Un lead que nunca escribió tampoco debería estar
 * en esta lista.
 */
export function ventanaDeServicioAbierta(ultimoEntranteEn: Date | null, ahora: Date): boolean {
  if (!ultimoEntranteEn) return false;
  const horas = (ahora.getTime() - ultimoEntranteEn.getTime()) / H;
  return horas < VENTANA_SERVICIO_H - MARGEN_VENTANA_H;
}

/**
 * ¿LA PELOTA ES NUESTRA? — o sea: el último que habló fuimos nosotros.
 *
 * Si él escribió último, esto no es un reenganche: es una respuesta que debemos,
 * y mandarle «¿qué te pareció?» encima de una pregunta sin contestar es la peor
 * versión de todo esto. El empate cuenta como nuestra (mismo instante: no se
 * puede saber el orden, y el pipeline normal ya lo habría tomado).
 */
export function laPelotaEsNuestra(
  ultimoSalienteEn: Date | null,
  ultimoEntranteEn: Date | null,
): boolean {
  if (!ultimoSalienteEn) return false;
  if (!ultimoEntranteEn) return true;
  return ultimoSalienteEn >= ultimoEntranteEn;
}

/**
 * «DECIDO EL LUNES» NO ES SILENCIO: ES UN COMPROMISO.
 *
 * Es la objeción #1 del informe (13 %, el aplazamiento) y la única que el
 * reenganche empeora: a quien dijo «lo veo el fin de semana» escribirle al día
 * siguiente le confirma que no escuchamos. No existía detector —el CLAUDE.md lo
 * anota como hueco— así que va acá, y con la misma política que `rechazo.ts`:
 * **ante la duda, falso positivo**. Perder un reenganche cuesta un mensaje;
 * mandárselo a quien puso fecha cuesta el lead.
 *
 * Por eso entran frases de APLAZAMIENTO (un verbo en primera persona o un pedido
 * de que lo avisen), no días sueltos: «¿empieza el lunes?» es una pregunta, no
 * una promesa, y una lista con «lunes» a secas la trataría igual.
 */
const APLAZAMIENTOS = [
  // el compromiso de volver
  "te aviso",
  "le aviso",
  "les aviso",
  "te escribo",
  "le escribo",
  "les escribo",
  "te confirmo",
  "te comento",
  "te hablo",
  "me comunico",
  "yo te busco",
  "yo me contacto",
  // el pedido de que lo avisemos (mismo aplazamiento, del otro lado)
  "avisame",
  "avisenme",
  "me avisas",
  "me avisan",
  "me avisa",
  // lo que todavía no decidió
  "lo pienso",
  "lo voy a pensar",
  "voy a pensar",
  "dejame ver",
  "dejame revisar",
  "lo consulto",
  "lo evaluo",
  "lo reviso",
  "cuando decida",
  "aun no decido",
  "todavia no decido",
  // el momento que puso
  "mas adelante",
  "luego te",
  "despues te",
  "despues le",
  "cuando pueda",
  "cuando cobre",
  "cuando tenga",
  "cuando reciba",
  "cuando me paguen",
  "apenas pueda",
  "proxima semana",
  "proximo mes",
  "proximo ciclo",
  "proxima edicion",
  "proxima convocatoria",
  "el otro mes",
  "fin de mes",
  "quincena",
  // el plazo que cree tener
  "tengo plazo",
  "tengo tiempo",
  "hasta cuando tengo",
  // ⚠️ «fin de semana» NO está, y es la única que se decidió al revés: en esta
  // línea aparece mucho más como PREGUNTA de horario («¿hay grupos fin de
  // semana?») que como aplazamiento, y el aplazamiento con esas palabras casi
  // siempre trae además un verbo de los de arriba («el fin de semana te
  // confirmo»). Ponerla dejaría afuera del reenganche a quien pregunta por el
  // horario, que es un lead caliente.
];

/** Los días con «próximo» adelante: «el próximo lunes» sí, «el lunes» no. */
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

export function pusoUnaFecha(textos: readonly (string | null | undefined)[]): boolean {
  return textos.some((t) => {
    if (!t) return false;
    const limpio = normalizarTexto(t);
    if (!limpio) return false;
    if (APLAZAMIENTOS.some((f) => limpio.includes(f))) return true;
    return DIAS.some(
      (d) => limpio.includes(`proximo ${d}`) || limpio.includes(`el otro ${d}`),
    );
  });
}

/** Cuántos mensajes del lead se miran para lo del rechazo/despedida/fecha. */
export const ULTIMOS_MENSAJES_MIRADOS = 5;

/**
 * UN ENVÍO POR CORRIDA, y la corrida es cada 10 minutos (el despachador).
 *
 * Es lo que hace que el ritmo no necesite un espaciado propio adentro de un
 * bucle: **el espaciado ES la corrida**. Seis por hora como máximo, sobre
 * mensajes que el bot INICIA —los más caros si algo sale mal—, con el tope
 * diario encima. Mandar cinco de una y esperar una hora sería la misma cantidad
 * con forma de descarga, que es justo lo que no queremos que parezca.
 *
 * Vive con las demás reglas (y no en el que las ejecuta) para que el simulacro
 * pueda imprimir el ritmo real sin importar la mitad del server.
 */
export const ENVIOS_POR_CORRIDA = 1;

/**
 * EL VEREDICTO, EN ORDEN FIJO — del más barato y definitivo al más caro.
 *
 * El orden define QUÉ motivo se reporta cuando sobran razones, y eso importa
 * porque el simulacro agrupa los descartes por motivo: si «pausada» se evaluara
 * al final, la lista diría «demasiado pronto» sobre gente que ya dijo que no.
 */
export function decidirReenganche(
  h: HechosDelReenganche,
  ahora: Date,
  ventana: VentanaHoraria,
): VeredictoReenganche {
  if (!esHoraDeReenganche(ahora, ventana)) return no("fuera_de_horario");
  if (h.yaHuboReenganche) return no("ya_hubo_reenganche");
  if (h.tienePausa) return no("pausada");
  if (!h.ultimoSalienteEn) return no("nunca_le_hablamos");
  if (!h.recibioElMaterial) return no("sin_material");
  if (!laPelotaEsNuestra(h.ultimoSalienteEn, h.ultimoEntranteEn)) return no("la_pelota_es_suya");
  // `vendedora_activa`, la MISMA pregunta que se hace el pipeline conversacional
  // (`frenos.ts`): ¿contestó una persona después del último mensaje del lead? Si
  // sí, la conversación es de ella y el bot no la toca. Va DESPUÉS de
  // `laPelotaEsNuestra` porque comparten el instante del entrante y así el
  // motivo que se reporta es el más específico de los dos.
  if (vendedoraActivaDesde(h.ultimoSalienteHumanoEn, h.ultimoEntranteEn) !== null) {
    return no("vendedora_activa");
  }

  const esperaH = (ahora.getTime() - h.ultimoSalienteEn.getTime()) / H;
  if (esperaH < ESPERA_MINIMA_H) return no("demasiado_pronto");
  if (esperaH > ESPERA_MAXIMA_H) return no("demasiado_tarde");
  if (!ventanaDeServicioAbierta(h.ultimoEntranteEn, ahora)) return no("ventana_cerrada");

  // Los tres «no» del lead, sobre sus últimos mensajes. `textosDelLead` viene del
  // más reciente al más viejo, así que la despedida —que solo cuenta sobre el
  // ÚLTIMO (ver `rechazo.ts`)— es el primero.
  const ultimos = h.textosDelLead.slice(0, ULTIMOS_MENSAJES_MIRADOS);
  if (huboRechazo(ultimos)) return no("dijo_que_no");
  if (esDespedida(ultimos[0])) return no("se_despidio");
  if (pusoUnaFecha(ultimos)) return no("puso_una_fecha");

  return { manda: true };
}

function no(motivo: MotivoNoReenganche): VeredictoReenganche {
  return { manda: false, motivo };
}

/** Cuántas horas lleva esperando, para el renglón del simulacro y del log. */
export function horasDesde(instante: Date | null, ahora: Date): number | null {
  if (!instante) return null;
  return Math.round(((ahora.getTime() - instante.getTime()) / H) * 10) / 10;
}
