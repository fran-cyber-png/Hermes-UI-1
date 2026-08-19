import { crearParserSSE } from './sse';
import { marcarLatido, olvidarLatido } from './latido';

/**
 * UNA CONEXIÓN AL STREAM SSE AUTENTICADO — y el veredicto de cómo terminó.
 *
 * Separado del hook (`tiempoReal.ts`) porque acá vive la distinción que
 * importa: **red caída ≠ sesión muerta**.
 *
 *   · «cerrado»       — el server cortó limpio (deploy, restart): reintentable.
 *   · «fallo»         — red caída o 5xx: reintentable.
 *   · «no-autorizado» — 401/403: el token está muerto. Reintentar cada 3s no
 *                       lo revive; el que llama debe CORTAR el loop y disparar
 *                       la re-validación de sesión (el camino de /api/auth/yo,
 *                       que echa y limpia si corresponde).
 *
 * `fetchImpl` se inyecta para poder testear los tres finales sin red.
 *
 * ══ 🔴 ACÁ SE MARCA EL LATIDO, Y NO EN `onData` ═════════════════════════════
 *
 * El server manda `: keep-alive\n\n` cada 25 s (`server/src/routes/stream.ts`)
 * justamente para que el otro lado sepa que sigue vivo cuando no hay eventos —
 * y **el parser lo tira**: `sse.ts` se queda sólo con las líneas que empiezan
 * con `data:`, así que un bloque de comentario no produce ninguna llamada a
 * `onData`. Un latido leído desde ahí estaría muerto cada vez que no pasa nada,
 * que es justo el caso que hay que distinguir.
 *
 * Por eso se marca en cada `read()` que devuelve bytes, **sin mirar qué
 * traen**: lo que prueba que el stream está vivo es que lleguen bytes. Quién lo
 * lee y para qué: `lib/datos/latido.ts`.
 */
export type FinDeStream = 'cerrado' | 'no-autorizado' | 'fallo';

export async function consumirStream(opciones: {
  url: string;
  token: string | null;
  senal: AbortSignal;
  onData: (data: string) => void;
  /** El stream quedó abierto (200 con body). Se llama UNA vez por conexión. */
  onAbierto?: () => void;
  fetchImpl?: typeof fetch;
}): Promise<FinDeStream> {
  const { url, token, senal, onData, onAbierto, fetchImpl = fetch } = opciones;
  try {
    const res = await fetchImpl(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: senal,
    });
    if (res.status === 401 || res.status === 403) return 'no-autorizado';
    if (!res.ok || !res.body) return 'fallo';

    // El stream quedó ABIERTO. Se avisa acá y no al primer evento porque lo que
    // el que llama necesita saber es que el push volvió, y un stream sano puede
    // estar minutos sin un solo evento.
    onAbierto?.();

    const alimentar = crearParserSSE(onData);
    const decodificador = new TextDecoder();
    const lector = res.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      // Llegaron bytes: el stream está vivo, traigan lo que traigan (el
      // keep-alive del server no produce ningún evento — ver el bloque de
      // arriba). `value` vacío no cuenta: no prueba nada.
      if (value.byteLength > 0) marcarLatido();
      alimentar(decodificador.decode(value, { stream: true }));
    }
    // Se cortó de forma conocida: el latido se olvida en el acto en vez de
    // esperar a que venza. Sin esto, la cola se quedaría hasta un minuto
    // creyendo que el push sigue vivo justo cuando dejó de estarlo.
    olvidarLatido();
    return 'cerrado';
  } catch {
    olvidarLatido();
    return 'fallo'; // red caída o abort: el que llama decide si sigue vivo
  }
}
