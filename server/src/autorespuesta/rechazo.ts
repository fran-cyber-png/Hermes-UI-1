/**
 * «NO ME ESCRIBAS MÁS» — el detector de rechazo.
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
  return FRASES_DE_RECHAZO.some((frase) => limpio.includes(frase));
}

/**
 * ¿Dijo que no en ALGUNO de estos mensajes? Se mira la conversación reciente,
 * no solo el último: el «no me interesa» de ayer sigue valiendo hoy.
 */
export function huboRechazo(textos: readonly (string | null | undefined)[]): boolean {
  return textos.some(expresaRechazo);
}
