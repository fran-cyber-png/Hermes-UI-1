/**
 * POR QUÉ NO SALIÓ UN CORREO — y cuánto de eso puede ver quien lo mandó.
 *
 * ══ EL DEFECTO QUE ESTE MÓDULO EXISTE PARA TAPAR ═══════════════════════════
 *
 * El 502 contestaba `porQueFallo(err)` **tal cual** al navegador, y ese mismo
 * texto quedaba en `correos.motivo`. Para el caso normal está bien y es lo
 * valioso: cuando SES rechaza un destinatario, su mensaje dice exactamente qué
 * pasa y **es lo único que le sirve a la vendedora** — aplanarlo a «no se pudo
 * enviar» le saca la única pista que tenía.
 *
 * El problema es que no todos los fallos son ése. Cuando lo que falla es
 * NUESTRO lado —la credencial vencida, el host mal escrito, el puerto cerrado—
 * el error de nodemailer trae adentro el diálogo SMTP: el host, el usuario y el
 * comando que se estaba ejecutando. Eso no es información de la vendedora, no
 * puede hacer nada con ella, y sale por una respuesta HTTP hacia el navegador de
 * las nueve. Es la misma cicatriz que este repo ya midió una vez: **20 sitios
 * devolvían `(err as Error).message`, o sea el SQL de la consulta, al cliente.**
 *
 * ⚠️ Y hay un daño que no es de seguridad y duele igual: un fallo de credencial
 * se lee como si el problema fuera el destinatario. La vendedora corrige la
 * dirección, vuelve a mandar, vuelve a fallar, y llega a «Hermes no anda» tres
 * intentos después — cuando lo que había que hacer era avisarle a sistemas en el
 * primero.
 *
 * ══ LA REGLA ══════════════════════════════════════════════════════════════
 *
 * **Se muestra lo que habla del MENSAJE; se calla lo que habla de la MÁQUINA.**
 * Las tres clases no son grados de gravedad: son **de quién es el problema**, y
 * por eso cada una manda a hacer una cosa distinta.
 *
 * Es puro a propósito: se puede interrogar sobre un error de SES sin levantar un
 * SMTP, que es la única forma de escribir el test del caso que no se puede
 * reproducir a mano (la credencial vencida).
 */

/** De quién es el problema. Lo que decide qué se muestra y qué se hace. */
export type ClaseDeRechazo =
  /** Del MENSAJE o del destinatario: la dirección no existe, el buzón está lleno, lo marcaron spam. Lo arregla quien escribe. */
  | 'mensaje'
  /** De NUESTRA configuración: credencial, remitente sin verificar, host. Lo arregla sistemas; reintentar no sirve. */
  | 'configuracion'
  /** Del canal: no se pudo llegar a SES. Nadie lo arregla, pasa solo. Reintentar SÍ sirve. */
  | 'canal';

export interface Rechazo {
  clase: ClaseDeRechazo;
  /** Lo que se le contesta a quien mandó el correo. Nunca el volcado crudo. */
  mensaje: string;
  /** ¿Tiene sentido volver a apretar Enviar? */
  reintentable: boolean;
}

/**
 * Los códigos SMTP y de red que delatan cada clase.
 *
 * ⚠️ Se mira **el texto del error**, no una propiedad tipada, porque nodemailer no
 * garantiza ninguna: `err.code` a veces es `'EAUTH'`, a veces `'EENVELOPE'` y a
 * veces no está. El texto siempre trae el diálogo SMTP, que es lo que se puede
 * leer con confianza.
 *
 * 🔴 **`554 ... is not verified` es NUESTRO problema, no del destinatario**, y es
 * el que más fácil se clasifica mal: el 554 es un rechazo de destinatario en casi
 * cualquier otro servidor, pero en SES con ese texto significa que **el `From` no
 * está verificado** — o sea, un remitente mal dado de alta. Medido el 17-ago-2026
 * mandando desde `prueba@gmail.com`: `554 Message rejected: Email address is not
 * verified. The following identities failed the check in region US-EAST-1`.
 * Mostrarlo como «revisá el destinatario» manda a corregir la caja que está bien.
 */
const CONFIGURACION = /\b(?:535|530|EAUTH|invalid login|authentication|not verified|not authorized|signature)\b/i;
const CANAL = /\b(?:ECONNECTION|ETIMEDOUT|ECONNRESET|ENOTFOUND|EDNS|ESOCKET|421|451|timed? ?out|socket)\b/i;

/**
 * Clasifica el fallo de un `sendMail` y decide qué se le dice a quien mandó.
 *
 * El orden de las preguntas es parte de la regla: **configuración primero**,
 * porque su marca (`not verified`) convive con un código —el 554— que en
 * cualquier otro contexto sería del destinatario. Al revés, ese caso se
 * clasificaría como «revisá la dirección» y la vendedora corregiría lo que no
 * está mal.
 *
 * ⚠️ **Lo que no matchea nada cae en `mensaje`, no en `configuracion`.** Es la
 * rama que MUESTRA el detalle, y esa asimetría es deliberada: el rechazo de un
 * destinatario es el caso abrumadoramente más común y su texto es lo único útil
 * que hay. Un error desconocido que resulte ser nuestro se ve feo en pantalla
 * una vez; uno que se calle deja a la vendedora sin ninguna pista, siempre.
 *
 * @param crudo El texto del error, ya normalizado por `porQueFallo`.
 */
export function clasificarRechazo(crudo: string): Rechazo {
  const texto = (crudo ?? '').trim();

  if (CONFIGURACION.test(texto)) {
    return {
      clase: 'configuracion',
      // 🔴 El detalle NO viaja: es el diálogo SMTP con el host y el usuario adentro.
      // Queda entero en el log del server, que es donde sistemas lo puede buscar.
      mensaje:
        'El canal de correo está mal configurado y el mensaje no salió. No es la dirección ' +
        'del destinatario: avisale a sistemas. Volver a intentar no va a cambiar nada.',
      reintentable: false,
    };
  }

  if (CANAL.test(texto)) {
    return {
      clase: 'canal',
      mensaje: 'No se pudo llegar al servidor de correo. El mensaje no salió — probá de nuevo en un momento.',
      reintentable: true,
    };
  }

  return {
    clase: 'mensaje',
    // Acá SÍ va el detalle, y es lo único que este módulo deja pasar: es lo que
    // explica por qué a ESA dirección no le llegó, y sin eso el 502 no dice nada
    // que la vendedora pueda usar.
    mensaje: texto === '' ? 'El correo no salió y el servidor no dijo por qué.' : `El correo no salió: ${texto}`,
    reintentable: false,
  };
}
