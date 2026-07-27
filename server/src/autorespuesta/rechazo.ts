/**
 * «NO ME ESCRIBAS MÁS» — el detector de rechazo, y su primo el de despedida.
 *
 * Es el guardarraíl más importante del contenido: una máquina que le insiste a
 * quien ya dijo que no es exactamente lo que la gente denuncia, y con razón.
 * Ante la duda, este helper prefiere el FALSO NEGATIVO: no detectar un rechazo
 * raro solo cuesta un mensaje de más; detectarlo donde no lo hay silencia a un
 * lead que sí quería que le contesten.
 *
 * Por eso NO alcanza con que aparezca un «no». «no me llegó el temario» y «¿no
 * hay descuento?» son preguntas de alguien interesado. Lo que se busca son
 * FRASES completas de rechazo, sobre el texto normalizado (sin tildes, sin
 * signos, en minúsculas) y con bordes de palabra.
 *
 * ── Las tres formas de decir que no (#166) ──
 * Hasta el 27-jul acá vivían solo las EXPLÍCITAS («no me interesa», «borren mi
 * número»), y con eso el sistema le preparó un «gracias por escribirnos» a una
 * abogada que ya había dicho «no me es de mucha utilidad» y se había despedido.
 * Las tres formas, y por qué son dos funciones y no una:
 *
 *   1. el **no explícito** — «no me interesa». Vale para siempre y para toda la
 *      conversación: `huboRechazo` lo busca en todos los mensajes.
 *   2. el **no con motivo** — «soy abogada, y no me es de mucha utilidad». Es
 *      igual de definitivo que el explícito, así que vive en la misma lista.
 *   3. el **cierre cortés** — «agradezco mucho la atención prestada». NO es un
 *      no: es «esta consulta terminó». Por eso está aparte (`esDespedida`) y
 *      solo cuenta sobre el ÚLTIMO mensaje: quien se despidió el martes y
 *      vuelve a escribir el jueves está abriendo una consulta nueva.
 *
 * Puro: entra texto, sale un booleano. Sin IO, sin reloj.
 */

/** Frases que son un no, mirando el mensaje entero o una parte suya. */
const FRASES_DE_RECHAZO = [
  'no gracias',
  'no me interesa',
  'no estoy interesad',
  'ya no me interesa',
  'no me interesan',
  'no quiero nada',
  'no quiero informacion',
  'no quiero mas informacion',
  'ya no quiero',
  'ya no deseo',
  'ya no necesito',
  'ya compre',
  'ya me inscribi en otro',
  'no me escriban',
  'no me escribas',
  'no me vuelvan a escribir',
  'dejen de escribir',
  'deja de escribir',
  'dejen de enviar',
  'no me manden',
  'no me molesten',
  'no molesten',
  'dejenme en paz',
  'eliminen mi numero',
  'borren mi numero',
  'borrenme',
  'dar de baja',
  'darme de baja',
  'quiero darme de baja',
  'me quiero dar de baja',
  'numero equivocado',
  'se equivoco de numero',
  'te equivocaste de numero',
];

/**
 * EL NO CON MOTIVO (#166) — «soy abogada, y no me es de mucha utilidad».
 *
 * Es tan definitivo como un «no me interesa», pero va en su propia lista porque
 * es CONDICIONAL: solo cuenta cuando el mensaje no pide nada más. «El horario no
 * me sirve, ¿hay otro grupo?» lleva la misma frase adentro y significa lo
 * contrario — es alguien que quiere comprar. Un no explícito no necesita ese
 * cuidado; uno con motivo, sí.
 *
 * Se listan las formas del VEREDICTO, nunca el motivo: la profesión, el
 * presupuesto o la ciudad son datos de esa persona, no frases de rechazo.
 */
const FRASES_DE_NO_CON_MOTIVO = [
  'no me es de mucha utilidad',
  'no me es de utilidad',
  'no me es util',
  'no me seria util',
  'no me sirve',
  'no me serviria',
  'no es lo que buscaba',
  'no es lo que busco',
  'no es lo que necesito',
  'no es lo que estaba buscando',
  'no es lo que esperaba',
  'no aplica para mi',
  'no va con lo que hago',
  'no tiene que ver con lo que hago',
];

/**
 * Mensajes que SOLOS (el texto entero, nada más) son un no. Van aparte porque
 * como fragmento darían falsos positivos: «ya no» dentro de «ya no me llegó»
 * no es un rechazo, pero un mensaje que dice solo «ya no» sí lo es.
 */
