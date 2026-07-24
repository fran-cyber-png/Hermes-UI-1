import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../../config';
import { crearParserSSE } from './sse';
import { tokenGuardado } from './token';

/**
 * TIEMPO REAL — el frontend escucha lo que el server empuja.
 *
 * El server abre un stream SSE (`/api/stream`) y manda una señal cada vez que
 * entra un mensaje o cambia el estado de la sesión. Acá se traduce esa señal a
 * invalidaciones de react-query: la cola, la conversación de esa persona y el
 * estado de WhatsApp se vuelven a pedir al instante. Es push, no polling —el
 * mensaje aparece en la pantalla apenas llega al server, sin que la vendedora
 * toque nada.
 *
 * ── Por qué fetch y no EventSource ──
 * Los eventos de mensaje llevan el teléfono del contacto (PII), así que desde
 * el cierre del issue #36 el stream exige el Bearer como todo /api — y
 * EventSource no puede mandar headers. `fetch` sí: se lee el body como stream
 * y `crearParserSSE` reconstruye los eventos. Lo que se pierde de EventSource
 * (la reconexión automática) se repone acá: ante cualquier corte —red, deploy,
 * 401 por token vencido— se reintenta a los 3s, igual que el `retry` que
 * mandaba el server. Solo se conecta con sesión iniciada: sin token, el stream
 * daría 401 en loop.
 */
const REINTENTO_MS = 3000;

export function useTiempoReal(sesionActiva: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!sesionActiva) return;
    const control = new AbortController();
    let reintento: ReturnType<typeof setTimeout> | undefined;

    const manejar = (data: string) => {
      let e: { tipo?: string; telefono?: string | null };
      try {
        e = JSON.parse(data);
      } catch {
        return;
      }

      if (e.tipo === 'mensaje') {
        // La cola cambió (fila nueva o reordenada) y la frescura también.
        void qc.invalidateQueries({ queryKey: ['conversaciones'] });
        void qc.invalidateQueries({ queryKey: ['frescura'] });
        // El radar del dashboard también: un mensaje ES un lead cayendo.
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
        // Y el hilo de esa persona, si está abierto.
        if (e.telefono) void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', e.telefono] });
      } else if (e.tipo === 'estado') {
        void qc.invalidateQueries({ queryKey: ['wa', 'sesion'] });
        // El webhook de landing emite 'estado' al persistir: el radar se refresca.
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      }
    };

    async function conectar() {
      const token = tokenGuardado();
      try {
        const res = await fetch(`${API_URL}/api/stream`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: control.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        const alimentar = crearParserSSE(manejar);
        const decodificador = new TextDecoder();
        const lector = res.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          alimentar(decodificador.decode(value, { stream: true }));
        }
      } catch {
        // Red caída, deploy a medias o 401: abajo se reintenta. Nunca se
        // revienta la app por perder el nervio en vivo.
      }
      if (!control.signal.aborted) {
        reintento = setTimeout(() => void conectar(), REINTENTO_MS);
      }
    }

    void conectar();

    return () => {
      control.abort();
      if (reintento !== undefined) clearTimeout(reintento);
    };
  }, [qc, sesionActiva]);
}
