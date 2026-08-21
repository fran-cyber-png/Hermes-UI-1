/**
 * EL RÓTULO DEL NÚMERO DE LA COLA — «N en cola» vs. «N para vos».
 *
 * ══ 🔴 POR QUÉ EXISTE: EL RECORTE ERA MUDO ═══════════════════════════════════
 *
 * Desde que la frontera es propiedad del rol, una vendedora ve **lo suyo más lo
 * huérfano de sus líneas** y el trabajo repartido a otra persona no le viaja. Eso
 * le cambia el número de la cabecera de un día para el otro: en la medición del
 * plan (15-ago-2026), `luz` pasa de 5.494 a ~2.400 y `sindy` a 192.
 *
 * Hasta hoy la cabecera decía «N en cola» para todo el mundo, así que ese salto
 * se leía sin una sola palabra que lo explicara — y el síntoma que produce está
 * medido en este repo más de una vez: se lee «la app perdió mis conversaciones»,
 * no «esto es lo mío». Es el mismo motivo por el que existen `sinLineasPropias`,
 * `sinAsignacion` y `sinPadron`: un recorte que no se anuncia se ve idéntico a
 * una pérdida de datos.
 *
 * ══ POR QUÉ VA ACÁ Y NO EN UN CARTEL APARTE ══════════════════════════════════
 *
 * El recorte no es una degradación: es cómo funciona la cola todos los días. Un
 * banner permanente arriba de la lista sería letra fija que se aprende a no leer,
 * y encima le come alto a la mesa de trabajo. Lo que cambió es **el número**, así
 * que la explicación va pegada al número. El precedente es de esta misma
 * pantalla: cuando se retiró la píldora «Vos» de cada fila, lo que quedó diciendo
 * «esta cola ya es la tuya» fue justamente este rótulo.
 *
 * ══ ⚠️ SE LEE OPCIONAL, Y AUSENTE NO ES «NO HAY RECORTE» ═════════════════════
 *
 * `recortada` llega del server (`colaRecortada`) y puede **no venir**: un server
 * viejo no lo manda, y una página rehidratada del caché de IndexedDB (ADR 0007)
 * tampoco. En los dos casos no se afirma nada y se dice «en cola», que es el
 * rótulo de siempre. Nunca al revés: un default que afirmara el recorte le
 * pondría «para vos» a una cola que trae el trabajo de todas.
 *
 * **Sin oro**: en este repo el dorado significa tiempo que se acaba y nada más
 * (`src/index.css`). Acá no corre ningún plazo.
 *
 * ⚠️ **`toLocaleString('es')` NO agrupa cuatro dígitos**: 5494 sale `5494` y no
 * `5.494`, porque el CLDR del español pide cinco (`minimumGroupingDigits: 2`).
 * Verificado en el navegador y en el test, no deducido. Es el comportamiento que
 * la cabecera ya tenía; se anota acá porque la primera versión del test lo dio
 * por sentado al revés y falló por eso.
 *
 * ══ 🔴 QUIEN TRAJO SU PROPIA LÍNEA NECESITA OTRA EXPLICACIÓN ════════════════
 *
 * Desde el 18-ago-2026 quien vinculó su número por QR ve **su línea entera más
 * lo que le asignaron en las otras**, y se le cae la rama de «lo que todavía no
 * tiene dueña» (`cola/asignadaSql.ts` §RAMA_LINEA_SIN_DUENA). O sea que la frase
 * de siempre —«lo que te tocó a vos y lo que todavía no tiene dueña»— le
 * explicaría su número con **justo lo único que ya no ve**: una explicación
 * falsa es peor que ninguna, porque cierra la pregunta con la respuesta
 * equivocada y nadie vuelve a mirar. Por eso hay dos textos y no uno con un
 * agregado.
 *
 * ⚠️ **Lo que NO cambia es la palabra visible**: sigue diciendo «para vos»,
 * porque sigue siendo cierto y porque el rótulo se lee de reojo — dos etiquetas
 * distintas para el mismo hecho («para vos» / «tu línea») harían que la de al
 * lado parezca otra cosa. Lo que cambia es el porqué, y el porqué vive en el
 * `title`.
 *
 * ⚠️ **`lineaPropia` sin `recortada` no dice nada**: si el server no anunció el
 * recorte, el número es el de siempre y no hay nada que explicar. Se lee como el
 * resto de este componente — ausente es «no se sabe», nunca un default que
 * afirme.
 *
 * Galería: `npx vite --port 5199` → `/galeria-cola-recortada.html`.
 * Captura: `docs/evidencia/cola-linea-propia-rotulo.png` (los cuatro casos, con
 * el texto del `title` impreso al lado: en una captura ese atributo no se ve).
 */

import { explicacionDelRotulo } from './explicacionDeLaCola';

export function RotuloDeLaCola({
  total,
  recortada,
  lineaPropia,
}: {
  total: number;
  recortada?: boolean;
  lineaPropia?: boolean;
}) {
  return (
    <span
      title={explicacionDelRotulo(recortada, lineaPropia)}
      className="shrink-0 whitespace-nowrap pr-1 font-mono text-[11px] tabular-nums text-muted-foreground"
    >
      {total.toLocaleString('es')} {recortada ? 'para vos' : 'en cola'}
    </span>
  );
}
