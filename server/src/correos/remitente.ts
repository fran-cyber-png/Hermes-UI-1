/**
 * EL SOBRE DE UN CORREO — de quién sale, a quién le contestan, y con qué firma.
 *
 * ══ LAS DOS FRASES QUE LA PANTALLA DECÍA Y ERAN FALSAS ═══════════════════
 *
 * 🔴 La vista Correos existe desde el 21-jul-2026 y desde ese día promete dos
 * cosas que **el código nunca hizo**:
 *
 *   · «Se envía solo a esta persona, **con tu nombre**.» → el `From` era
 *     `SMTP_FROM` y nada más: **el mismo para las nueve**. Un correo de Sindy y
 *     uno de Luz llegaban idénticos, firmados «Escuela Goberna».
 *   · «va en texto plano, **con tu firma de siempre**» → no había una sola línea
 *     en el server que agregara una firma. Ninguna. El cuerpo salía tal cual.
 *
 * Y había un tercer agujero que ninguna de las dos frases mencionaba: **no había
 * `Reply-To`**, así que cuando el lead contestaba, la respuesta caía en
 * `escuela@goberna.us` — un buzón de Google Workspace que Hermes no lee y que la
 * vendedora que escribió no sabe que existe. O sea: el canal servía para mandar
 * y **estructuralmente no podía recibir**. Con tres filas en toda la base (las
 * tres pruebas) nadie lo descubrió operando.
 *
 * Este módulo es lo que vuelve ciertas esas dos frases. Es puro: no importa `db`
 * ni lee `process.env` (el molde es `padron/supervisor.ts`), así que se puede
 * interrogar sobre el nombre con comillas y sobre el asunto con un salto de línea
 * sin levantar un SMTP.
 *
 * ══ POR QUÉ EL `From` NO PUEDE SER EL CORREO DE LA VENDEDORA ═════════════
 *
 * Medido contra DNS y SES el 17-ago-2026:
 *
 *   · **`goberna.us` está verificado como DOMINIO en SES** (existe el TXT
 *     `_amazonses.goberna.us`). Cualquier `algo@goberna.us` puede ser remitente.
 *   · **`grupogoberna.com` NO está verificado en SES.** Y los `vendedora_id` de
 *     tres de las nueve SON de ese dominio (`ventas10@`, `ventas11@`,
 *     `ventas12@grupogoberna.com`). Ponerlos de `From` es un **554 de SES**, con
 *     un lead esperando del otro lado.
 *   · El **display name del `From` no se verifica**: ahí sí puede ir el nombre de
 *     la vendedora, y por eso «con tu nombre» se cumple sin tocar el dominio.
 *   · **SES no verifica el `Reply-To`.** Ésa es la rendija por la que entra D2.
 *
 * De ahí sale la forma del sobre: **el `From` dice quién escribe pero sale por un
 * buzón verificado; el `Reply-To` dice a dónde va la respuesta.**
 *
 * ⚠️ Acá no se resuelve el nombre corto de la vendedora ni se lee la tabla de
 * remitentes: las dos cosas entran como argumento. Quien llama es el que ya tiene
 * la fila y el nombre.
 */

/** Una fila de `remitentes_correo`, en la forma que este módulo necesita. */
export interface Remitente {
  id: number;
  direccion: string;
  nombre: string;
  responderA: string | null;
  firma: string | null;
}

/** Las dos cabeceras que este módulo decide. El resto del sobre no es asunto suyo. */
export interface SobreDeCorreo {
  from: string;
  replyTo: string | null;
}

/**
 * El separador entre el nombre de quien escribe y el del buzón por el que sale.
 *
 * Es el mismo punto medio que el resto de la app usa para encadenar dos hechos
 * («82 · de 3.051», «Aprobado · ana»): quien recibe lee «Luz» primero y «Escuela
 * Goberna» como el lugar del que viene, que es exactamente la jerarquía que
 * queremos. No es ASCII, y no hace falta que lo sea: la codificación MIME de la
 * cabecera la hace nodemailer.
 */
const SEPARADOR_NOMBRES = ' · ';

/**
 * El separador de firma de RFC 3676 §4.3: dos guiones, un espacio, fin de línea.
 *
 * ⚠️ **El espacio del final es load-bearing.** Con él, los clientes de correo
 * (Gmail, Outlook, Apple Mail) colapsan la firma y no la citan al responder; sin
 * él es una línea de texto más y la firma se acumula en cada ida y vuelta hasta
 * que el hilo es 80 % firma. Vive dentro de las comillas y no al final de un
 * renglón **a propósito**: así ningún formateador que recorte espacios de fin de
 * línea se lo puede comer sin que se note.
 */
const SEPARADOR_FIRMA = '-- ';

