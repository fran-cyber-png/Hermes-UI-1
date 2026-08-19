/**
 * CADA CUÁNTO SE VUELVE A PEDIR EL HILO — y por qué el poll ya no es la fuente.
 *
 * ══ LO QUE ESTABA MAL, MEDIDO EN PRODUCCIÓN EL 19-AGO-2026 ═════════════════
 *
 * `useConversacionWa` pedía el hilo cada **5 s fijos** mientras hubiera una
 * conversación abierta. El 18-ago eso fueron **41.973 pedidos**, de los cuales
 * **41.429 (98,8 %) contestaron 304**. Y un 304 no es gratis: el ETag es el
 * hash del cuerpo, así que la consulta corre entera y recién al final se
 * descubre que no cambió nada.
 *
 * Peor: **19.234 de esos pedidos (46 %) son cinco conversaciones de líneas
 * apagadas con DIEZ mensajes entre todas**. El campeón, `989270836`, se pidió
 * **6.644 veces para un solo mensaje**, en una línea muerta hacía 28 días.
 *
 * ══ POR QUÉ SE PUEDE BAJAR: EL SSE ES LA FUENTE ════════════════════════════
 *
 * Verificado el 19-ago-2026 leyendo el código: `whatsapp/repositorioDrizzle.ts`
 * emite al bus de tiempo real por **cualquier** mensaje nuevo —entrante,
 * saliente o simulado— y es el ÚNICO punto donde se guarda uno; los dos
 * transportes pasan por ahí. `lib/datos/tiempoReal.ts` traduce ese evento a una
 * invalidación del hilo abierto. **Para los mensajes, el poll es la red, no la
 * fuente.**
 *
 * ══ 🔴 POR QUÉ EL ESCALÓN MÁS LENTO NO PUEDE PASAR DE 60 s ═════════════════
 *
 * Porque el SSE **no cubre los ✓✓ de la Cloud API**. whatsmeow sí los emite
 * (`server/src/whatsapp/wiring.ts`, `if (filas > 0) emitirRT(...)`), pero el
 * webhook de la Cloud API llama a `aplicarRecibo` dentro de su bucle de
 * `statuses[]` y **no avisa a nadie** (`server/src/webhook/whatsapp.ts`). O sea
 * que en `51984429504` —la única línea que trae leads— el único que hace
 * aparecer el ✓✓ es este poll.
 *
 * Mientras eso siga así, 60 s es un TECHO, no una preferencia. El día que los
 * recibos de la Cloud API salgan por el bus, este escalón puede subir; hasta
 * entonces, subirlo esconde el ✓✓ hasta dos minutos.
 *
 * ══ ⚠️ Y DEGRADA HACIA MÁS FRECUENTE, NUNCA HACIA MENOS ════════════════════
 *
 * Sin `data`, con una fecha que no se entiende o con una fecha del futuro, el
 * intervalo es el más corto de los tres. Un hilo que se refresca de más cuesta
 * un pedido de 21 ms; uno que se refresca de menos le esconde a la vendedora el
 * mensaje que está esperando.
 */

/** Recién escrito: la conversación está pasando AHORA. */
export const CADENCIA_HILO_VIVO_MS = 5_000;
/** De hace un rato: la vendedora sigue en esta conversación, pero no es un ping-pong. */
export const CADENCIA_HILO_TIBIO_MS = 15_000;
/**
 * Frío, o desconocido. **Es el techo del frente** (ver el 🔴 de arriba): con los
 * ✓✓ de la Cloud API fuera del bus, este número es lo que tarda un tilde en
 * aparecer en la línea que trae los leads.
 */
export const CADENCIA_HILO_FRIO_MS = 60_000;

/** Hasta acá el hilo se considera vivo. */
export const HILO_VIVO_MS = 2 * 60_000;
/** Hasta acá, tibio. */
export const HILO_TIBIO_MS = 60 * 60_000;

