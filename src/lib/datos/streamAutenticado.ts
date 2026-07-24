import { crearParserSSE } from './sse';

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
 */
export type FinDeStream = 'cerrado' | 'no-autorizado' | 'fallo';

export async function consumirStream(opciones: {
  url: string;
  token: string | null;
  senal: AbortSignal;
  onData: (data: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<FinDeStream> {
  const { url, token, senal, onData, fetchImpl = fetch } = opciones;
  try {
    const res = await fetchImpl(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: senal,
    });
    if (res.status === 401 || res.status === 403) return 'no-autorizado';
    if (!res.ok || !res.body) return 'fallo';

    const alimentar = crearParserSSE(onData);
    const decodificador = new TextDecoder();
    const lector = res.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      alimentar(decodificador.decode(value, { stream: true }));
    }
    return 'cerrado';
  } catch {
    return 'fallo'; // red caída o abort: el que llama decide si sigue vivo
  }
}
