import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../../config';
import { crearAgrupador } from './agrupador';
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
 *
 * ── 🔴 EL STREAM NO TIENE REPLAY, ASÍ QUE RECONECTAR ES RECUPERAR ──
 * Desde el 19-ago-2026 los polls de la cola, del hilo y de la sesión bajaron
 * mucho el ritmo **porque este bus es la fuente**. Lo que pagaba el hueco antes
 * era el poll rápido: mientras el stream estuvo cortado no llegó ni un aviso, y
 * `routes/stream.ts` no reenvía lo perdido al reconectar.
 *
 * ⚠️ Y **`refetchOnWindowFocus` está APAGADO globalmente** en Hermes
 * (`lib/datos/cliente.ts`), así que «al volver a la pestaña se refresca solo»
 * es FALSO acá. Sacar ritmo del poll obliga a poner una red explícita, y ésta
 * es: al **reconectar** se invalida todo lo que el bus habría empujado.
 * `alReconectar` no corre en la PRIMERA conexión —ahí las queries recién se
 * montan y piden solas—, sólo cuando el stream volvió.
 */
const REINTENTO_MS = 3000;
/** Cuánto se reparten las pestañas para no invalidar la cola todas juntas. */
const JITTER_COLA_MS = 4000;
/**
 * ══ LA VENTANA EN LA QUE SE JUNTAN LAS DOS CONSULTAS CARAS ═══════════════════
 *
 * 🔴 **EL JITTER REPARTÍA Y NADA MÁS.** Cada mensaje que entra invalidaba la
 * cola, y en producción entran **7 a 18 por minuto** (medido el 19-ago-2026 en
 * el log del proceso: whatsmeow, no el webhook — por eso contar `POST /webhook`
 * daba cero y los números no cerraban). Con tres vendedoras conectadas eso eran
 * ~36 invalidaciones por minuto de la consulta más cara del sistema. Resultado:
 * `hermes_db` al 747 % de ocho núcleos y el 100 % de los pedidos en 504.
 *
 * Con la ventana, ese mismo minuto son **4 invalidaciones**, no 36.
 *
 * ⚠️ **15 s no es un número de confort: es lo que la pantalla puede tolerar sin
 * mentir.** Lo que la vendedora mira mientras le escriben es el HILO, y ése se
 * invalida al instante (abajo, sin agrupar). La campanita y el aviso de
 * escritorio también son inmediatos. Lo que espera hasta 15 s es el ORDEN de la
 * lista — y aun así queda veinte veces más fresco que la red del poll, que con
 * el stream vivo son 5 minutos (`lib/datos/latido.ts`).
 *
 * ⚠️ **La ventana NO reemplaza al jitter, lo contiene**: la ventana acota el
 * RITMO de una pestaña, el jitter desincroniza las PESTAÑAS entre sí. Sacar el
 * segundo devuelve las ~8 vendedanas disparando en el mismo segundo.
 */
const VENTANA_CARAS_MS = 15_000;

export function useTiempoReal(sesionActiva: boolean, alNoAutorizado?: () => void) {
  const qc = useQueryClient();

  useEffect(() => {
    if (sesionActiva) pedirPermisoDeNotificacion();
  }, [sesionActiva]);

  useEffect(() => {
    if (!sesionActiva) return;
    const control = new AbortController();
    let reintento: ReturnType<typeof setTimeout> | undefined;
    /** La primera conexión no recupera nada: las queries recién se montan. */
    let primeraConexion = true;

    /**
     * ⚠️ JITTER en la cola, y no en las demás: el SSE empuja el mismo evento a
     * TODAS las pestañas conectadas en el mismo instante, y sin este delay las
     * ~8 vendedoras invalidan `['conversaciones']` juntas — la consulta más
     * cara del sistema, disparada 8 veces en el mismo segundo (medido: load
     * average 16 en un VPS de 8 núcleos). `frescura`/`dashboard`/el hilo son
     * baratas y no lo necesitan.
     */
    /**
     * Las dos caras van AGRUPADAS y con jitter; el resto, al instante.
     *
     * Se separan en dos agrupadores y no en uno solo porque el reconecte
     * invalida el dashboard sin pasar por la cola, y con un agrupador
     * compartido un mensaje se habría comido esa recuperación.
     */
    const agCola = crearAgrupador(() => VENTANA_CARAS_MS + Math.random() * JITTER_COLA_MS);
    const agDashboard = crearAgrupador(() => VENTANA_CARAS_MS + Math.random() * JITTER_COLA_MS);
    const invalidarColaAgrupada = () =>
      agCola.pedir(() => {
        if (!control.signal.aborted) void qc.invalidateQueries({ queryKey: ['conversaciones'] });
      });
    const invalidarDashboardAgrupado = () =>
      agDashboard.pedir(() => {
        if (!control.signal.aborted) void qc.invalidateQueries({ queryKey: ['dashboard'] });
      });

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
        // La cola cambió (fila nueva o reordenada) y la frescura también. El
        // jitter vive en `invalidarColaConJitter` y lo comparte con el
        // reconecte: dos delays distintos sobre la misma consulta serían la
        // misma regla escrita dos veces.
        invalidarColaAgrupada();
        void qc.invalidateQueries({ queryKey: ['frescura'] });
        // El radar del dashboard también: un mensaje ES un lead cayendo. Va
        // agrupado como la cola: son las dos que pesan (~2 s cada una medidas
        // en producción), y el resto de esta función cuesta milisegundos.
        invalidarDashboardAgrupado();
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
        invalidarDashboardAgrupado();
      }
    };

    /**
     * LA RECUPERACIÓN DE LO QUE PASÓ MIENTRAS EL STREAM ESTUVO CAÍDO.
     *
     * Se invalida lo mismo que invalidaría un evento `mensaje` más un `estado`,
     * porque no se sabe cuál de los dos se perdió: la cola, la frescura, el
     * radar, el hilo abierto y el estado de las líneas.
     *
     * ⚠️ **La cola lleva el MISMO jitter que la rama de `mensaje`**, y por el
     * mismo motivo elevado al cuadrado: un deploy corta el stream de las ~8
     * pestañas a la vez, así que todas reconectan en la misma ventana de 3 s y
     * sin el delay dispararían juntas la consulta más cara del sistema —
     * exactamente cuando el server acaba de arrancar.
     */
    function alReconectar() {
      invalidarColaAgrupada();
      void qc.invalidateQueries({ queryKey: ['frescura'] });
      invalidarDashboardAgrupado();
      void qc.invalidateQueries({ queryKey: ['wa', 'conversacion'] });
      // 🔴 Y el estado de las líneas: sin esto, una línea que se montó mientras
      // el front estaba desconectado se queda en su 404 congelado para siempre
      // (`useSesionWa` deja de repreguntarlo a propósito — ver `cadencia.ts`).
      void qc.invalidateQueries({ queryKey: ['wa', 'sesion'] });
    }

    async function conectar() {
      const fin = await consumirStream({
        url: `${API_URL}/api/stream`,
        token: tokenGuardado(),
        senal: control.signal,
        onData: manejar,
        onAbierto: () => {
          if (primeraConexion) {
            primeraConexion = false;
            return;
          }
          alReconectar();
        },
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
      // Las ventanas abiertas se tiran: la guarda del `signal` ya evitaba
      // invalidar sobre un cliente desmontado, pero dejar dos timers de 15 s
      // vivos por cada montaje es una fuga que en un `StrictMode` se duplica.
      agCola.cancelar();
      agDashboard.cancelar();
    };
  }, [qc, sesionActiva, alNoAutorizado]);
}