const MENSAJES_QUE_SON_UN_NO = ['no', 'no gracias', 'ya no', 'ya no gracias', 'stop', 'baja', 'basta'];

export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // fuera las tildes: «interés» y «interes» son lo mismo
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ') // signos, emojis y puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Esta persona dijo que no? */
export function expresaRechazo(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpio = normalizarTexto(texto);
  if (!limpio) return false;
  if (MENSAJES_QUE_SON_UN_NO.includes(limpio)) return true;
  if (FRASES_DE_RECHAZO.some((frase) => limpio.includes(frase))) return true;
  // El no con motivo cede ante cualquier pedido en el mismo mensaje.
  return !pideAlgo(texto, limpio) && FRASES_DE_NO_CON_MOTIVO.some((frase) => limpio.includes(frase));
}

/**
 * EL CIERRE CORTÉS — «agradezco mucho la atención prestada», «gracias por todo».
 *
 * No es un no y no se guarda como tal: es una conversación que la persona dio
 * por terminada. Sirve para una sola cosa (`decidir.ts`, motivo
 * `conversacion_cerrada`): no acusarle recibo de una consulta que nadie hizo.
 *
 * ── El borde que importa ──
 * **«gracias» a secas NO es un cierre.** Es lo que contesta quien acaba de
 * recibir el flyer y sigue leyendo. Por eso todas las frases de la lista tienen
 * un OBJETO —la atención, el tiempo, todo— y no alcanza con la palabra suelta.
 * Y si el mensaje pide algo (una pregunta, un «me interesa»), no hay cierre por
 * más «gracias» que traiga: nadie se despide preguntando el precio.
 */
const FRASES_DE_CIERRE = [
  'gracias por la atencion',
  'gracias por su atencion',
  'gracias por tu atencion',
  'gracias por la atencion prestada',
  'agradezco la atencion',
  'agradezco mucho la atencion',
  'agradezco su atencion',
  'agradezco tu atencion',
  'agradezco el tiempo',
  'agradezco su tiempo',
  'agradezco tu tiempo',
  'gracias por su tiempo',
  'gracias por tu tiempo',
  'gracias por el tiempo',
  'gracias por todo',
  'gracias por la amabilidad',
  'gracias por la gentileza',
  'quedo agradecid',
  'estamos en contacto',
  'cualquier cosa te escribo',
  'cualquier cosa les escribo',
  'cualquier cosa me comunico',
];

/**
 * Señales de que el mensaje SIGUE ESPERANDO algo. Cualquiera de estas y no hay
 * ni cierre ni no con motivo: el que pregunta quiere respuesta.
 *
 * OJO al elegir una palabra para esta lista: no puede ser una que aparezca
 * DENTRO de una frase de rechazo o de cierre, o la anula. «necesito» parece
 * obvia acá y no puede estar: «no es lo que necesito» dejaría de ser un no.
 * Por eso son verbos de PEDIDO, no sustantivos de tema («temario», «precio»),
 * que se nombran igual para pedirlos que para descartarlos.
 */
const PIDE_ALGO = [
  'me interesa',
  'quiero',
  'quisiera',
  'me gustaria',
  'puede',
  'podria',
  'me pasas',
  'me envias',
  'me mandas',
  'reenvia',
  'como hago',
  'cuanto',
  'cuando',
  'donde',
  'hay otro',
  'espero tu',
  'espero su',
  'quedo atent',
];

/** ¿El mensaje pide algo? Entonces no es una despedida, por más «gracias» que traiga. */
function pideAlgo(crudo: string, limpio: string): boolean {
  if (/[?¿]/.test(crudo)) return true;
  return PIDE_ALGO.some((f) => limpio.includes(f));
}

/** ¿Con este mensaje la persona cerró la conversación? */
export function esDespedida(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpio = normalizarTexto(texto);
  if (!limpio) return false;
  if (pideAlgo(texto, limpio)) return false;
  return FRASES_DE_CIERRE.some((frase) => limpio.includes(frase));
}

/**
 * ¿Dijo que no en ALGUNO de estos mensajes? Se mira la conversación reciente,
 * no solo el último: el «no me interesa» de ayer sigue valiendo hoy.
 */
export function huboRechazo(textos: readonly (string | null | undefined)[]): boolean {
  return textos.some(expresaRechazo);
}
