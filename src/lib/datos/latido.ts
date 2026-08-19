/**
 * EL LATIDO DEL STREAM — la única forma que tiene el front de saber si el push
 * está vivo, y con eso decidir cuánto vale su propio poll.
 *
 * ══ EL PROBLEMA ════════════════════════════════════════════════════════════
 *
 * La cola se repregunta cada 20–30 s (`dominio/conversaciones.ts`) **aunque el
 * SSE esté vivo y le esté avisando de cada mensaje al instante**. El 18-ago-2026
 * eso fueron 13.152 pedidos a `/api/conversaciones`, la consulta más cara del
 * sistema (2,4 s), contra **220 mensajes reales en todo el día**.
 *
 * El poll no sobra —es la única recuperación de un stream sin replay, y
 * `refetchOnWindowFocus` está apagado globalmente en esta app— pero **cambia de
 * papel**: con el stream vivo es una red muy espaciada; con el stream muerto es
 * lo único que queda, y ahí vuelve el ritmo de hoy.
 *
 * ══ POR QUÉ UN LATIDO Y NO «¿HAY UNA CONEXIÓN ABIERTA?» ════════════════════
 *
 * Porque un socket abierto no prueba que del otro lado haya alguien. Un proxy
 * puede sostener la conexión después de que el server murió, y `fetch` no se
 * entera hasta que intenta leer. Lo que sí prueba que el stream está vivo es que
 * **lleguen bytes**, y el server manda `: keep-alive\n\n` cada 25 s
 * (`server/src/routes/stream.ts`) justamente para eso.
 *
 * ⚠️ **Ese keep-alive lo TIRA el parser** (`sse.ts` filtra las líneas que no
 * empiezan con `data:`, y un comentario no produce ningún evento), así que el
 * latido NO se puede marcar desde `onData`: se marca en `streamAutenticado.ts`,
 * en cada `read()` que devuelve bytes, sin mirar qué traen.
 *
 * ══ 60 s = DOS LATIDOS PERDIDOS ════════════════════════════════════════════
 *
 * Con el keep-alive cada 25 s, un solo latido perdido puede ser un GC o una
 * pestaña dormida; dos seguidos ya no. 60 s deja pasar uno y declara muerto al
 * segundo. Más corto haría que el poll rápido se prenda por nada; más largo
 * dejaría la cola sin refrescar un minuto de más justo cuando el push no está.
 *
 * ══ ⚠️ ESTO NO REEMPLAZA LA RECUPERACIÓN AL RECONECTAR ═════════════════════
 *
 * `refetchInterval` se recalcula recién cuando su timer vence, así que si el
 * stream se cae con la cola en 300 s, el intervalo corto tarda hasta 300 s en
 * entrar. La red que cubre ese hueco NO es ésta: es la invalidación explícita
 * que `tiempoReal.ts` dispara **al reconectar** el stream. Las dos hacen falta.
 */

/** Dos keep-alives de 25 s perdidos. Ver el bloque de arriba. */
export const LATIDO_VENCE_MS = 60_000;

/** Con el stream vivo la cola es una red muy espaciada: 5 minutos. */
export const COLA_CON_STREAM_MS = 300_000;
/** Sin stream, el ritmo de siempre: 20–30 s con jitter. */
export const COLA_SIN_STREAM_BASE_MS = 20_000;
export const COLA_SIN_STREAM_JITTER_MS = 10_000;

/**
 * Cuándo llegaron bytes del stream por última vez. `null` = nunca.
 *
 * Es un módulo con estado y no un hook a propósito: quien lo escribe
 * (`streamAutenticado.ts`) está adentro de un `for(;;)` sobre el body y no puede
 * ser un componente, y quienes lo leen son opciones de `useQuery` de dos
 * archivos distintos. Un contexto de React obligaría a cablear un provider
 * alrededor de todo para transportar un número.
 */
let ultimoLatido: number | null = null;

/** Llegaron bytes del stream. Lo llama `streamAutenticado.ts` en cada `read()`. */
export function marcarLatido(ahora: number = Date.now()): void {
  ultimoLatido = ahora;
}

/** Borra el latido: el stream se cortó de forma conocida, o un test arranca limpio. */
export function olvidarLatido(): void {
  ultimoLatido = null;
}

/**
 * ¿El push está vivo?
 *
 * **Nunca haber latido cuenta como muerto**, que es la lectura que degrada
 * hacia MÁS pedidos: al abrir la app la cola pollea rápido hasta que el stream
 * dé su primera señal, en vez de esperar cinco minutos confiando en un push que
 * todavía no se sabe si conectó.
 */
export function streamVivo(ahora: number = Date.now()): boolean {
  return ultimoLatido !== null && ahora - ultimoLatido < LATIDO_VENCE_MS;
}

/**
 * Cada cuánto repreguntar la cola.
 *
 * `azar` es un número en [0,1) —`Math.random()` del llamador— y entra como
 * parámetro para que la regla se pueda testear sin stubear el global.
 *
 * ⚠️ **El jitter no es decoración y no se saca del camino sin stream**: el SSE
 * empuja el mismo evento a TODAS las pestañas en el mismo instante, y sin el
 * delay las ~8 vendedoras invalidan `['conversaciones']` juntas — la consulta
 * más cara del sistema, disparada 8 veces en el mismo segundo (medido: load
 * average 16 en un VPS de 8 núcleos). Con el stream vivo el intervalo es tan
 * largo que ya no las sincroniza nada; sin stream, el jitter es lo que las
 * separa.
 */
export function intervaloDeCola(vivo: boolean, azar: number): number {
  if (vivo) return COLA_CON_STREAM_MS;
  return COLA_SIN_STREAM_BASE_MS + azar * COLA_SIN_STREAM_JITTER_MS;
}
