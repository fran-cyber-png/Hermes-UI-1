/**
 * EL NOMBRE QUE EL LEAD VE EN EL `From` — y es una SEGUNDA COPIA, escrita a
 * sabiendas.
 *
 * ══ 🔴 ESTA REGLA YA VIVE EN EL FRONT, Y ESO ES EL PROBLEMA, NO EL DESCUIDO ══
 *
 * La original es `nombreCorto` en **`src/dominio/dueno.ts`**: la función con la
 * que la cola rotula al dueño de una conversación («Sindy» sobre la fila de un
 * chat ajeno). Acá hace falta la misma respuesta porque el `From` de un correo
 * se arma en el SERVER (`armarSobre`) y el server **no puede importar `src/`**:
 * son dos tsconfig, dos builds y dos deploys (N4 el front, N5 el server).
 *
 * Escribirla de nuevo tiene un costo concreto y hay que nombrarlo: el mismo
 * `vendedora_id` podría leerse «Ventas10» en la fila de la cola y «ventas10» en
 * el sobre del correo, **sobre el mismo humano y en la misma pantalla** — porque
 * `resumenDelSobre` del front dibuja el sobre con la versión de allá y la ruta
 * manda el de acá. Eso no rompe nada, no tira ningún error, y se descubre cuando
 * un lead pregunta por qué le escriben dos personas distintas.
 *
 * Por eso hay un candado y no un comentario: **`nombreVendedora.paridad.test.ts`
 * lee el archivo del front** y cruza las dos funciones sobre los ids reales del
 * equipo. Si alguien le agrega un separador a una, la otra se pone roja. Es el
 * molde de `limiteTexto.paridad.test.ts` y de `limitesMedia.paridad.test.ts`.
 *
 * ⚠️ **Se llama `nombreCortoDeVendedora` y no `nombreCorto` a propósito**: en el
 * server `nombreCorto` ya significa otra cosa —el nombre de un curso sin su
 * número de edición, `plantillas/familias.ts`— y dos funciones con el mismo
 * nombre para dos preguntas distintas es cómo se importa la equivocada sin que
 * el compilador diga nada.
 */

/**
 * Los separadores que cortan un `vendedora_id` en su primera palabra.
 *
 * ⚠️ **Esta lista es el contrato con el front**, no una elección de este archivo:
 * el candado la extrae del `split(/…/)` de `dueno.ts` y la compara. Agregar uno
 * acá sin agregarlo allá (o al revés) es exactamente la divergencia que el test
 * existe para atrapar.
 *
 * Los dos puntos NO están, y eso importa: hay ids con prefijo de sistema
 * (`centurion:algo`) que quedan enteros a propósito — no son personas, y
 * mostrarlos partidos («Centurion») los haría parecer una.
 */
const SEPARADORES = /[.\-_@\s]/;

/**
 * El nombre corto de quien escribe, para el display name del `From`.
 *
 * El `vendedora_id` es el username de Cerberus y es **texto libre**: en producción
 * conviven `luz`, `Sindy`, `Usuario1`, `alan` y `ventas10@grupogoberna.com`. Se
 * corta en el primer separador y se capitaliza — en un `From` entra un nombre, no
 * una dirección de trabajo.
 *
 * 🔴 **No inventa un nombre propio.** Un username sin forma de nombre (`srojas`)
 * se muestra tal cual capitalizado: preferimos un rótulo feo y cierto a uno lindo
 * y adivinado, porque esto es lo que ve una persona de afuera en el remitente de
 * un correo — un nombre inventado ahí no es un detalle de UI, es una identidad
 * falsa.
 *
 * ⚠️ **Un id que queda vacío devuelve la cadena vacía, nunca un placeholder.**
 * `armarSobre` filtra las mitades vacías del display name y, si no queda ninguna,
 * manda la dirección sola: un `"" <a@b>` o un `"(sin nombre) · Escuela Goberna"`
 * se leen como un error del sistema justo en el renglón que el lead mira primero.
 */
export function nombreCortoDeVendedora(vendedoraId: string): string {
  const base = vendedoraId.trim().split(SEPARADORES)[0] ?? "";
  if (!base) return vendedoraId.trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}