/**
 * Todo lo que un cliente de texto puede leer como «acá empieza otra línea».
 *
 * 🔴 **Los que INYECTAN son `\r` y `\n`, y nada más.** Una cabecera SMTP termina
 * en CRLF: un retorno de carro adentro del asunto o del display name cierra la
 * cabecera y **lo que sigue se manda como una cabecera nueva**. O sea que quien
 * escribe el correo puede agregarse un `Bcc:` desde la caja de asunto de la
 * pantalla y mandarle el correo a quien quiera, sin tocar la API y sin dejar
 * rastro en `correos`. Es el único agujero de este frente que se explota desde la
 * pantalla.
 *
 * ⚠️ Los otros cuatro —NEL, tabulación vertical, form feed y los separadores de
 * línea de Unicode (U+2028/U+2029)— **no pueden inyectar nada**: en UTF-8 no
 * contienen el byte 0x0D ni el 0x0A, así que SMTP los ve como texto. Se limpian
 * igual, y el motivo es que la regla sea UNA y no tenga excepciones que alguien
 * tenga que recordar: *una cabecera es una línea*. Un U+2028 en el display name
 * se dibuja como un salto en varios clientes, y un remitente que aparece partido
 * en dos renglones se lee como un correo mal armado.
 *
 * Y no se delega en la librería: el módulo hermano (`destinatario.ts`) existe
 * justo porque se VERIFICÓ que nodemailer no protege lo que uno supone que
 * protege — parte `a@b.com, c@d.com` en dos destinatarios sin decir nada.
 */
// El linter avisa por los caracteres de control adentro de un regex, y acá son
// justamente el objeto del módulo: van con escape `\u` —nunca pegados en el
// fuente— para que se lean, y para que ningún editor ni formateador los pueda
// comer sin que la diferencia se vea en el diff.
// eslint-disable-next-line no-control-regex
const SALTOS = /[\r\n\u0085\u000b\u000c\u2028\u2029]+/g;

/**
 * La forma de un correo, deliberadamente angosta.
 *
 * **No es un validador de RFC 5322** y no quiere serlo: la pregunta que contesta
 * es «¿este `vendedora_id` de Cerberus es ADEMÁS un buzón?», y ante la duda tiene
 * que contestar que no. Fallar hacia el «no» es barato —se cae al `responder_a`
 * del remitente, que existe y alguien lee— y fallar hacia el «sí» pone una
 * dirección inventada en el `Reply-To`: la respuesta del lead rebota o se pierde,
 * y nadie se entera hasta que el lead se queja de que nunca le contestaron.
 *
 * Por eso el juego de caracteres del local part es el mínimo que cubre a las
 * nueve, y no el que RFC 5322 permite: así quedan afuera la coma, el punto y
 * coma, los dos puntos, los picos y el espacio — o sea, todo lo que convertiría
 * un `Reply-To` en dos.
 */
const FORMA_DE_CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/**
 * Deja una cadena en condiciones de ser una cabecera: una sola línea, sin bordes.
 *
 * Los saltos **se reemplazan por un espacio, no se borran**. Borrarlos pega las
 * palabras («Foro de Estado\n2026» → «Foro de Estado2026») y eso llega al lead
 * como un asunto mal escrito que nadie va a poder explicar mirando la pantalla,
 * porque en la pantalla se veía bien. Las corridas se colapsan en uno solo (por
 * eso el `+` del regex): un CRLF son dos caracteres y un doble Enter son cuatro,
 * y ninguno de los dos casos tiene por qué dejar un hueco.
 *
 * El `trim()` del final no es cosmético: un espacio al principio de un valor de
 * cabecera es *folding whitespace*, o sea que ahí lo que se pierde es un pedazo
 * del sentido, no un pixel.
 */
export function sinSaltos(s: string): string {
  return s.replace(SALTOS, ' ').trim();
}

/**
 * ¿El `vendedora_id` es además un buzón al que se le puede contestar?
 *
 * Hermes no tiene tabla de personas: el `vendedora_id` es el username de Cerberus
 * y es **texto libre**. En producción conviven las dos formas —`ventas10@…`,
 * `ventas11@…`, `ventas12@grupogoberna.com` son correos; `luz`, `alan`, `Sindy`,
 * `Usuario1` no lo son— y hay ids con prefijo de sistema (`centurion:algo`) que
 * no son ni una cosa ni la otra.
 *
 * Devuelve **la grafía que vino**, recortada pero sin bajar a minúsculas, por lo
 * mismo que el reparto guarda `Luz` tal cual: el local part de una dirección es
 * técnicamente sensible a mayúsculas, y reescribirlo sería decidir por el buzón
 * de otro. Quien tenga que COMPARAR dos direcciones normaliza los dos lados, como
 * hace el índice `remitentes_correo_direccion_uq` con `lower()`.
 */
