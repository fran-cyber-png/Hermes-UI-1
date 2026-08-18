/**
 * EL RITMO DE CORREOS — cuántos puede mandar una vendedora, y por qué existe.
 *
 * ══ QUÉ PROBLEMA RESUELVE ════════════════════════════════════════════════
 *
 * 🔴 **«Nada masivo» es una frase de la pantalla hasta que hay un techo.** Este
 * frente tiene dos candados y son distintos: `destinatario.ts` garantiza que un
 * envío es a UNA persona (que nadie pegue `a@b.com, c@d.com` y salgan dos), y
 * éste garantiza el VOLUMEN. Sin el segundo, mil correos de a uno siguen siendo
 * una campaña —escrita a mano, pero campaña— y la tabla `correos` la audita
 * DESPUÉS, cuando ya salieron. Un techo convierte la promesa en una propiedad
 * del código: aunque alguien automatice el POST, a los 20 de la hora se frena.
 *
 * ⚠️ **Y NO es anti-ban.** Esto es SES, no WhatsApp: SES no banea por ritmo, cobra
 * y tiene su propia cuota. Lo que un envío en masa quema es la **reputación del
 * dominio**, que es de las nueve, y lo que rompe es la política: un correo es una
 * acción humana. Copiar el vocabulario de WhatsApp sin decir esto haría que
 * alguien «suba el techo porque acá no hay ban», que es exactamente al revés.
 *
 * ══ POR QUÉ ESTOS NÚMEROS Y NO OTROS ═════════════════════════════════════
 *
 * Son los MISMOS que el ritmo de WhatsApp (`autorespuesta/config.ts`:
 * `techoPorHora: 20`, `techoPorDia: 60`). Dos ritmos distintos en la misma app es
 * #37 con otra ropa: la vendedora aprendería un límite por canal, y el día que se
 * toque uno el otro queda viejo sin que nada se ponga rojo. `ritmo.test.ts` cruza
 * los dos.
 *
 * ⚠️ **El SUJETO sí cambia: acá es la VENDEDORA, en WhatsApp es la LÍNEA.** No es
 * un descuido. En WhatsApp cada línea es de alguien; acá el `From` es un puñado
 * de remitentes compartidos por todo el equipo, así que un techo por remitente no
 * acotaría a nadie — la primera que empiece a mandar se come el cupo de las otras
 * ocho, y la que quedó afuera no tendría cómo saber por qué.
 *
 * ══ POR QUÉ NO HAY RELOJ ACÁ ═════════════════════════════════════════════
 *
 * Los conteos llegan ya resueltos. Quién decide qué es «la última hora» es quien
 * cuenta las filas (el `WHERE` de la consulta sobre `correos`), y meter un `Date`
 * acá daría **dos definiciones de la misma ventana** —la del SQL y la de esta
 * función— que se pueden separar sin que nada falle: la pantalla diría «te quedan
 * 3» sobre una hora que empieza en otro minuto.
 */

/** Techo por hora, por vendedora. El mismo que WhatsApp usa por línea. */
export const TECHO_HORA = 20;

/** Techo por día, por vendedora. El mismo que WhatsApp usa por línea. */
export const TECHO_DIA = 60;

/** Cuántos correos ya salieron en cada ventana, para ESTA vendedora. */
export interface ConteosDeRitmo {
  ultimaHora: number;
  ultimoDia: number;
}

/**
 * El veredicto. Cuando frena lleva `techo` y `usado` **juntos**: un «alcanzaste el
 * límite» sin las dos cifras no se puede verificar ni explicar, y lo primero que
 * hace quien lo lee es volver a intentar.
 */
export type FrenoDeRitmo =
  | { frena: false }
  | { frena: true; motivo: 'techo_hora' | 'techo_dia'; techo: number; usado: number };

/**
 * ¿Se puede mandar uno más?
 *
 * 🔴 **EL MÁS CHICO GANA, y por eso la hora se pregunta PRIMERO.** Con 25 en la
 * hora y 70 en el día los dos techos están pasados; si contestara `techo_dia`, la
 * vendedora leería «60 por día» y se iría a esperar hasta mañana, cuando lo que
 * la destraba es el próximo cambio de hora. El motivo que se devuelve es el que
 * dice **cuándo se destraba**, no cualquiera de los dos que sea cierto.
 *
 * ⚠️ **Es `>=`, no `>`.** Con `>` el techo real serían 21 y 61: el que ya usó 20
 * mandaría uno más. Está fijado con un test porque es el error clásico de un
 * contador que empieza en cero.
 */
export function frenoDeRitmo(c: ConteosDeRitmo): FrenoDeRitmo {
  if (c.ultimaHora >= TECHO_HORA) {
    return { frena: true, motivo: 'techo_hora', techo: TECHO_HORA, usado: c.ultimaHora };
  }
  if (c.ultimoDia >= TECHO_DIA) {
    return { frena: true, motivo: 'techo_dia', techo: TECHO_DIA, usado: c.ultimoDia };
  }
  return { frena: false };
}
