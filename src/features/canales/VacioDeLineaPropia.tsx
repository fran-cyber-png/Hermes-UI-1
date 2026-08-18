/**
 * EL VACÍO DE QUIEN TRAJO SU PROPIA LÍNEA — «no es que se hayan perdido».
 *
 * ══ 🔴 POR QUÉ NO ALCANZA EL VACÍO DE SIEMPRE ════════════════════════════════
 *
 * Desde el 18-ago-2026, quien vinculó su número por QR ve **su línea entera más
 * lo que le asignen en las otras**, y nada del archivo de las líneas sin dueña.
 * Medido ese día contra producción: las dos personas que hoy están en ese caso
 * **no tienen una sola fila en `conversacion_asignada`** —el dueño reparte a
 * mano, nadie las agregó a la rueda—, así que el primer día pueden abrir la cola
 * y ver casi nada.
 *
 * El texto de siempre («Nada nuevo en esta bandeja») ahí es **falso**: sí entró
 * trabajo, no es suyo. Y un vacío sin motivo en este repo ya se sabe cómo se
 * lee: «se perdieron las conversaciones», que es el síntoma exacto contra el que
 * se escribieron `sinLineasPropias`, `sinPadron` y `soloMisAsignadas` (ADR 0036).
 * Este texto dice las dos fuentes de su cola, para que el vacío se pueda
 * interpretar sin preguntarle a nadie.
 *
 * ⚠️ **No afirma cuántas le asignaron**, y no es timidez: el front no tiene ese
 * número —la bandera dice «tenés línea propia», no «tenés cero asignadas»— y una
 * pantalla que afirme un conteo que no midió es la forma más barata de mentir.
 * Por eso se dice en condicional («si está vacío es porque…»), que además sigue
 * siendo cierto el día que sí tenga asignadas y las despache.
 *
 * ⚠️ **Vive en un componente propio para que la galería muestre ESTE texto** y no
 * una copia: `/galeria-cola-recortada.html`. Una galería que reescribe el copy de
 * la app deja de ser evidencia en cuanto alguien mejora uno de los dos (#37).
 *
 * **Sin oro**: acá no corre ningún plazo (`src/index.css`).
 */
export function VacioDeLineaPropia() {
  return (
    <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
      Acá ves <strong className="font-bold text-foreground">tu línea entera</strong> más las
      conversaciones que te asignen en las otras. Si está vacío es porque por tu línea no entró nada
      en los últimos 30 días y todavía no te asignaron ninguna — no es que se hayan perdido.
    </p>
  );
}
