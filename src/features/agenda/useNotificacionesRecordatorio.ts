import { useEffect, useRef } from 'react';
import type { Recordatorio } from './agenda';

/**
 * Hook que dispara notificaciones cuando llega la hora de un recordatorio.
 * Vibra el dispositivo y muestra una notificación del navegador (si está permitido).
 */
export function useNotificacionesRecordatorio(recordatorios: Recordatorio[] | undefined) {
  const notificadasRef = useRef(new Set<number>());

  useEffect(() => {
    if (!recordatorios?.length) return;

    // Solicitar permiso para notificaciones la primera vez
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const verificar = () => {
      const ahora = new Date();
      const hace1Min = new Date(ahora.getTime() - 60_000); // Ventana de 1 minuto

      for (const r of recordatorios) {
        if (r.estado !== 'pendiente') continue;

        const cuandoDate = new Date(r.cuando);
        const esAhora = cuandoDate > hace1Min && cuandoDate <= ahora;

        if (esAhora && !notificadasRef.current.has(r.id)) {
          notificadasRef.current.add(r.id);

          // Vibración
          if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200, 100, 200]); // Patrón: 200ms vibración, 100ms pausa, etc.
          }

          // Notificación del navegador
          if (Notification.permission === 'granted') {
            new Notification('Hora del recordatorio', {
              body: r.nota,
              icon: '⏰',
              tag: `recordatorio-${r.id}`,
              requireInteraction: true,
            });
          }
        }
      }
    };

    // Verificar cada 10 segundos
    const interval = setInterval(verificar, 10_000);
    // Y una vez inmediatamente
    verificar();

    return () => clearInterval(interval);
  }, [recordatorios]);
}
