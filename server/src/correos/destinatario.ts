/**
 * UN CORREO VA A UNA PERSONA — y eso tiene que ser una propiedad del código.
 *
 * ══ EL DEFECTO QUE ESTE MÓDULO EXISTE PARA TAPAR ════════════════════════════
 *
 * La pantalla de Correos dice «nada masivo» y hasta hoy eso no lo garantizaba
 * nadie: la ruta validaba el destinatario con `/.+@.+\..+/`, que a la cadena
 * `"a@b.com, c@d.com"` la da por buena — hay algo, hay arroba, hay punto. Lo
 * que sigue no es un error: **nodemailer PARTE esa cadena en DOS
 * destinatarios** y los dos reciben el mensaje.
 *
 * Medido contra el `addressparser` de la versión instalada (nodemailer 9.0.3),
 * que es el que corre en producción:
 *
 *   "a@b.com, c@d.com"          → [a@b.com] [c@d.com]   ← DOS envíos
 *   "a@b.com,c@d.com"           → [a@b.com] [c@d.com]   ← DOS envíos
 *   "a@b.com; c@d.com"          → [a@b.com] [c@d.com]   ← el `;` también parte
 *   "X <a@b.com>, Y <c@d.com>"  → [a@b.com] [c@d.com]   ← DOS envíos
 *   "a@b.com c@d.com"           → [a@b.com] con nombre "c@d.com"  ← se PIERDE uno
 *   "pepe"                      → dirección VACÍA con nombre "pepe"
 *   "a@b.com\nBcc: otro@mal.com" → un GRUPO con otro@mal.com adentro
 *
 * O sea: con el regex viejo, escribir una lista separada por comas en la caja
 * de «Para» era una campaña. Sin tope, sin ritmo, sin auditoría de a quiénes
 * les llegó —la tabla `correos` guarda **una** fila con la cadena entera— y sin
 * un solo error en pantalla. **Una frase de la UI no es un candado; esto sí.**
 *
 * ══ POR QUÉ NO SE USA UNA LIBRERÍA DE VALIDACIÓN ════════════════════════════
 *
 * Porque la pregunta no es «¿cumple el RFC 5322?» sino «¿es UNO SOLO y no trae
 * cabeceras?». Un validador estricto rechaza direcciones válidas de gente real
 * (locales con `+`, con acentos, dominios largos) y encima **acepta** formas de
 * varias direcciones que el RFC contempla. Acá conviene lo contrario: laxo con
 * lo raro pero **cerrado con lo múltiple**. Lo que sea una dirección de verdad
 * lo decide SES cuando la rechaza; lo que este módulo no puede dejar pasar es
 * que salgan dos mensajes donde la vendedora quiso mandar uno.
 *
 * ══ LOS CUATRO MOTIVOS SON LO QUE VE LA PERSONA ═════════════════════════════
 *
 * No se colapsan en un `false`: la lectura tiene que decirle qué corregir. Y no
 * se cambian de lugar por gusto — decirle «pusiste varios» a quien escribió
 * `X <a@b.com>` la manda a buscar una coma que no existe.
 */

/** Por qué no se puede mandar. Lista cerrada: cada motivo tiene su lectura en la pantalla. */
export type MotivoDestinatario =
  /** No escribió nada (o sólo espacios). */
  | "vacio"
  /** Hay más de un destinatario. Es el caso que da nombre al módulo. */
  | "varios"
  /** No se lee como UNA dirección: sin arroba, sin dominio con punto, con picos o con espacios. */
  | "forma"
  /** Trae un retorno o un salto de línea: eso es una cabecera nueva, no una dirección. */
  | "salto_de_linea";

export type LecturaDestinatario =
  | { ok: true; direccion: string }
  | { ok: false; motivo: MotivoDestinatario };

/**
 * Los separadores que **nodemailer honra**, verificados uno por uno arriba.
 *
 * ⚠️ Esta lista no se deduce de la intuición ni del RFC: se mide contra el
 * parser instalado. El día que se actualice nodemailer, lo que hay que volver a
 * correr es esa medición — un separador nuevo que él entienda y esta lista no
 * tenga es, otra vez, dos mensajes donde había uno.
 */
const SEPARADORES = /[,;]/;

/**
 * Un retorno o un salto de línea, sobre el crudo y **antes de recortar**.
 *
 * 🔴 Se mira el crudo entero, incluidos los bordes, y eso es a propósito: en una
 * cabecera de correo el valor **termina** en el CRLF, así que distinguir «un
 * salto al final, inofensivo» de «un salto en el medio, que abre un `Bcc:`»
 * obliga a interpretar qué viene después — que es exactamente el trabajo que la
 * inyección de cabeceras necesita que alguien haga mal. Un `.trim()` primero se
 * come el salto del final y deja la regla con una excepción justo donde vive el
 * agujero.
 */
