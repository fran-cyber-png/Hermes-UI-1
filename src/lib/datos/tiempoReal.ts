import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../../config';
import { consumirStream } from './streamAutenticado';
import { tokenGuardado } from './token';
import { esMensajeEntrante } from '../notificaciones/decidir';
import { reproducirSonidoMensaje } from '../notificaciones/sonido';
import { notificarEscritorio, pedirPermisoDeNotificacion } from '../notificaciones/escritorio';
import { formatoTelefono } from '../formato';

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
 * EventSource no puede mandar headers. `consumirStream` lo consume con fetch.
 *
 * ── Red caída ≠ sesión muerta ──
 * Un corte de red o un deploy se reintenta a los 3s (los mismos del `retry`
 * que mandaba el server). Un **401 corta el loop**: martillar con un token
 * muerto no lo revive — se dispara `alNoAutorizado` (App pasa la re-validación
 * de sesión, el mismo camino de `/api/auth/yo` que echa y limpia si
 * corresponde). Y solo se conecta con sesión iniciada.
 *
 * ── La campanita ──
 * Un mensaje `entrante` (nunca lo que mandamos nosotros) suena y, si la
 * pestaña no está a la vista, además dispara un `Notification` — ver
 * `lib/notificaciones/`. El permiso se pide al iniciar sesión, no al primer
 * mensaje: pedirlo desde un tab en segundo plano (el caso en que más se
 * necesita) suele ser justo cuando el navegador lo deniega solo.
 *
 * ── 🔴 El evento puede venir RECORTADO, y eso no es un evento roto ──
 * Desde el 17-ago-2026 el server filtra por dueña (`realtime/visibilidad.ts`):
 * un mensaje de una conversación que no es tuya llega **sin `telefono` y sin
 * `direccion`**. Antes llegaban todos enteros, o sea que a Sindy le sonaba la
 * campanita —y le saltaba un aviso del sistema con el número— cuando le
 * escribían a un lead de Luz.
 *
 * Lo que NO cambia es que la pantalla se refresque: el evento recortado sigue
 * invalidando la cola, el radar y **el hilo abierto**. Esa última mitad es la
 * que obliga a las dos ramas de abajo — sin ella, una conversación sin dueña
 * (todo lo anterior al reparto, y toda línea sin rueda) dejaría de actualizarse
 * sola con el chat abierto, que es el defecto que este bus vino a arreglar.
 */
const REINTENTO_MS = 3000;

export function useTiempoReal(sesionActiva: boolean, alNoAutorizado?: () => void) {
  const qc = useQueryClient();

  useEffect(() => {
    if (sesionActiva) pedirPermisoDeNotificacion();
  }, [sesionActiva]);

  useEffect(() => {
    if (!sesionActiva) return;
    const control = new AbortController();
    let reintento: ReturnType<typeof setTimeout> | undefined;

    const manejar = (data: string) => {
      let e: { tipo?: string; telefono?: string | null; direccion?: string };
      try {
        e = JSON.parse(data);
      } catch {
        return;
      }

      if (esMensajeEntrante(e)) {
        // La campanita: nos escribieron. Nunca por lo que mandamos nosotros
        // (`esMensajeEntrante` filtra por `direccion`), ni por una reacción o
        // un recibo (el server no manda `direccion` en esos casos).
        reproducirSonidoMensaje();
        if (e.telefono) notificarEscritorio('Hermes', `Nuevo mensaje de ${formatoTelefono(e.telefono)}`);
      }

      if (e.tipo === 'mensaje') {
        // La cola cambió (fila nueva o reordenada) y la frescura también.
        // ⚠️ JITTER en la cola, y no en las demás: el SSE empuja el mismo evento a
        // TODAS las pestañas conectadas en el mismo instante, y sin este delay las
        // ~8 vendedoras invalidan `['conversaciones']` juntas — la consulta más
        // cara del sistema, disparada 8 veces en el mismo segundo (medido: load
        // average 16 en un VPS de 8 núcleos). `frescura`/`dashboard`/el hilo son
        // baratas y no lo necesitan.
        setTimeout(() => {
          if (!control.signal.aborted) void qc.invalidateQueries({ queryKey: ['conversaciones'] });
        }, Math.random() * 4000);
        void qc.invalidateQueries({ queryKey: ['frescura'] });
        // El radar del dashboard también: un mensaje ES un lead cayendo.
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
        // Y el hilo de esa persona, si está abierto. Con el evento recortado no
        // sabemos de quién fue, así que se invalida el PREFIJO: react-query
        // refetchea solo las queries ACTIVAS, y de hilo hay a lo sumo una montada.
        // Cuesta un refetch de esa única consulta por cada mensaje ajeno; lo que
        // compra es que el chat abierto nunca se quede viejo, sin nombrar a nadie.
        if (e.telefono) void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', e.telefono] });
        else void qc.invalidateQueries({ queryKey: ['wa', 'conversacion'] });
      } else if (e.tipo === 'estado') {
        void qc.invalidateQueries({ queryKey: ['wa', 'sesion'] });
        // El webhook de landing emite 'estado' al persistir: el radar se refresca.
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      }
    };

    async function conectar() {
      const fin = await consumirStream({
        url: `${API_URL}/api/stream`,
        token: tokenGuardado(),
        senal: control.signal,
        onData: manejar,
      });
      if (control.signal.aborted) return;
      if (fin === 'no-autorizado') {
        // Token muerto: se corta acá. La re-validación decide si echa (y
        // entonces `sesionActiva` baja y este efecto se desmonta solo).
        alNoAutorizado?.();
        return;
      }
      reintento = setTimeout(() => void conectar(), REINTENTO_MS);
    }

    void conectar();

    return () => {
      control.abort();
      if (reintento !== undefined) clearTimeout(reintento);
    };
  }, [qc, sesionActiva, alNoAutorizado]);
}
