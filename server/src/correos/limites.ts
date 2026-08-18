/**
 * CUÁNTO ENTRA EN UN CORREO — los dos topes, en un solo lugar.
 *
 * ══ POR QUÉ NO VIVEN ADENTRO DE LA RUTA ═════════════════════════════════════
 *
 * Porque el front tiene su propia copia de `TOPE_CUERPO`
 * (`src/features/correos/correos.ts`) para poder apagar el botón y **explicar
 * por qué** antes de mandar, y dos copias de un número necesitan algo que las
 * obligue a seguir diciendo lo mismo (#37). Ese candado es
 * `limites.paridad.test.ts`, y sólo puede existir si el número se puede importar
 * sin levantar la base: `routes/correos.ts` importa `db/client.js`, que **tira al
 * importarse** sin `DATABASE_URL`, así que un test puro no podría leerlo de ahí.
 *
 * 🔴 **El defecto que el candado evita ya ocurrió, con este mismo patrón**: al
 * subir el tope de las notas de 2.000 a 20.000 (ADR 0047) el server cambió y el
 * front siguió diciendo 2.000. Lo que produce no es una rotura sino algo peor de
 * encontrar — la pantalla deja escribir de más, el server rechaza, y el aviso
 * explica el tope **con un número que no rige en ningún lado**. El mensaje SUENA
 * correcto, así que nadie lo reporta.
 *
 * ══ POR QUÉ 20.000 Y NO OTRO NÚMERO ═════════════════════════════════════════
 *
 * Es el mismo tope que una página de la Libreta (`notas/notas.ts#LIMITE_TEXTO`),
 * y se eligió igual a propósito: el material largo que el equipo manda por correo
 * es el mismo que pega en una página —el playbook real son 5.267 caracteres— y
 * dos topes distintos para «un texto largo que escribe una vendedora» obligan a
 * recordar cuál rige dónde. **No se importa de `notas.ts`**: son dos decisiones
 * que hoy coinciden, no una sola — el día que un correo tenga que ser más corto
 * que una página, esto se toca sin tocar la Libreta.
 */

/**
 * EL ASUNTO ES UNA CABECERA, Y UNA CABECERA ES UNA LÍNEA.
 *
 * 🔴 **Pasarse NO se recorta en silencio, se rechaza.** Recortar es lo que hacía
 * la versión vieja (`String(asunto).slice(0, 200)`) y es la peor de las dos
 * salidas: al lead le llega un asunto cortado a la mitad de una palabra, en la
 * pantalla se ve entero, y no hay forma de que nadie ate una cosa con la otra.
 * Es el criterio de `RECORTE_MAX` en el padrón —«nunca recorta en silencio»— y el
 * de `atribucion/llave.ts`, que ante una llave que no entra cae a la vieja pero
 * **nunca la trunca**.
 *
 * 200 es holgado: los clientes de correo muestran entre 60 y 80 caracteres, y
 * varios servidores empiezan a plegar la cabecera cerca de los 78. Lo que este
 * tope frena no es un asunto largo, es un cuerpo pegado en la caja equivocada.
 */
export const TOPE_ASUNTO = 200;

/**
 * EL CUERPO.
 *
 * ⚠️ **Se cuenta la cadena CRUDA, sin recortar los bordes**, y el front cuenta
 * exactamente lo mismo (`campos.cuerpo.length`, sin `trim`). Si uno contara los
 * espacios del final y el otro no, el borde exacto sería distinto de cada lado y
 * volveríamos a tener dos criterios para el mismo número — que es el defecto que
 * este archivo existe para cerrar, entrando por la otra puerta.
 *
 * ⚠️ Se escribe con el separador `_` a propósito: es lo que el regex del candado
 * espera (`[\d_]+`), igual que `LIMITE_TEXTO`.
 */
export const TOPE_CUERPO = 20_000;
