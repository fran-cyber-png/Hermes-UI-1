import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../../config';

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
 * Si el stream se corta (red, deploy), el navegador reconecta solo (el server
 * manda `retry`), y además la cola tiene un refetch de respaldo por si acaso.
 */
export function useTiempoReal() {
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/stream`);

    es.onmessage = (ev) => {
      let e: { tipo?: string; telefono?: string | null };
      try {
        e = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (e.tipo === 'mensaje') {
        // La cola cambió (fila nueva o reordenada) y la frescura también.
        void qc.invalidateQueries({ queryKey: ['conversaciones'] });
        void qc.invalidateQueries({ queryKey: ['frescura'] });
        // Y el hilo de esa persona, si está abierto.
        if (e.telefono) void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', e.telefono] });
      } else if (e.tipo === 'estado') {
        void qc.invalidateQueries({ queryKey: ['wa', 'sesion'] });
      }
    };

    return () => es.close();
  }, [qc]);
}
