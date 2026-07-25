/**
 * LA REGLA DURA #4, HECHA CÓDIGO — el texto que sale hacia Cerberus entra en latin1.
 *
 * ── Por qué existe ──
 * Cerberus guarda en MySQL con charset **latin1**. Un carácter fuera de ese
 * charset no se guarda mal: **revienta el INSERT**. Y el INSERT que revienta es
 * el de una venta, con el cliente esperando del otro lado.
 *
 * El enemigo son los **emojis**, no los acentos: latin1 cubre `á é í ó ú ñ ü ¿ ¡`
 * sin ningún problema. Un emoji no. Tampoco las comillas tipográficas, la raya o
 * los puntos suspensivos que Word y los teclados de celular meten solos.
 *
 * La regla estaba escrita en `CLAUDE.md` y en `docs/arquitectura.md` —que además
 * afirmaba «se sanitiza en el borde», en presente— pero **no existía en el
 * código** (auditoría del 24-jul, #108). Esto es esa promesa cumplida.
 *
 * ── Lo que NO hace ──
 * No inventa. Si el texto era solo emojis, devuelve la cadena vacía y quien llama
 * decide qué hacer con eso — misma doctrina que `lazo/normalizar.ts`.
 *
 * El contrapunto vive en `notas/notas.ts`: ahí los emojis **sí** pasan, porque una
 * nota personal nunca viaja a Cerberus. Los dos tests se nombran entre sí.
 */

/**
 * Lo que se puede traducir en vez de perder. Son los caracteres que un teclado de
 * celular o un copiar-pegar de Word meten sin que nadie los pida: borrarlos
 * mutila la frase («Pagó — falta cuota…» quedaría «Pagó  falta cuota»), y
 * traducirlos la conserva entera.
 *
 * Las claves van en `\u` a propósito: escritos como glifo, `‘ ’ ‚`
 * o los tres espacios finos son indistinguibles a ojo en un diff.
 *
 * Acá entra **solo** lo que latin1 NO tiene. `« » ¿ ¡ º ª` y el espacio duro
 * (U+00A0) sí están en latin1 y pasan intactos: traducirlos sería perder
 * información sin ninguna necesidad.
 */
const TRADUCCIONES: Record<string, string> = {
  '“': '"', // “ comilla doble izquierda
  '”': '"', // ” comilla doble derecha
  '„': '"', // „ comilla doble baja
  '‘': "'", // ‘ comilla simple izquierda
  '’': "'", // ’ el apóstrofo que Word pone en «d’Angelo»
  '‚': "'", // ‚ comilla simple baja
  '–': '-', // – semiraya
  '—': '-', // — raya
  '―': '-', // ― barra horizontal
  '…': '...', // … puntos suspensivos
  '•': '-', // • viñeta
  ' ': ' ', // espacio fino
  ' ': ' ', // espacio duro fino
  '​': '', // espacio de ancho cero: invisible, se va sin dejar rastro
  '€': 'EUR', // € no está en latin1 (sí en cp1252), y perderlo cambia un precio
};

/**
 * Deja el texto listo para el MySQL latin1 de Cerberus.
 *
 * El orden importa:
 *
 * 1. **NFC primero.** Es lo que hace verdadera la promesa «los acentos pasan»:
 *    una `ñ` puede llegar descompuesta como `n` + tilde combinante (U+0303), y
 *    esa tilde suelta NO es latin1. Sin este paso la borraríamos y «Muñoz»
 *    saldría «Munoz» — justo el daño que la regla dice evitar.
 * 2. Traducir lo traducible (arriba).
 * 3. Borrar lo que sigue afuera: todo code point > 0xFF —ahí caen los emojis— y
 *    los controles C0/C1, que tampoco sobreviven a un form-urlencoded.
 * 4. Colapsar los espacios que quedaron y recortar. Sin esto «Jhonatan 🍭» sale
 *    «Jhonatan » con la cola colgando.
 */
export function aLatin1(texto: string): string {
  let salida = '';

  for (const caracter of texto.normalize('NFC')) {
    const traducido = TRADUCCIONES[caracter];
    if (traducido !== undefined) {
      salida += traducido;
      continue;
    }
    const punto = caracter.codePointAt(0) ?? 0;
    // Fuera de latin1 (emojis y todo lo demás), o carácter de control.
    if (punto > 0xff || punto < 0x20 || (punto >= 0x7f && punto <= 0x9f)) continue;
    salida += caracter;
  }

  return salida.replace(/ {2,}/g, ' ').trim();
}

/**
 * El cuerpo de un POST a Cerberus, con TODOS sus valores ya saneados.
 *
 * Sanear campo por campo en el call-site es la trampa: el que agregue
 * `observacion` o `cliente_nombre` dentro de seis meses no se va a acordar, y el
 * fallo aparece recién con el primer emoji, en producción, durante una venta.
 * Sanear al armar el cuerpo hace que ese campo nuevo nazca cubierto.
 *
 * **Esto NO se usa para el login** (`auth.ts`): ver el porqué ahí mismo.
 */
export function cuerpoParaCerberus(campos: Record<string, string>): URLSearchParams {
  const cuerpo = new URLSearchParams();
  for (const [clave, valor] of Object.entries(campos)) {
    cuerpo.set(clave, aLatin1(valor));
  }
  return cuerpo;
}