export function correoDeVendedora(vendedoraId: string): string | null {
  const limpio = sinSaltos(vendedoraId);
  return FORMA_DE_CORREO.test(limpio) ? limpio : null;
}

/**
 * Mete una cadena en un *quoted-string* de RFC 5322 sin dejar por dónde escaparse.
 *
 * 🔴 **La barra invertida se escapa PRIMERO, y el orden no es un detalle de
 * estilo.** Adentro de las comillas dobles, `\` es el carácter de escape: un
 * nombre que termina en `\` —tan raro como querés, pero es un campo de texto que
 * llena una persona— convierte la comilla de cierre que ponemos nosotros en una
 * comilla literal, el display name se come el resto de la cabecera y la dirección
 * queda afuera del sobre. Si se escapara primero la comilla y después la barra,
 * la barra que agregamos para escapar la comilla se volvería a escapar y el
 * resultado sería otro texto.
 */
function entreComillas(texto: string): string {
  const escapado = texto.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escapado}"`;
}

/** Una dirección lista para una cabecera, o `null` si no quedó nada que poner. */
function direccionLimpia(crudo: string | null | undefined): string | null {
  if (typeof crudo !== 'string') return null;
  const limpio = sinSaltos(crudo);
  return limpio === '' ? null : limpio;
}

/**
 * El `From` y el `Reply-To` de un correo.
 *
 * ── El `From` ──
 * `"<nombre de la vendedora> · <nombre del remitente>" <direccion>`. La dirección
 * es SIEMPRE la del remitente dado de alta —o sea, un dominio verificado en SES,
 * que es lo que `correos/verificado.ts` chequea al DAR DE ALTA— y el nombre de la
 * vendedora viaja en el display name, que SES no verifica. Así «con tu nombre»
 * deja de ser una frase de la pantalla.
 *
 * ── El `Reply-To` (decisión D2 del dueño, 17-ago-2026) ──
 * **Le gana el correo de la vendedora que escribió**, y recién si su id no es un
 * buzón se cae al `responder_a` del remitente. El orden es ése y no el contrario
 * porque el `responder_a` es un buzón compartido: con él arriba, la respuesta de
 * un lead que Sindy trabajó hace tres días le llega a todo el mundo y a nadie en
 * particular, que es exactamente el agujero que este frente vino a tapar.
 *
 * ⚠️ Que el correo de la vendedora sea `@grupogoberna.com` —un dominio **no
 * verificado en SES**— no es un problema acá y sí lo sería en el `From`: SES
 * verifica de quién SALE, no a dónde se CONTESTA.
 *
 * ⚠️ Todo lo que entra pasa por `sinSaltos`, incluida la dirección del remitente:
 * viene de la base y la base la llenó un supervisor desde una pantalla. Es la
 * misma cabecera y cuesta una llamada.
 */
export function armarSobre(
  r: Remitente,
  vendedoraId: string,
  nombreVendedora: string,
): SobreDeCorreo {
  const direccion = sinSaltos(r.direccion);

  // Si alguna de las dos mitades no está, no se dibuja el separador huérfano:
  // « · Escuela Goberna» se lee como un dato roto, y lo que falta acá es un
  // nombre, no la posibilidad de mandar el correo.
  const partes = [sinSaltos(nombreVendedora), sinSaltos(r.nombre)].filter((p) => p !== '');

  // Sin ninguna de las dos, la dirección sale sola y sin picos: un display name
  // vacío entre comillas (`"" <a@b>`) es válido y se ve como un error del sistema.
  const from =
    partes.length === 0 ? direccion : `${entreComillas(partes.join(SEPARADOR_NOMBRES))} <${direccion}>`;

  return {
    from,
    replyTo: correoDeVendedora(vendedoraId) ?? direccionLimpia(r.responderA),
  };
}

/**
 * El cuerpo con la firma pegada abajo, o el cuerpo tal cual.
 *
 * **Sin firma no se toca nada.** Ni el separador ni un renglón de más: un `-- `
 * colgado al final de un correo sin firma es una firma vacía, y se ve como si
 * algo hubiera fallado. Una firma en blanco («   ») tampoco es una firma — la
 * columna `firma` es opcional y un supervisor puede haber apretado espacio.
 *
 * ⚠️ Con firma, el cuerpo se recorta por el final antes de pegarla: el renglón en
 * blanco que separa las dos cosas tiene que ser **exactamente uno**, y quien
 * escribe siempre deja uno o tres Enter de más. Al revés —sin recortar— el cuerpo
 * sin firma cambiaría de forma, y por eso ese caso devuelve el original intacto.
 */
export function componerCuerpo(cuerpo: string, firma: string | null): string {
  const firmaLimpia = (firma ?? '').trim();
  if (firmaLimpia === '') return cuerpo;
  return `${cuerpo.replace(/\s+$/, '')}\n\n${SEPARADOR_FIRMA}\n${firmaLimpia}`;
}