const SALTOS = /[\r\n]/;

/**
 * Los caracteres que hacen que la cadena se lea **de más de una manera**.
 *
 * 🔴 **NO ALCANZA CON PROHIBIR LOS SEPARADORES: hay caracteres que no parten la
 * cadena en dos, la REESCRIBEN.** Medido contra el `addressparser` de la
 * nodemailer instalada (9.0.3), que es la que manda en producción:
 *
 *   "a(b)c@goberna.us"      → address: **"ac@goberna.us"**, name: "b"
 *   "equipo:ana@goberna.us" → un GRUPO de RFC 5322; sale hacia "ana@goberna.us"
 *   "\"x\"@goberna.us"      → address: "x@goberna.us"
 *
 * O sea que el paréntesis es un COMENTARIO de RFC 5322 y los dos puntos abren un
 * grupo: la vendedora escribe una dirección, la fila de `correos` guarda **esa**,
 * y el mensaje sale hacia **otra**. Es el peor de los dos daños posibles —peor
 * que no mandar nada— y es exactamente la regla que la campaña de WhatsApp ya
 * tuvo que aprender: *un destinatario mal leído no cuesta un mensaje, le llega a
 * otra persona*. La auditoría queda mintiendo y no hay error que lo delate.
 *
 * ⚠️ Se prohíben por CARÁCTER y no por «forma sospechosa»: la lista de lo que el
 * parser reinterpreta se mide, no se intuye — igual que `SEPARADORES`.
 */
const REESCRIBEN = ':()"\\\\[\\]';

/**
 * UNA dirección y nada más: un local sin espacios, sin separadores, sin picos y
 * sin nada de `REESCRIBEN`; una arroba; y un dominio de al menos dos etiquetas.
 *
 * ⚠️ El local sigue siendo **permisivo** dentro de eso (entran `+`, `.`, `_`,
 * apóstrofes y acentos): la gente real tiene esas direcciones y rechazarlas sería
 * inventar una regla que ni SES aplica. Lo que no entra es lo que le permite a la
 * cadena leerse de más de una manera — ni partiéndose (`SEPARADORES`) ni
 * reescribiéndose (`REESCRIBEN`).
 *
 * El dominio pide un punto porque `a@b` es una dirección que nodemailer acepta
 * y SES contesta con un 554: preferimos el «revisá el destinatario» de la
 * pantalla al rebote de media hora después, que nadie mira.
 */
const UNA_DIRECCION = new RegExp(
  `^[^\\s@,;<>${REESCRIBEN}]+@[^\\s@,;<>.${REESCRIBEN}]+(?:\\.[^\\s@,;<>.${REESCRIBEN}]+)+$`,
);

/**
 * Lee la caja de «Para» y devuelve **una** dirección, o el motivo por el que no.
 *
 * El orden de las preguntas es parte del contrato:
 *
 * 1. **vacío** primero, porque `"   \n  "` es «no escribiste nada», no una
 *    inyección: acusar de un salto de línea a quien no escribió nada es ruido.
 * 2. **salto de línea** antes que todo lo demás: es el único motivo que
 *    describe un ataque y no un dedazo, y quien lo tenga tiene que leer eso.
 * 3. **varios** antes que **forma**, porque una coma es la señal más clara que
 *    hay de que la persona quiso mandarle a más de uno — y ése es el caso que
 *    este módulo existe para frenar.
 * 4. **forma** al final: el cajón de lo que no se lee como una sola dirección.
 *
 * ⚠️ **La dirección NO se pasa a minúsculas.** Se recorta y nada más. El
 * local-part es case-sensitive según el RFC 5321 §2.4 y hay buzones que lo
 * respetan, así que normalizar sería reescribir el dato de la vendedora para
 * que nos quede cómodo — y el destinatario equivocado no rebota: le llega a
 * otra casilla o a ninguna. Donde sí se normaliza es al comparar remitentes
 * (`remitentes_correo_direccion_uq` va sobre `lower(direccion)`), que es otra
 * pregunta: ahí se decide si dos filas son el mismo buzón NUESTRO.
 */
export function leerDestinatario(crudo: string): LecturaDestinatario {
  // Se acepta `unknown` en la práctica: el body de un POST puede traer un número
  // o un objeto, y ahí «no es una cadena» es «no escribió una dirección».
  if (typeof crudo !== "string") return { ok: false, motivo: "vacio" };

  const direccion = crudo.trim();
  if (direccion === "") return { ok: false, motivo: "vacio" };

  if (SALTOS.test(crudo)) return { ok: false, motivo: "salto_de_linea" };
  if (SEPARADORES.test(direccion)) return { ok: false, motivo: "varios" };
  if (!UNA_DIRECCION.test(direccion)) return { ok: false, motivo: "forma" };

  return { ok: true, direccion };
}