/**
 * Cuánto esperar hasta volver a pedir el hilo, en milisegundos.
 *
 * `ultimoMensajeEn` es el `occurred_at` del ÚLTIMO mensaje del hilo (el server
 * lo sirve ASC, así que es `mensajes.at(-1)`). `null`/`undefined`/basura → el
 * escalón más rápido.
 *
 * Vive fuera del hook, pura y con test, por lo mismo que `ritmoDePolling` en
 * `miLinea.ts`: adentro de la opción de `useQuery` esta decisión no se puede
 * interrogar sobre el caso que todavía no pasó.
 */
export function intervaloDelHilo(
  ultimoMensajeEn: string | Date | number | null | undefined,
  ahora: number | Date,
): number {
  const cuando = enMilisegundos(ultimoMensajeEn);
  const referencia = enMilisegundos(ahora);
  if (cuando === null || referencia === null) return CADENCIA_HILO_VIVO_MS;
  const transcurrido = referencia - cuando;
  // Negativo = el reloj del server va adelante del nuestro. Se lee como
  // «recién», que es la lectura que degrada hacia MÁS frecuente.
  if (transcurrido < HILO_VIVO_MS) return CADENCIA_HILO_VIVO_MS;
  if (transcurrido < HILO_TIBIO_MS) return CADENCIA_HILO_TIBIO_MS;
  return CADENCIA_HILO_FRIO_MS;
}

/**
 * Un instante en milisegundos, o `null` si no se entiende.
 *
 * Una fecha ilegible tiene que caer en `null` —y de ahí al escalón más
 * rápido—, nunca en `NaN`: con `NaN` toda comparación da `false` y el hilo se
 * iría solo al escalón más LENTO, que es exactamente al revés de la regla.
 */
function enMilisegundos(valor: string | Date | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const ms = typeof valor === 'number' ? valor : new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * CADA CUÁNTO SE REPREGUNTA EL ESTADO DE LA LÍNEA, y cuándo se deja de preguntar.
 *
 * ══ LO MEDIDO ═════════════════════════════════════════════════════════════
 *
 * `GET /api/whatsapp/sesion` costaba **58.429 pedidos el 18-ago** (10 s fijos ×
 * ~6 observadores montados a la vez) y **19.313 de ellos terminaron en 404** —
 * el front preguntaba por líneas que el gestor no monta y no dejaba de
 * preguntar nunca.
 *
 * ══ EL 404 ES UNA RESPUESTA ESTABLE, NO UN FALLO TRANSITORIO ═══════════════
 *
 * `server/src/routes/whatsapp.ts` contesta `404 {message:'esa línea no está
 * corriendo'}` cuando `gestorWhatsapp().de(numeroPropio)` no encuentra la
 * línea. Eso no cambia solo: cambia cuando alguien monta la línea, y **cuando
 * eso pasa el server emite un evento `estado` por el bus**, que
 * `lib/datos/tiempoReal.ts` traduce a una invalidación de `['wa','sesion']`.
 * O sea que hay una red explícita: no hace falta martillar.
 *
 * ⚠️ **`refetchOnWindowFocus` está APAGADO globalmente** (`lib/datos/cliente.ts`),
 * así que «al volver a la pestaña se refresca solo» es FALSO en esta app. La
 * única red que queda al congelar el poll es la invalidación del SSE — por eso
 * `tiempoReal.ts` la dispara también **al reconectar** el stream, y no sólo al
 * recibir un `estado`.
 */
export const CADENCIA_SESION_MS = 60_000;

/**
 * ¿Este error es «esa línea no está corriendo»?
 *
 * Se pregunta por el `status` con tipado de pato y no con `instanceof ErrorApi`
 * a propósito: así este módulo no arrastra `lib/datos/cliente.ts` (que importa
 * la config y el token) y se puede testear sin entorno. `ErrorApi` cumple la
 * forma; cualquier otra cosa cae en `false`.
 */
export function esLineaQueNoCorre(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  );
}

/**
 * Cuánto esperar hasta repreguntar el estado de la línea, o `false` para no
 * volver a preguntar. Un 404 congela el poll; **cualquier otro error sigue
 * repreguntando**, porque un 503 o una red caída sí se arreglan solos.
 */
export function intervaloDeLaSesion(error: unknown): number | false {
  return esLineaQueNoCorre(error) ? false : CADENCIA_SESION_MS;
}
